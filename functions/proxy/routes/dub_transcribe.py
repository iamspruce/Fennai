# functions/proxy/routes/dub_transcribe.py
"""
Enhanced dubbing transcription route with comprehensive validation,
retry logic, and proper error handling.
"""
from firebase_functions import https_fn
import logging
import os
import uuid
import base64
from typing import Optional
from datetime import datetime, timedelta
from firebase.db import get_db
from google.cloud.firestore import SERVER_TIMESTAMP

from firebase.admin import get_current_user
from firebase.credits import reserve_credits, release_credits, calculate_dubbing_cost
from utils import (
    UPLOAD_LIMITS,
    ResponseBuilder,
    GCSHelper,
    validate_file_size,
    validate_duration,
    sanitize_filename
)
from utils.task_helper import create_cloud_task

logger = logging.getLogger(__name__)

# Environment
GCS_DUBBING_BUCKET = os.environ.get("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")

# ✅ REMOVED: Global GCS initialization
# OLD: gcs = GCSHelper(GCS_DUBBING_BUCKET)

# Constants
MAX_BASE64_SIZE = 500 * 1024 * 1024  # 500MB in bytes
SUPPORTED_AUDIO_FORMATS = ['.wav', '.mp3', '.m4a', '.flac']
SUPPORTED_VIDEO_FORMATS = ['.mp4', '.mov', '.avi', '.mkv']


def get_user_tier(user_data: Optional[dict]) -> str:
    """Determine user tier."""
    if not user_data:
        return 'free'
        
    if user_data.get("isEnterprise", False):
        return 'enterprise'
    elif user_data.get("isPro", False):
        return 'pro'
    return 'free'


