"""Audio merging route"""
import logging
from datetime import timedelta
from google.cloud import tasks_v2
import json
import base64

from config import config
from firebase_admin import firestore
from utils.cleanup import temp_files
from utils.gcs_utils import download_to_file, upload_file_to_gcs, generate_signed_url
from utils.audio_processor import concatenate_audio_files
from utils.validators import validate_request, MergeRequest
from middleware import extract_job_info, get_job_document

logger = logging.getLogger(__name__)
db = firestore.client()


def merge_audio_route():
    """Merge all cloned audio chunks"""
    req = validate_request(MergeRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    
    logger.info(f"Job {job_id}: Starting audio merge")
    
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    cloned_chunks = job_data.get("clonedAudioChunks", [])
    media_type = job_data.get("mediaType", "audio")
    
    job_ref.update({
        "status": "merging",
        "step": "Merging audio chunks...",
        "progress": 90,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    # Sort chunks
    cloned_chunks.sort(key=lambda c: c["chunkId"])
    
    # Download all chunks using temp_files context manager
    chunk_count = len(cloned_chunks)
    
    with temp_files(chunk_count, ".wav") as chunk_file_paths:
        for i, chunk in enumerate(cloned_chunks):
            if chunk["status"] != "completed":
                raise ValueError(f"Chunk {chunk['chunkId']} not completed")
            
            download_to_file(
                config.GCS_DUBBING_BUCKET,
                chunk["audioPath"],
                chunk_file_paths[i]
            )
        
        # Concatenate
        merged_audio_path = concatenate_audio_files(chunk_file_paths)
        
        # Upload merged audio
        merged_blob_path = f"jobs/{job_id}/dubbed_audio.wav"
        upload_file_to_gcs(
            config.GCS_DUBBING_BUCKET,
            merged_blob_path,
            merged_audio_path,
            "audio/wav"
        )
    
    merged_url = f"gs://{config.GCS_DUBBING_BUCKET}/{merged_blob_path}"
    
    logger.info(f"Job {job_id}: Merged audio uploaded")
    
    job_ref.update({
        "clonedAudioPath": merged_blob_path,
        "clonedAudioUrl": merged_url,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    # Queue video merge or complete
    if media_type == "video":
        logger.info(f"Job {job_id}: Queuing video merge")
        
        tasks_client = tasks_v2.CloudTasksClient()
        queue_path = tasks_client.queue_path(
            config.GCP_PROJECT,
            config.QUEUE_LOCATION,
            config.QUEUE_NAME
        )
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{config.CLOUD_RUN_URL}/merge-video",
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
        
        job_ref.update({
            "step": "Merging video...",
            "progress": 95,
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
    
    else:
        # Audio-only complete
        signed_url = generate_signed_url(config.GCS_DUBBING_BUCKET, merged_blob_path, 24)
        
        from firebase.credits import confirm_credit_deduction
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
