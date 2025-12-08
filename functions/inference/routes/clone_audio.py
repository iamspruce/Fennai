"""Audio cloning route for dubbing chunks"""
import logging
import torch
import numpy as np
from io import BytesIO
import soundfile as sf
import base64
import requests
from google.cloud import tasks_v2
import json

from config import config
from firebase_admin import firestore
from utils.gcs_utils import upload_to_gcs
from utils.validators import validate_request, CloneAudioRequest
from middleware import extract_job_info, get_job_document, update_job_status

logger = logging.getLogger(__name__)
db = firestore.client()


def download_voice_sample(url: str) -> bytes:
    """Download voice sample from URL"""
    from utils.gcs_utils import parse_gcs_url, download_from_gcs
    
    if url.startswith("gs://"):
        bucket_name, blob_path = parse_gcs_url(url)
        return download_from_gcs(bucket_name, blob_path)
    else:
        response = requests.get(url, timeout=config.DOWNLOAD_TIMEOUT)
        response.raise_for_status()
        return response.content


def clone_audio_route():
    """Clone audio for a specific chunk"""
    from main import processor, model, config as app_config
    
    req = validate_request(CloneAudioRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    chunk_id = req.chunk_id
    speakers = req.speakers
    text = req.text
    voice_samples_urls = req.voice_samples
    
    logger.info(f"Job {job_id}, Chunk {chunk_id}: Starting voice cloning")
    
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    cloned_chunks = job_data.get("clonedAudioChunks", [])
    
    # Update chunk status
    for chunk in cloned_chunks:
        if chunk["chunkId"] == chunk_id:
            chunk["status"] = "processing"
    
    job_ref.update({
        "clonedAudioChunks": cloned_chunks,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    # Download voice samples
    voice_samples = []
    for speaker_id in speakers:
        url = voice_samples_urls.get(speaker_id)
        if not url:
            raise ValueError(f"No voice sample for {speaker_id}")
        
        sample_bytes = download_voice_sample(url)
        voice_samples.append(sample_bytes)
    
    # Convert to base64 for processor
    voice_samples_b64 = [base64.b64encode(s).decode('utf-8') for s in voice_samples]
    
    # Map speakers to voice samples
    from utils import map_speakers_to_voice_samples
    mapped_samples = map_speakers_to_voice_samples(text, voice_samples_b64)
    
    # Run inference
    inputs = processor(
        text=[text],
        voice_samples=mapped_samples,
        return_tensors="pt",
        padding=True,
    ).to(app_config.DEVICE)
    
    with torch.inference_mode():
        generated = model.generate(**inputs, do_sample=False, cfg_scale=1.3)
        audio = processor.decode(generated, skip_special_tokens=True)
    
    audio_np = audio.cpu().numpy().squeeze()
    audio_np = np.clip(audio_np, -1.0, 1.0)
    if np.abs(audio_np).max() > 0:
        audio_np = audio_np / np.abs(audio_np).max() * config.NORMALIZATION_HEADROOM
    
    # Save to BytesIO
    buffer = BytesIO()
    sf.write(buffer, audio_np, config.SAMPLE_RATE, format="WAV")
    audio_bytes = buffer.getvalue()
    
    # Upload to GCS
    chunk_blob_path = f"jobs/{job_id}/chunks/chunk_{chunk_id}.wav"
    upload_to_gcs(
        config.GCS_DUBBING_BUCKET,
        chunk_blob_path,
        audio_bytes,
        "audio/wav"
    )
    
    chunk_url = f"gs://{config.GCS_DUBBING_BUCKET}/{chunk_blob_path}"
    
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
        
        tasks_client = tasks_v2.CloudTasksClient()
        queue_path = tasks_client.queue_path(
            config.GCP_PROJECT,
            config.QUEUE_LOCATION,
            config.QUEUE_NAME
        )
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{config.CLOUD_RUN_URL}/merge-audio",
                "headers": {
                    "Content-Type": "application/json",
                    "X-Internal-Token": config.INTERNAL_TOKEN,
                },
                "body": base64.b64encode(
                    json.dumps({"job_id": job_id, "uid": uid}).encode()
                ).decode(),
            },
            "dispatch_deadline": {"seconds": config.TASK_DEADLINE},
        }
        
        if config.SERVICE_ACCOUNT_EMAIL:
            task["http_request"]["oidc_token"] = {
                "service_account_email": config.SERVICE_ACCOUNT_EMAIL
            }
        
        tasks_client.create_task(request={"parent": queue_path, "task": task})
    
    return {"success": True, "chunkId": chunk_id}, 200

