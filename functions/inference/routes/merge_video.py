"""Video merging route with FFmpeg"""
import logging
import subprocess

from config import config
from firebase_admin import firestore
from utils.cleanup import temp_file
from utils.gcs_utils import download_to_file, upload_file_to_gcs, generate_signed_url
from utils.validators import validate_request, MergeRequest
from middleware import extract_job_info, get_job_document
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()


def merge_video_route():
    """Replace audio track in video with dubbed audio"""
    req = validate_request(MergeRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    
    logger.info(f"Job {job_id}: Starting video merge")
    
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
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
    confirm_credit_deduction(uid, job_id, job_data.get("cost", 0))
    
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