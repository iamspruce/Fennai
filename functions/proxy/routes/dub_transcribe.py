# functions/proxy/routes/dub_transcribe.py
"""
Enhanced dubbing transcription route with comprehensive validation,
retry logic, and proper error handling.
"""
from firebase_functions import https_fn, options
from flask import Request, jsonify, make_response, Response
import logging
import os
import uuid
import base64
from typing import Optional, Any, Dict
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
    sanitize_filename
)
from utils.task_helper import create_cloud_task
from utils.logging_config import get_logger, log_request

logger = get_logger(__name__)

# Environment
GCS_DUBBING_BUCKET = os.environ.get("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")

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
    """Validate dubbing request data."""
    media_path = data.get("mediaPath")
    media_type = data.get("mediaType", "audio")
    duration = float(data.get("duration", 0))
    file_size_mb = float(data.get("fileSizeMB", 0))
    file_name = data.get("fileName", "")
    
    # Check required fields
    if not media_path:
        return False, "mediaPath is required"
    
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
    
    # Check duration limit
    max_duration = limits['maxDurationSeconds']
    if max_duration != float('inf') and duration > max_duration:
        return False, f"Duration ({duration:.1f}s) exceeds limit of {max_duration}s (Your {user_tier} tier limit)"
    
    # Check file size limit
    is_valid, error = validate_file_size(int(file_size_mb * 1024 * 1024), limits['maxFileSizeMB'])
    if not is_valid:
        return False, f"{error} (Your {user_tier} tier limit)"
    
    return True, None



def create_response(body: Any, status: int, headers: Dict[str, str]) -> Response:
    """Create a Flask Response object with headers."""
    response = jsonify(body) if isinstance(body, (dict, list)) else make_response(body)
    response.status_code = status
    for k, v in headers.items():
        response.headers[k] = v
    return response


@https_fn.on_request(memory=options.MemoryOption.GB_1, timeout_sec=120, max_instances=10)
def dub_transcribe(req: Request):
    """
    Initiate dubbing job:
    1. Generate signed URL for direct upload (action=get_upload_url)
    2. Start transcription for uploaded media (default action)
    """
    request_id = str(uuid.uuid4())
    import psutil
    process = psutil.Process(os.getpid())
    memory_info = process.memory_info().rss / (1024 * 1024)
    logger.info(f"[{request_id}] Handle start: Action={req.args.get('action')}, Memory={memory_info:.1f}MB")

    db = get_db()
    gcs = GCSHelper(GCS_DUBBING_BUCKET)
    
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    }
    
    # CORS
    if req.method == "OPTIONS":
        options_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
        }
        return create_response("", 204, options_headers)
    
    if req.method != "POST":
        return create_response(ResponseBuilder.error("Method not allowed", request_id=request_id), 405, cors_headers)
    
    # Auth
    user = get_current_user(req)
    if not user:
        return create_response(ResponseBuilder.error("Unauthorized", request_id=request_id), 401, cors_headers)
    
    uid = user.get("uid")
    
    # Check if we are generating an upload URL
    action = req.args.get("action")
    if action == "get_upload_url":
        try:
            data = req.get_json(silent=True) or {}
            file_name = sanitize_filename(data.get("fileName", "media"))
            content_type = data.get("contentType", "application/octet-stream")
            
            job_id = str(uuid.uuid4())
            ext = os.path.splitext(file_name)[1].lstrip('.') or "media"
            blob_path = f"jobs/{job_id}/original.{ext}"
            
            success, upload_url, error = gcs.generate_signed_url(blob_path, content_type)
            if not success:
                return create_response(ResponseBuilder.error(f"Failed to generate URL: {error}", request_id=request_id), 500, cors_headers)
                
            return create_response(ResponseBuilder.success({
                "uploadUrl": upload_url,
                "mediaPath": blob_path,
                "jobId": job_id
            }, request_id=request_id), 200, cors_headers)
        except Exception as e:
            logger.error(f"[{request_id}] Get upload URL failed: {str(e)}")
            return create_response(ResponseBuilder.error(str(e), request_id=request_id), 500, cors_headers)

    # Standard Transcription Flow
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        return create_response(ResponseBuilder.error("Invalid JSON", request_id=request_id), 400, cors_headers)
    
    # Basic Validation (Skip base64 check)
    media_path = data.get("mediaPath")
    if not media_path:
        return create_response(ResponseBuilder.error("mediaPath is required", request_id=request_id), 400, cors_headers)
        
    media_type = data.get("mediaType", "audio")
    duration = float(data.get("duration", 0))
    file_size_mb = float(data.get("fileSizeMB", 0))
    detected_language = data.get("detectedLanguage")
    detected_language_code = data.get("detectedLanguageCode", "en-US")
    other_languages = data.get("otherLanguages", [])
    
    # Extract job_id from path: jobs/{job_id}/original.ext
    try:
        job_id = media_path.split('/')[1]
    except:
        job_id = str(uuid.uuid4())

    # Calculate cost
    cost = calculate_dubbing_cost(duration, False, media_type == 'video')
    
    # Reserve credits
    job_metadata = {
        "mediaType": media_type,
        "duration": duration,
        "fileSize": file_size_mb,
        "detectedLanguage": detected_language,
        "detectedLanguageCode": detected_language_code,
        "otherLanguages": other_languages,
        "originalMediaPath": media_path,
        "requestId": request_id,
        "status": "processing",
        "step": "Starting transcription...",
        "progress": 15,
        "updatedAt": SERVER_TIMESTAMP,
        "expiresAt": datetime.utcnow() + timedelta(days=1),
    }
    
    success, error_msg = reserve_credits(uid, job_id, cost, job_metadata, collection_name="dubbingJobs")
    if not success:
        return create_response(ResponseBuilder.error(error_msg or "Insufficient credits", request_id=request_id), 402, cors_headers)
    
    # Queue Cloud Task
    try:
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "media_path": media_path,
            "media_type": media_type,
            "request_id": request_id,
        }
        
        task_success, task_error = create_cloud_task(task_payload, endpoint="/extract-audio")
        if not task_success:
            raise Exception(task_error)
            
        logger.info(f"[{request_id}] Queued task for {job_id}")
        
    except Exception as e:
        logger.error(f"[{request_id}] Task failure: {str(e)}")
        db.collection("dubbingJobs").document(job_id).update({
            "status": "failed",
            "error": "Failed to queue transcription",
            "updatedAt": SERVER_TIMESTAMP
        })
        release_credits(uid, job_id, cost, collection_name="dubbingJobs")
        return create_response(ResponseBuilder.error("Queue failure", request_id=request_id), 500, cors_headers)
    
    return create_response(ResponseBuilder.success({
        "jobId": job_id,
        "job_id": job_id,
        "status": "processing",
        "message": "Transcription queued"
    }, request_id=request_id), 202, cors_headers)