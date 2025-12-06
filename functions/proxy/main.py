# functions/proxy/main.py
from firebase_functions import https_fn, logger
from firebase_admin import firestore
import os
import json
import base64
import uuid
from datetime import datetime
from google.cloud import tasks_v2
from dotenv import load_dotenv

load_dotenv()

from shared.firebase import get_current_user
from shared.credits import reserve_credits, calculate_cost

# Environment variables
CLOUD_RUN_URL = os.environ.get("CLOUD_RUN_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")
GCP_PROJECT = os.environ.get("GCP_PROJECT", "fennai")
QUEUE_LOCATION = os.environ.get("QUEUE_LOCATION", "us-central1")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "voice-generation-queue")
SERVICE_ACCOUNT = os.environ.get("SERVICE_ACCOUNT_EMAIL")

# Initialize Cloud Tasks client
tasks_client = tasks_v2.CloudTasksClient()
queue_path = tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)

@https_fn.on_request()
def voice_clone(req: https_fn.Request) -> https_fn.Response:
    """
    Proxy function that:
    1. Authenticates user
    2. Reserves credits atomically
    3. Creates Firestore job document
    4. Enqueues Cloud Task for async processing
    5. Returns immediately with job_id
    """
    
    # Health check endpoint
    if req.path == "/health" or req.path.endswith("/health"):
        logger.info("Health check requested")
        return https_fn.Response(
            {"status": "healthy", "service": "voice-clone-proxy"},
            status=200,
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        )
    
    logger.info(f"Request received. Method: {req.method}")

    # Handle CORS preflight
    if req.method == "OPTIONS":
        return https_fn.Response(
            "",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Max-Age": "3600"
            }
        )
    
    if req.method != "POST":
        logger.warn(f"Method not allowed: {req.method}")
        return https_fn.Response(
            {"error": "Method not allowed"},
            status=405,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Authenticate user
    logger.info("Attempting to authenticate user...")
    user = get_current_user(req)
    
    if not user:
        logger.warn("Returning 401 Unauthorized")
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    logger.info(f"User authenticated successfully: {uid}")

    # Parse request data
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"JSON Parse error: {str(e)}")
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    text = data.get("text", "").strip()
    voice_samples = data.get("voice_samples", [])
    character_texts = data.get("character_texts")
    
    # Validate required fields
    if not text or not voice_samples:
        logger.warn(f"Missing fields for user {uid}. Text len: {len(text)}, Samples: {len(voice_samples)}")
        return https_fn.Response(
            {"error": "Missing text or voice_samples"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check if inference service is configured
    if not CLOUD_RUN_URL or not INTERNAL_TOKEN:
        logger.error("Environment Configuration Error: Missing CLOUD_RUN_URL or INTERNAL_TOKEN")
        return https_fn.Response(
            {"error": "Inference service not configured"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost
    cost = calculate_cost(character_texts)
    job_id = str(uuid.uuid4())
    
    logger.info(f"Creating job {job_id} for user {uid} with cost {cost}")
    
    # Reserve credits and create job document atomically
    try:
        success, error_msg = reserve_credits(uid, job_id, cost, data)
        if not success:
            logger.warn(f"Credit reservation failed for {uid}: {error_msg}")
            return https_fn.Response(
                {"error": error_msg or "Insufficient credits"},
                status=402,
                headers={"Access-Control-Allow-Origin": "*"}
            )
    except Exception as e:
        logger.error(f"Error during credit reservation: {str(e)}")
        return https_fn.Response(
            {"error": f"Credit reservation failed: {str(e)}"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Prepare payload for Cloud Run
    task_payload = {
        "job_id": job_id,
        "uid": uid,
        "cost": cost,
        "text": text,
        "voice_samples": voice_samples,
    }
    
    if character_texts:
        task_payload["character_texts"] = character_texts
    
    # Create Cloud Task
    try:
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{CLOUD_RUN_URL}/inference",
                "headers": {
                    "Content-Type": "application/json",
                    "X-Internal-Token": INTERNAL_TOKEN,
                },
                "body": base64.b64encode(
                    json.dumps(task_payload).encode()
                ).decode(),
            },
            "dispatch_deadline": {"seconds": 900},  # 15 minutes max
        }
        
        # Add OIDC token for authenticated Cloud Run
        if SERVICE_ACCOUNT:
            task["http_request"]["oidc_token"] = {
                "service_account_email": SERVICE_ACCOUNT
            }
        
        # Configure retries (only for 5xx errors)
        task["retry_config"] = {
            "max_attempts": 3,
            "max_retry_duration": {"seconds": 1800},  # 30 minutes total
            "min_backoff": {"seconds": 10},
            "max_backoff": {"seconds": 300},
            "max_doublings": 3,
        }
        
        response = tasks_client.create_task(
            request={"parent": queue_path, "task": task}
        )
        
        logger.info(f"Task created: {response.name}")
        
    except Exception as e:
        logger.error(f"Failed to create Cloud Task: {str(e)}")
        
        # Rollback: Release reserved credits
        from shared.credits import release_credits
        release_credits(uid, job_id, cost)
        
        return https_fn.Response(
            {"error": "Failed to queue generation task"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Return immediately with job_id
    logger.info(f"Job {job_id} queued successfully for user {uid}")
    return https_fn.Response(
        {
            "job_id": job_id,
            "status": "queued",
            "message": "Voice generation queued successfully"
        },
        status=202,  # Accepted
        headers={
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    )