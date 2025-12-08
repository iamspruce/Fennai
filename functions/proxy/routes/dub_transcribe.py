# functions/proxy/routes/dub_transcribe.py
from firebase_functions import https_fn, logger
from firebase_admin import firestore
import os
import json
import base64
import uuid
from datetime import datetime, timedelta
from google.cloud import tasks_v2, storage

from firebase.admin import get_current_user
from firebase.credits import reserve_credits

# Environment
CLOUD_RUN_URL = os.environ.get("CLOUD_RUN_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")
GCP_PROJECT = os.environ.get("GCP_PROJECT", "fennai")
QUEUE_LOCATION = os.environ.get("QUEUE_LOCATION", "us-central1")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "voice-generation-queue")
SERVICE_ACCOUNT = os.environ.get("SERVICE_ACCOUNT_EMAIL")
GCS_DUBBING_BUCKET = os.environ.get("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")

tasks_client = tasks_v2.CloudTasksClient()
queue_path = tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)
storage_client = storage.Client()
db = firestore.client()

# Upload limits per tier
UPLOAD_LIMITS = {
    'free': {'maxDurationSeconds': 120, 'maxFileSizeMB': 100},
    'pro': {'maxDurationSeconds': 1800, 'maxFileSizeMB': 2048},
    'enterprise': {'maxDurationSeconds': float('inf'), 'maxFileSizeMB': float('inf')}
}

def calculate_dubbing_cost(duration_seconds: float, has_translation: bool, is_video: bool) -> int:
    """Calculate credits based on duration"""
    base_credits = max(1, int(duration_seconds / 10))  # 1 credit per 10 seconds
    translation_multiplier = 1.5 if has_translation else 1.0
    video_multiplier = 1.2 if is_video else 1.0
    return max(1, int(base_credits * translation_multiplier * video_multiplier))


@https_fn.on_request()
def dub_transcribe(req: https_fn.Request) -> https_fn.Response:
    """
    Initiate dubbing job:
    1. Validate media file
    2. Reserve credits
    3. Upload to GCS
    4. Queue transcription task
    """
    
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
            {"error": "Method not allowed"},
            status=405,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Auth
    user = get_current_user(req)
    if not user:
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    user_doc = db.collection("users").document(uid).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    is_pro = user_data.get("isPro", False)
    tier = 'enterprise' if user_data.get("isEnterprise", False) else ('pro' if is_pro else 'free')
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception:
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    media_base64 = data.get("mediaData")  # Base64 encoded media
    media_type = data.get("mediaType", "audio")  # 'audio' or 'video'
    file_name = data.get("fileName", "media")
    duration = float(data.get("duration", 0))
    file_size_mb = float(data.get("fileSizeMB", 0))
    detected_language = data.get("detectedLanguage")
    other_languages = data.get("otherLanguages", [])
    
    if not media_base64 or duration <= 0:
        return https_fn.Response(
            {"error": "Invalid media data or duration"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Validate limits
    limits = UPLOAD_LIMITS[tier]
    if duration > limits['maxDurationSeconds']:
        return https_fn.Response(
            {"error": f"Duration exceeds {tier} tier limit of {limits['maxDurationSeconds']}s"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    if file_size_mb > limits['maxFileSizeMB']:
        return https_fn.Response(
            {"error": f"File size exceeds {tier} tier limit of {limits['maxFileSizeMB']}MB"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost (no translation yet, will recalculate if user adds translation)
    cost = calculate_dubbing_cost(duration, False, media_type == 'video')
    job_id = str(uuid.uuid4())
    
    logger.info(f"Creating dubbing job {job_id} for user {uid}, duration={duration}s, cost={cost}")
    
    # Reserve credits
    job_data = {
        "mediaType": media_type,
        "duration": duration,
        "fileSize": file_size_mb,
        "detectedLanguage": detected_language,
    }
    
    success, error_msg = reserve_credits(uid, job_id, cost, job_data)
    if not success:
        logger.warn(f"Credit reservation failed for {uid}: {error_msg}")
        return https_fn.Response(
            {"error": error_msg or "Insufficient credits"},
            status=402,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Upload media to GCS
    try:
        media_bytes = base64.b64decode(media_base64)
        extension = 'mp4' if media_type == 'video' else 'wav'
        blob_path = f"jobs/{job_id}/original.{extension}"
        
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        blob = bucket.blob(blob_path)
        content_type = 'video/mp4' if media_type == 'video' else 'audio/wav'
        blob.upload_from_string(media_bytes, content_type=content_type)
        
        logger.info(f"Uploaded media to gs://{GCS_DUBBING_BUCKET}/{blob_path}")
        
    except Exception as e:
        logger.error(f"Failed to upload media: {str(e)}")
        # Release reserved credits
        from firebase.credits import release_credits
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            {"error": "Failed to upload media"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
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
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "expiresAt": datetime.utcnow() + timedelta(days=7),
        }
        job_ref.set(job_doc)
        
    except Exception as e:
        logger.error(f"Failed to create job document: {str(e)}")
        from firebase.credits import release_credits
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            {"error": "Failed to create job"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Queue Cloud Task for audio extraction & transcription
    try:
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "media_path": blob_path,
            "media_type": media_type,
        }
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{CLOUD_RUN_URL}/extract-audio",
                "headers": {
                    "Content-Type": "application/json",
                    "X-Internal-Token": INTERNAL_TOKEN,
                },
                "body": base64.b64encode(
                    json.dumps(task_payload).encode()
                ).decode(),
            },
            "dispatch_deadline": {"seconds": 1800},  # 30 minutes
        }
        
        if SERVICE_ACCOUNT:
            task["http_request"]["oidc_token"] = {
                "service_account_email": SERVICE_ACCOUNT
            }
        
        response = tasks_client.create_task(
            request={"parent": queue_path, "task": task}
        )
        
        logger.info(f"Queued transcription task: {response.name}")
        
    except Exception as e:
        logger.error(f"Failed to queue task: {str(e)}")
        
        # Update job as failed
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue transcription",
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from firebase.credits import release_credits
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            {"error": "Failed to queue transcription"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Return job ID
    logger.info(f"Dubbing job {job_id} created successfully")
    return https_fn.Response(
        {
            "job_id": job_id,
            "status": "uploading",
            "message": "Dubbing job queued successfully"
        },
        status=202,
        headers={
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    )