def validate_dubbing_request(data: dict, user_tier: str) -> tuple[bool, Optional[str]]:
    """
    Validate dubbing request data.
    
    Args:
        data: Request data
        user_tier: User's subscription tier
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    media_base64 = data.get("mediaData")
    media_type = data.get("mediaType", "audio")
    duration = float(data.get("duration", 0))
    file_size_mb = float(data.get("fileSizeMB", 0))
    file_name = data.get("fileName", "")
    
    # Check required fields
    if not media_base64:
        return False, "Media data is required"
    
    if duration <= 0:
        return False, "Invalid duration"
    
    if media_type not in ["audio", "video"]:
        return False, "Invalid media type. Must be 'audio' or 'video'"
    
    # Validate file extension
    if file_name:
        ext = os.path.splitext(file_name.lower())[1]
        valid_formats = SUPPORTED_VIDEO_FORMATS if media_type == "video" else SUPPORTED_AUDIO_FORMATS
        if ext not in valid_formats:
            return False, f"Unsupported file format: {ext}"
    
    # Validate tier limits
    limits = UPLOAD_LIMITS[user_tier]
    
    # ✅ FIX #2: Check duration limit (handles infinity)
    max_duration = limits['maxDurationSeconds']
    if max_duration != float('inf') and duration > max_duration:
        return False, f"Duration ({duration:.1f}s) exceeds limit of {max_duration}s (Your {user_tier} tier limit)"
    
    # Check file size limit
    is_valid, error = validate_file_size(int(file_size_mb * 1024 * 1024), limits['maxFileSizeMB'])
    if not is_valid:
        return False, f"{error} (Your {user_tier} tier limit)"
    
    # Validate base64 size
    if len(media_base64) > MAX_BASE64_SIZE:
        return False, "Media data too large"
    
    return True, None


@https_fn.on_request()
def dub_transcribe(req: https_fn.Request) -> https_fn.Response:
    """
    Initiate dubbing job:
    1. Validate media file
    2. Reserve credits
    3. Upload to GCS
    4. Queue transcription task
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Dubbing transcribe request received")

    db = get_db()
    # ✅ FIX #1: Lazy GCS initialization - only create when needed
    gcs = GCSHelper(GCS_DUBBING_BUCKET)
    
    # CORS
    if req.method == "OPTIONS":
        return https_fn.Response(
            "",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
            }
        )
    
    if req.method != "POST":
        return https_fn.Response(
            ResponseBuilder.error("Method not allowed", request_id=request_id),
            status=405,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Auth
    user = get_current_user(req)
    if not user:
        logger.warning(f"[{request_id}] Unauthorized request")
        return https_fn.Response(
            ResponseBuilder.error("Unauthorized", request_id=request_id),
            status=401,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    if not uid:
        logger.warning(f"[{request_id}] User missing UID")
        return https_fn.Response(
            ResponseBuilder.error("Unauthorized", request_id=request_id),
            status=401,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Get user tier
    user_doc = db.collection("users").document(uid).get()
    user_data = user_doc.to_dict() or {}
    user_tier = get_user_tier(user_data)
    
    logger.info(f"[{request_id}] User tier: {user_tier}")
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"[{request_id}] JSON parse error: {str(e)}")
        return https_fn.Response(
            ResponseBuilder.error("Invalid JSON", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Validate request
    is_valid, error_msg = validate_dubbing_request(data, user_tier)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return https_fn.Response(
            ResponseBuilder.error(error_msg or "Validation failed", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Extract parameters
    media_base64 = str(data.get("mediaData", ""))
    media_type = data.get("mediaType", "audio")
    file_name = sanitize_filename(data.get("fileName", "media"))
    duration = float(data.get("duration", 0))
    file_size_mb = float(data.get("fileSizeMB", 0))
    detected_language = data.get("detectedLanguage")
    other_languages = data.get("otherLanguages", [])
    
    # Calculate cost (no translation yet)
    cost = calculate_dubbing_cost(duration, False, media_type == 'video')
    job_id = str(uuid.uuid4())
    
    logger.info(
        f"[{request_id}] Creating dubbing job {job_id}: duration={duration}s, "
        f"cost={cost}, type={media_type}"
    )
    
    # Reserve credits
    job_data = {
        "mediaType": media_type,
        "duration": duration,
        "fileSize": file_size_mb,
        "detectedLanguage": detected_language,
    }
    
    success, error_msg = reserve_credits(uid, job_id, cost, job_data)
    if not success:
        logger.warning(f"[{request_id}] Credit reservation failed: {error_msg}")
        return https_fn.Response(
            ResponseBuilder.error(error_msg or "Insufficient credits", request_id=request_id),
            status=402,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Upload media to GCS
    try:
        import tempfile
        
        media_bytes = base64.b64decode(media_base64)
        extension = 'mp4' if media_type == 'video' else 'wav'
        blob_path = f"jobs/{job_id}/original.{extension}"
        
        # Write to temp file and upload
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{extension}") as tmp:
            tmp.write(media_bytes)
            tmp_path = tmp.name
        
        content_type = 'video/mp4' if media_type == 'video' else 'audio/wav'
        success, error = gcs.upload_file(tmp_path, blob_path, content_type)
        
        # Cleanup temp file
        os.unlink(tmp_path)
        
        if not success:
            raise Exception(f"GCS upload failed: {error}")
        
        logger.info(f"[{request_id}] Uploaded media to gs://{GCS_DUBBING_BUCKET}/{blob_path}")
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to upload media: {str(e)}")
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            ResponseBuilder.error("Failed to upload media", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Create Firestore job document
    try:
        job_ref = db.collection("dubbingJobs").document(job_id)
        job_doc = {
            "uid": uid,
            "status": "uploading",
            "step": "Uploading media to cloud storage...",
            "progress": 5,
            "mediaType": media_type,
            "originalMediaPath": blob_path,
            "duration": duration,
            "fileSize": file_size_mb,
            "detectedLanguage": detected_language,
            "otherLanguages": other_languages,
            "cost": cost,
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
            "expiresAt": datetime.utcnow() + timedelta(days=7),
            "requestId": request_id,
        }
        job_ref.set(job_doc)
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to create job document: {str(e)}")
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            ResponseBuilder.error("Failed to create job", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Queue Cloud Task for audio extraction & transcription
    try:
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "media_path": blob_path,
            "media_type": media_type,
            "request_id": request_id,
        }
        
        success, error = create_cloud_task(task_payload, endpoint="/extract-audio")
        
        if not success:
            raise Exception(f"Task creation failed: {error}")
        
        logger.info(f"[{request_id}] Queued transcription task for job {job_id}")
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to queue task: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue transcription",
            "updatedAt": SERVER_TIMESTAMP
        })
        
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            ResponseBuilder.error("Failed to queue transcription", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Return job ID
    logger.info(f"[{request_id}] Dubbing job {job_id} created successfully")
    
    return https_fn.Response(
        ResponseBuilder.success({
            "jobId": job_id,
            "status": "uploading",
            "message": "Dubbing job queued successfully"
        }, request_id=request_id),
        status=202,
        headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
    )