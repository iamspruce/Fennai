"""Video merging route with FFmpeg"""
import logging
import subprocess

from config import config
from firebase_admin import firestore
from utils.cleanup import temp_file
from utils.gcs_utils import download_to_file, upload_file_to_gcs, generate_signed_url
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


def merge_video_route():
    """Replace audio track in video with dubbed audio"""
    # Get retry info
    retry_count, is_retry, is_final_attempt = get_retry_info()
    
    if is_retry:
        logger.info(f"🔄 Retry attempt {retry_count}/{config.MAX_RETRY_ATTEMPTS} for merge_video")

    # Validate request
    try:
        req = validate_request(MergeRequest, extract_job_info()[2])
    except Exception as e:
        return {"error": "Invalid request", "details": str(e)}, 400
        
    job_id = req.job_id
    uid = req.uid
    
    logger.info(f"Job {job_id}: Starting video merge")
    
    # Get job document
    try:
        job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    except Exception as e:
        logger.error(f"Job {job_id} not found: {str(e)}")
        return {"error": "Job not found"}, 404

    try:
        original_media_path = job_data.get("originalMediaPath")
        cloned_audio_path = job_data.get("clonedAudioPath")
        
        if not original_media_path or not cloned_audio_path:
            raise ValueError("Missing media paths")
        
        with temp_file(".mp4") as video_path, \
             temp_file(".wav") as audio_path, \
             temp_file(".mp4") as output_path:
            
            # Download files
            download_to_file(config.GCS_DUBBING_BUCKET, original_media_path, video_path)
            download_to_file(config.GCS_DUBBING_BUCKET, cloned_audio_path, audio_path)
            
            # FFmpeg command
            cmd = [
                "ffmpeg",
                "-i", video_path,
                "-i", audio_path,
                "-c:v", "copy",
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-shortest",
                "-y",
                output_path
            ]
            
            logger.info(f"Job {job_id}: Running FFmpeg")
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=config.FFMPEG_TIMEOUT,
                check=True
            )
            
            # Upload final video
            final_blob_path = f"jobs/{job_id}/dubbed_video.mp4"
            upload_file_to_gcs(
                config.GCS_DUBBING_BUCKET,
                final_blob_path,
                output_path,
                "video/mp4"
            )
        
        signed_url = generate_signed_url(config.GCS_DUBBING_BUCKET, final_blob_path, 24)
        
        logger.info(f"Job {job_id}: Video merge complete")
        
        # Confirm credits
        from firebase.credits import confirm_credit_deduction
        confirm_credit_deduction(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
        
        job_ref.update({
            "status": "completed",
            "step": "Video dubbing complete!",
            "progress": 100,
            "finalMediaUrl": signed_url,
            "finalMediaPath": final_blob_path,
            "updatedAt": SERVER_TIMESTAMP,
            "completedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Video dubbing complete")
        
        return {"success": True, "url": signed_url}, 200

    except Exception as e:
        error_msg = f"Video merge failed: {str(e)}"
        logger.error(f"Job {job_id}: {error_msg}", exc_info=True)
        
        if is_final_attempt:
            update_job_retry_status(job_ref, retry_count, error_msg, True)
            from firebase.credits import release_credits
            release_credits(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
            return {"error": error_msg}, 500
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return {"error": "Retrying", "retry": retry_count}, 500