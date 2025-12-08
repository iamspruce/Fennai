# functions/inference/routes/clone_audio.py
import os
import logging
import torch
import numpy as np
from io import BytesIO
from google.cloud import storage
from firebase_admin import firestore
import soundfile as sf
import base64
import requests

logger = logging.getLogger(__name__)
db = firestore.client()
storage_client = storage.Client()

GCS_DUBBING_BUCKET = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")
SAMPLE_RATE = 24000

# Import model globals from main
from main import processor, model, device


def download_voice_sample(url: str) -> bytes:
    """Download voice sample from URL (GCS or HTTP)"""
    if url.startswith("gs://"):
        # Download from GCS
        path_parts = url.replace("gs://", "").split("/", 1)
        bucket_name = path_parts[0]
        blob_path = path_parts[1]
        
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        return blob.download_as_bytes()
    else:
        # Download from HTTP
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.content


def clone_audio_route(request):
    """
    Clone audio for a specific chunk (max 4 speakers)
    Part of multi-chunk dubbing pipeline
    """
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized clone-audio request")
        return {"error": "Unauthorized"}, 403
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    chunk_id = data.get("chunk_id")
    speakers = data.get("speakers", [])
    text = data.get("text", "")
    voice_samples_urls = data.get("voice_samples", {})  # {speaker_id: url}
    
    if not all([job_id, uid, text, voice_samples_urls]):
        return {"error": "Missing required fields"}, 400
    
    if chunk_id is None:
        return {"error": "Missing chunk_id"}, 400
    
    logger.info(f"Job {job_id}, Chunk {chunk_id}: Starting voice cloning")
    
    # Get job document
    job_ref = db.collection("dubbingJobs").document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        return {"error": "Job not found"}, 404
    
    job_data = job_doc.to_dict()
    
    # Update chunk status
    cloned_chunks = job_data.get("clonedAudioChunks", [])
    for chunk in cloned_chunks:
        if chunk["chunkId"] == chunk_id:
            chunk["status"] = "processing"
    
    job_ref.update({
        "clonedAudioChunks": cloned_chunks,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    try:
        # Download voice samples
        voice_samples = []
        for speaker_id in speakers:
            url = voice_samples_urls.get(speaker_id)
            if not url:
                raise ValueError(f"No voice sample for {speaker_id}")
            
            sample_bytes = download_voice_sample(url)
            voice_samples.append(sample_bytes)
        
        # Convert to base64 for processor (matches existing pipeline)
        voice_samples_b64 = [
            base64.b64encode(sample).decode('utf-8')
            for sample in voice_samples
        ]
        
        # Map speakers to voice samples (same logic as main inference)
        from utils import map_speakers_to_voice_samples
        mapped_samples = map_speakers_to_voice_samples(text, voice_samples_b64)
        
        # Run inference
        inputs = processor(
            text=[text],
            voice_samples=mapped_samples,
            return_tensors="pt",
            padding=True,
        ).to(device)
        
        with torch.inference_mode():
            generated = model.generate(**inputs, do_sample=False, cfg_scale=1.3)
            audio = processor.decode(generated, skip_special_tokens=True)
        
        audio_np = audio.cpu().numpy().squeeze()
        audio_np = np.clip(audio_np, -1.0, 1.0)
        if np.abs(audio_np).max() > 0:
            audio_np = audio_np / np.abs(audio_np).max() * 0.95
        
        # Save to BytesIO
        buffer = BytesIO()
        sf.write(buffer, audio_np, SAMPLE_RATE, format="WAV")
        audio_bytes = buffer.getvalue()
        
        # Upload to GCS
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        chunk_blob_path = f"jobs/{job_id}/chunks/chunk_{chunk_id}.wav"
        chunk_blob = bucket.blob(chunk_blob_path)
        chunk_blob.upload_from_string(audio_bytes, content_type="audio/wav")
        
        chunk_url = f"gs://{GCS_DUBBING_BUCKET}/{chunk_blob_path}"
        
        logger.info(f"Job {job_id}, Chunk {chunk_id}: Cloned {len(audio_bytes)} bytes")
        
        # Update chunk status
        for chunk in cloned_chunks:
            if chunk["chunkId"] == chunk_id:
                chunk["status"] = "completed"
                chunk["audioUrl"] = chunk_url
                chunk["audioPath"] = chunk_blob_path
        
        completed_count = sum(1 for c in cloned_chunks if c["status"] == "completed")
        total_chunks = len(cloned_chunks)
        
        job_ref.update({
            "clonedAudioChunks": cloned_chunks,
            "completedChunks": completed_count,
            "step": f"Cloning voices ({completed_count}/{total_chunks} chunks)...",
            "progress": 75 + int((completed_count / total_chunks) * 15),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        # If all chunks complete, queue merge task
        if completed_count == total_chunks:
            logger.info(f"Job {job_id}: All chunks complete, queuing merge")
            
            from google.cloud import tasks_v2
            import json
            
            CLOUD_RUN_URL = os.getenv("CLOUD_RUN_URL")
            GCP_PROJECT = os.getenv("GCP_PROJECT", "fennai")
            QUEUE_LOCATION = os.getenv("QUEUE_LOCATION", "us-central1")
            QUEUE_NAME = os.getenv("QUEUE_NAME", "voice-generation-queue")
            SERVICE_ACCOUNT = os.getenv("SERVICE_ACCOUNT_EMAIL")
            
            tasks_client = tasks_v2.CloudTasksClient()
            queue_path = tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)
            
            task_payload = {
                "job_id": job_id,
                "uid": uid,
            }
            
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": f"{CLOUD_RUN_URL}/merge-audio",
                    "headers": {
                        "Content-Type": "application/json",
                        "X-Internal-Token": INTERNAL_TOKEN,
                    },
                    "body": base64.b64encode(
                        json.dumps(task_payload).encode()
                    ).decode(),
                },
                "dispatch_deadline": {"seconds": 600},
            }
            
            if SERVICE_ACCOUNT:
                task["http_request"]["oidc_token"] = {
                    "service_account_email": SERVICE_ACCOUNT
                }
            
            tasks_client.create_task(request={"parent": queue_path, "task": task})
        
        return {"success": True, "chunkId": chunk_id}, 200
        
    except Exception as e:
        logger.error(f"Job {job_id}, Chunk {chunk_id}: Cloning failed: {str(e)}")
        
        # Update chunk status
        for chunk in cloned_chunks:
            if chunk["chunkId"] == chunk_id:
                chunk["status"] = "failed"
                chunk["error"] = str(e)
        
        job_ref.update({
            "clonedAudioChunks": cloned_chunks,
            "status": "failed",
            "error": f"Chunk {chunk_id} cloning failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Cloning failed"}, 500