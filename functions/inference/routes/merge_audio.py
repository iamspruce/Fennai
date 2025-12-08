# functions/inference/routes/merge_audio.py
import os
import logging
import tempfile
from datetime import datetime, timedelta
from google.cloud import storage
from firebase_admin import firestore
from pydub import AudioSegment

from utils.audio_processor import concatenate_audio_files

logger = logging.getLogger(__name__)
db = firestore.client()
storage_client = storage.Client()

GCS_DUBBING_BUCKET = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")


def merge_audio_route(request):
    """
    Merge all cloned audio chunks into single file
    """
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized merge-audio request")
        return {"error": "Unauthorized"}, 403
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    
    if not all([job_id, uid]):
        return {"error": "Missing required fields"}, 400
    
    logger.info(f"Job {job_id}: Starting audio merge")
    
    # Get job document
    job_ref = db.collection("dubbingJobs").document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        return {"error": "Job not found"}, 404
    
    job_data = job_doc.to_dict()
    cloned_chunks = job_data.get("clonedAudioChunks", [])
    media_type = job_data.get("mediaType", "audio")
    
    # Update status
    job_ref.update({
        "status": "merging",
        "step": "Merging audio chunks...",
        "progress": 90,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    try:
        # Sort chunks by ID
        cloned_chunks.sort(key=lambda c: c["chunkId"])
        
        # Download all chunks
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        chunk_files = []
        
        for chunk in cloned_chunks:
            if chunk["status"] != "completed":
                raise ValueError(f"Chunk {chunk['chunkId']} not completed")
            
            chunk_blob = bucket.blob(chunk["audioPath"])
            
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_file:
                chunk_blob.download_to_filename(tmp_file.name)
                chunk_files.append(tmp_file.name)
        
        # Concatenate audio files
        merged_audio_path = concatenate_audio_files(chunk_files)
        
        # Upload merged audio to GCS
        merged_blob_path = f"jobs/{job_id}/dubbed_audio.wav"
        merged_blob = bucket.blob(merged_blob_path)
        merged_blob.upload_from_filename(merged_audio_path)
        
        merged_url = f"gs://{GCS_DUBBING_BUCKET}/{merged_blob_path}"
        
        logger.info(f"Job {job_id}: Merged audio uploaded to {merged_url}")
        
        # Clean up temp files
        os.unlink(merged_audio_path)
        for chunk_file in chunk_files:
            try:
                os.unlink(chunk_file)
            except:
                pass
        
        # Update job
        job_ref.update({
            "clonedAudioPath": merged_blob_path,
            "clonedAudioUrl": merged_url,
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        # If video, queue video merge; otherwise mark complete
        if media_type == "video":
            logger.info(f"Job {job_id}: Queuing video merge")
            
            from google.cloud import tasks_v2
            import json
            import base64
            
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
                    "url": f"{CLOUD_RUN_URL}/merge-video",
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
            
            job_ref.update({
                "step": "Merging video...",
                "progress": 95,
                "updatedAt": firestore.SERVER_TIMESTAMP
            })
        
        else:
            # Audio-only job complete
            # Generate signed URL
            signed_url = merged_blob.generate_signed_url(
                version="v4",
                expiration=timedelta(hours=24),
                method="GET",
            )
            
            # Confirm credits
            from shared.credits import confirm_credit_deduction
            confirm_credit_deduction(uid, job_id, job_data.get("cost", 0))
            
            job_ref.update({
                "status": "completed",
                "step": "Dubbing complete!",
                "progress": 100,
                "finalMediaUrl": signed_url,
                "finalMediaPath": merged_blob_path,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "completedAt": firestore.SERVER_TIMESTAMP
            })
            
            logger.info(f"Job {job_id}: Audio dubbing complete")
        
        return {"success": True}, 200
        
    except Exception as e:
        logger.error(f"Job {job_id}: Audio merge failed: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Audio merge failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Audio merge failed"}, 500