# functions/proxy/routes/dub_translate.py
"""
Enhanced dubbing translation route with validation and error handling.
"""
from firebase_functions import https_fn, options
from flask import Request, Response
import logging
import os
import uuid
from typing import Optional
from firebase.db import get_db
from google.cloud.firestore import SERVER_TIMESTAMP

from firebase.admin import get_current_user
from utils import ResponseBuilder
from utils.task_helper import create_cloud_task

logger = logging.getLogger(__name__)

# Supported languages for translation
SUPPORTED_LANGUAGES = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
}


def validate_translation_request(data: dict) -> tuple[bool, Optional[str]]:
    """
    Validate translation request data.
    
    Args:
        data: Request data
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    job_id = data.get("jobId")
    target_language = data.get("targetLanguage")
    
    if not job_id:
        return False, "Job ID is required"
    
    if not target_language:
        return False, "Target language is required"
    
    if target_language not in SUPPORTED_LANGUAGES:
        return False, f"Unsupported language: {target_language}. Supported: {', '.join(SUPPORTED_LANGUAGES.keys())}"
    
    return True, None


@https_fn.on_request(memory=options.MemoryOption.GB_1,
    timeout_sec=60,
    max_instances=10)
def dub_translate(req: Request) -> Response:
    """
    Start translation for dubbing job.
    Translates transcript segments to target language.
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Dubbing translate request received")

    db = get_db()

    
    # CORS
    if req.method == "OPTIONS":
        return Response(
            "",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
            }
        )
    
    if req.method != "POST":
        return Response(
            ResponseBuilder.error("Method not allowed", request_id=request_id),
            status=405,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Auth
    user = get_current_user(req)
    if not user:
        logger.warning(f"[{request_id}] Unauthorized request")
        return Response(
            ResponseBuilder.error("Unauthorized", request_id=request_id),
            status=401,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"[{request_id}] JSON parse error: {str(e)}")
        return Response(
            ResponseBuilder.error("Invalid JSON", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Validate request
    is_valid, error_msg = validate_translation_request(data)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return Response(
            ResponseBuilder.error(error_msg or "Invalid request", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    job_id = data.get("jobId")
    target_language = data.get("targetLanguage")

    if not isinstance(job_id, str) or not isinstance(target_language, str):
        return Response(
            ResponseBuilder.error("Invalid job ID or target language", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Get job document
    try:
        job_ref = db.collection("dubbingJobs").document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            logger.warning(f"[{request_id}] Job not found: {job_id}")
            return Response(
                ResponseBuilder.error("Job not found", request_id=request_id),
                status=404,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        job_data = job_doc.to_dict()

        if not job_data:
            logger.error(f"[{request_id}] Job data is None for {job_id}")
            return Response(
                ResponseBuilder.error("Job data not found", request_id=request_id),
                status=500,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        # Verify ownership
        if job_data.get("uid") != uid:
            logger.warning(f"[{request_id}] Unauthorized access attempt to job {job_id}")
            return Response(
                ResponseBuilder.error("Unauthorized", request_id=request_id),
                status=403,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        # Verify job status
        if job_data.get("status") not in ["transcribed", "speaker_clustered"]:
            return Response(
                ResponseBuilder.error(
                    f"Job not ready for translation. Current status: {job_data.get('status')}",
                    request_id=request_id
                ),
                status=400,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        transcript = job_data.get("transcript", [])
        
        if not transcript:
            return Response(
                ResponseBuilder.error("No transcript available", request_id=request_id),
                status=400,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to get job: {str(e)}")
        return Response(
            ResponseBuilder.error("Failed to retrieve job", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Update job status
    try:
        job_ref.update({
            "status": "translating",
            "step": f"Translating to {SUPPORTED_LANGUAGES[target_language]}...",
            "progress": 60,
            "targetLanguage": target_language,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(
            f"[{request_id}] Job {job_id}: Starting translation to {target_language}"
        )
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to update job: {str(e)}")
        return Response(
            ResponseBuilder.error("Failed to update job", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Queue translation task
    try:
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "target_language": target_language,
            "transcript": transcript,
            "request_id": request_id,
        }
        
        success, error = create_cloud_task(task_payload, endpoint="/translate-transcript")
        
        if not success:
            raise Exception(f"Task creation failed: {error}")
        
        logger.info(f"[{request_id}] Queued translation task for job {job_id}")
        
        return Response(
            ResponseBuilder.success({
                "jobId": job_id,
                "status": "translating",
                "targetLanguage": target_language,
                "message": "Translation started"
            }, request_id=request_id),
            status=202,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to queue translation: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue translation",
            "errorDetails": str(e),
            "updatedAt": SERVER_TIMESTAMP
        })
        
        return Response(
            ResponseBuilder.error("Failed to queue translation", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )