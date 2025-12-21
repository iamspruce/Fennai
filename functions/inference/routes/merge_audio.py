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
from middleware import (
    extract_job_info, 
    get_job_document,
    get_retry_info,
    update_job_retry_status
)
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()


def merge_audio_route():
    """Merge all cloned audio chunks"""
    # Get retry info
    retry_count, is_retry, is_final_attempt = get_retry_info()
    
    if is_retry:
        logger.info(f"🔄 Retry attempt {retry_count}/{config.MAX_RETRY_ATTEMPTS} for merge_audio")

    # Validate request
    try:
        req = validate_request(MergeRequest, extract_job_info()[2])
    except Exception as e:
        return {"error": "Invalid request", "details": str(e)}, 400
        
    job_id = req.job_id
    uid = req.uid
    
    logger.info(f"Job {job_id}: Starting audio merge")
    
    # Get job document
    try:
        job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    except Exception as e:
        logger.error(f"Job {job_id} not found: {str(e)}")
        return {"error": "Job not found"}, 404

    try:
        cloned_chunks = job_data.get("clonedAudioChunks", [])
        media_type = job_data.get("mediaType", "audio")
        
        job_ref.update({
            "status": "merging",
            "step": "Merging audio chunks...",
            "progress": 90,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        # Sort chunks
        cloned_chunks.sort(key=lambda c: c["chunkId"])
        
        # Download all chunks using temp_files context manager
        chunk_count = len(cloned_chunks)
        
        # Extract target durations from chunks (endTime - startTime)
        target_durations = []
        for chunk in cloned_chunks:
            start_time = chunk.get("startTime", 0)
            end_time = chunk.get("endTime", 0)
            target_duration = end_time - start_time
            target_durations.append(target_duration if target_duration > 0 else None)
        
        logger.info(f"Job {job_id}: Target durations for {chunk_count} segments: {[f'{d:.2f}s' if d else 'None' for d in target_durations]}")
        
        with temp_files(chunk_count, ".wav") as chunk_file_paths:
            for i, chunk in enumerate(cloned_chunks):
                if chunk["status"] != "completed":
                    raise ValueError(f"Chunk {chunk['chunkId']} not completed")
                
                download_to_file(
                    config.GCS_DUBBING_BUCKET,
                    chunk["audioPath"],
                    chunk_file_paths[i]
                )
            
            # Concatenate with per-segment time-stretching to match original timestamps
            merged_audio_path = concatenate_audio_files(chunk_file_paths, target_durations)
            
            # Upload merged audio
            merged_blob_path = f"jobs/{job_id}/dubbed_audio.wav"
            upload_file_to_gcs(
                config.GCS_DUBBING_BUCKET,
                merged_blob_path,
                merged_audio_path,
                "audio/wav"
            )
        
        merged_url = f"gs://{config.GCS_DUBBING_BUCKET}/{merged_blob_path}"
        
        logger.info(f"Job {job_id}: Merged audio uploaded with per-segment time-stretching")
        
        job_ref.update({
            "clonedAudioPath": merged_blob_path,
            "clonedAudioUrl": merged_url,
            "updatedAt": SERVER_TIMESTAMP
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
                "updatedAt": SERVER_TIMESTAMP
            })
        
        else:
            # Audio-only complete
            signed_url = generate_signed_url(config.GCS_DUBBING_BUCKET, merged_blob_path, 24)
            
            from firebase.credits import confirm_credit_deduction
            confirm_credit_deduction(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
            
            job_ref.update({
                "status": "completed",
                "step": "Dubbing complete!",
                "progress": 100,
                "finalMediaUrl": signed_url,
                "finalMediaPath": merged_blob_path,
                "updatedAt": SERVER_TIMESTAMP,
                "completedAt": SERVER_TIMESTAMP
            })
            
            logger.info(f"Job {job_id}: Audio dubbing complete")
        
        return {"success": True}, 200

    except Exception as e:
        error_msg = f"Audio merge failed: {str(e)}"
        logger.error(f"Job {job_id}: {error_msg}", exc_info=True)
        
        if is_final_attempt:
            update_job_retry_status(job_ref, retry_count, error_msg, True)
            from firebase.credits import release_credits
            release_credits(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
            return {"error": error_msg}, 500
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return {"error": "Retrying", "retry": retry_count}, 500
