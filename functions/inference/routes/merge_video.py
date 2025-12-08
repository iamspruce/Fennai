# functions/inference/routes/merge_video.py
import os
import logging
import tempfile
import subprocess
from datetime import timedelta
from google.cloud import storage
from firebase_admin import firestore

logger = logging.getLogger(__name__)
db = firestore.client()
storage_client = storage.Client()

GCS_DUBBING_BUCKET = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")


def merge_video_route(request):
    """
    Replace audio track in video with dubbed audio using FFmpeg
    """
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized merge-video request")
        return {"error": "Unauthorized"}, 403
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    
    if not all([job_id, uid]):
        return {"error": "Missing required fields"}, 400
    
    logger.info(f"Job {job_id}: Starting video merge")
    
    # Get job document
    job_ref = db.collection("dubbingJobs").document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        return {"error": "Job not found"}, 404
    
    job_data = job_doc.to_dict()
    original_media_path = job_data.get("originalMediaPath")
    cloned_audio_path = job_data.get("clonedAudioPath")
    
    if not original_media_path or not cloned_audio_path:
        return {"error": "Missing media paths"}, 400
    
    try:
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        
        # Download original video
        video_blob = bucket.blob(original_media_path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_video:
            video_blob.download_to_filename(tmp_video.name)
            video_path = tmp_video.name
        
        # Download dubbed audio
        audio_blob = bucket.blob(cloned_audio_path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_audio:
            audio_blob.download_to_filename(tmp_audio.name)
            audio_path = tmp_audio.name
        
        # Output path
        output_path = tempfile.mktemp(suffix=".mp4")
        
        # FFmpeg command to replace audio
        # -c:v copy = copy video codec without re-encoding (fast)
        # -map 0:v:0 = take video from input 0
        # -map 1:a:0 = take audio from input 1
        # -shortest = cut to shortest stream duration
        cmd = [
            "ffmpeg",
            "-i", video_path,  # Input 0: original video
            "-i", audio_path,  # Input 1: dubbed audio
            "-c:v", "copy",    # Copy video codec
            "-map", "0:v:0",   # Map video from input 0
            "-map", "1:a:0",   # Map audio from input 1
            "-shortest",       # Match shortest stream
            "-y",              # Overwrite output
            output_path
        ]
        
        logger.info(f"Job {job_id}: Running FFmpeg: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600  # 10 minutes timeout
        )
        
        if result.returncode != 0:
            error_msg = result.stderr.decode('utf-8')
            raise RuntimeError(f"FFmpeg failed: {error_msg}")
        
        # Upload final video to GCS
        final_blob_path = f"jobs/{job_id}/dubbed_video.mp4"
        final_blob = bucket.blob(final_blob_path)
        final_blob.upload_from_filename(output_path, content_type="video/mp4")
        
        # Generate signed URL
        signed_url = final_blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=24),
            method="GET",
        )
        
        logger.info(f"Job {job_id}: Video merge complete, uploaded to {final_blob_path}")
        
        # Clean up temp files
        os.unlink(video_path)
        os.unlink(audio_path)
        os.unlink(output_path)
        
        # Confirm credits
        from shared.credits import confirm_credit_deduction
        confirm_credit_deduction(uid, job_id, job_data.get("cost", 0))
        
        # Update job as completed
        job_ref.update({
            "status": "completed",
            "step": "Video dubbing complete!",
            "progress": 100,
            "finalMediaUrl": signed_url,
            "finalMediaPath": final_blob_path,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "completedAt": firestore.SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Video dubbing complete")
        
        return {"success": True, "url": signed_url}, 200
        
    except subprocess.TimeoutExpired:
        logger.error(f"Job {job_id}: FFmpeg timeout")
        
        job_ref.update({
            "status": "failed",
            "error": "Video processing timeout",
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Video processing timeout"}, 500
        
    except Exception as e:
        logger.error(f"Job {job_id}: Video merge failed: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Video merge failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Video merge failed"}, 500