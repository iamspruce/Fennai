# functions/inference/middleware.py
"""
Flask middleware and decorators for authentication, validation, and error handling.
Eliminates code duplication across routes.
"""
import secrets
import logging
import traceback
from functools import wraps
from typing import Callable, Optional, Tuple, Any
from flask import request, abort, jsonify, g, Request
from google.cloud.firestore import SERVER_TIMESTAMP
from config import config
from firebase_admin import firestore


logger = logging.getLogger(__name__)
_db = None

# Explicitly export public functions for type checkers
__all__ = [
    'get_db',
    'require_internal_token',
    'validate_payload_size',
    'handle_job_errors',
    'extract_job_info',
    'validate_required_fields',
    'log_request_info',
    'get_job_document',
    'update_job_status',
    'get_retry_info',
    'update_job_retry_status',
]

def get_db():
    """Lazy load Firestore client"""
    global _db
    if _db is None:
        _db = firestore.client()
    return _db


def require_internal_token(f: Callable) -> Callable:
    """
    Decorator to validate internal token for service-to-service calls.
    Uses timing-safe comparison to prevent timing attacks.
    
    Usage:
        @app.route("/internal-endpoint", methods=["POST"])
        @require_internal_token
        def internal_endpoint():
            return {"success": True}
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get("X-Internal-Token")
        expected = config.INTERNAL_TOKEN
        
        if not token or not expected:
            logger.warning(f"Missing token from {request.remote_addr}")
            abort(403, "Unauthorized")
        
        # Timing-safe comparison
        if not secrets.compare_digest(token, expected):
            logger.warning(f"Invalid token from {request.remote_addr}")
            abort(403, "Unauthorized")
        
        return f(*args, **kwargs)
    
    return decorated_function


def validate_payload_size(f: Callable) -> Callable:
    """
    Decorator to validate request payload size.
    
    Usage:
        @app.route("/upload", methods=["POST"])
        @validate_payload_size
        def upload():
            return {"success": True}
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.content_length and request.content_length > config.MAX_PAYLOAD_SIZE:
            logger.warning(f"Payload too large: {request.content_length} bytes")
            abort(413, "Payload too large")
        return f(*args, **kwargs)
    
    return decorated_function


def handle_job_errors(collection: str = "voiceJobs", release_credits: bool = True) -> Callable:
    """
    Decorator to standardize error handling for job-based routes.
    Automatically updates job status and releases credits on failure.
    
    Args:
        collection: Firestore collection name
        release_credits: Whether to release credits on error
    
    Usage:
        @app.route("/process", methods=["POST"])
        @require_internal_token
        @handle_job_errors(collection="dubbingJobs")
        def process():
            # Your logic here
            return {"success": True}, 200
    """
    def decorator(f: Callable) -> Callable:
        @wraps(f)
        def wrapper(*args, **kwargs):
            # Extract job info from request
            data = request.get_json(silent=True) or {}
            job_id = data.get("job_id")
            uid = data.get("uid")
            
            # Set job_id for logging
            if job_id:
                g.job_id = job_id
            
            try:
                return f(*args, **kwargs)
            
            except Exception as e:
                logger.error(
                    f"Job {job_id}: {f.__name__} failed",
                    exc_info=True,
                    extra={
                        'job_id': job_id,
                        'uid': uid,
                        'error_type': type(e).__name__
                    }
                )
                
                # Update job status
                if job_id:
                    try:
                        job_ref = get_db().collection(collection).document(job_id)
                        job_ref.update({
                            "status": "failed",
                            "error": str(e),
                            "errorDetails": traceback.format_exc()[:1000],  # Limit size
                            "updatedAt": SERVER_TIMESTAMP
                        })
                    except Exception as update_error:
                        logger.error(f"Failed to update job status: {update_error}")
                
                # Release credits if needed
                if release_credits and uid and job_id:
                    try:
                        from firebase.credits import release_credits as release_credits_func
                        
                        job_ref = get_db().collection(collection).document(job_id)
                        job_doc = job_ref.get()
                        
                        if job_doc.exists:
                            data = job_doc.to_dict() or {}
                            cost = data.get("cost", 0)
                            if cost > 0:
                                release_credits_func(uid, job_id, cost, collection_name=collection)
                    except Exception as credit_error:
                        logger.error(f"Failed to release credits: {credit_error}")
                
                # Return error response
                # Return 200 to prevent Cloud Tasks from retrying since we handled the error
                return jsonify({"error": "Job failed", "details": str(e)}), 200
        
        return wrapper
    return decorator


def extract_job_info() -> Tuple[Optional[str], Optional[str], dict]:
    """
    Extract job_id, uid, and full data from request.
    Returns (job_id, uid, data) tuple.
    
    Usage:
        job_id, uid, data = extract_job_info()
        if not job_id:
            abort(400, "Missing job_id")
    """
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    
    # Set job_id for logging
    if job_id:
        g.job_id = job_id
    
    return job_id, uid, data


def validate_required_fields(*fields: str) -> Callable:
    """
    Decorator to validate required fields in JSON request.
    
    Usage:
        @app.route("/process", methods=["POST"])
        @validate_required_fields("job_id", "uid", "text")
        def process():
            data = request.get_json()
            # All required fields are guaranteed to be present
            return {"success": True}
    """
    def decorator(f: Callable) -> Callable:
        @wraps(f)
        def wrapper(*args, **kwargs):
            data = request.get_json(silent=True)
            
            if not data:
                abort(400, "Missing JSON body")
            
            missing = [field for field in fields if not data.get(field)]
            
            if missing:
                logger.warning(f"Missing required fields: {missing}")
                abort(400, f"Missing required fields: {', '.join(missing)}")
            
            return f(*args, **kwargs)
        
        return wrapper
    return decorator


def log_request_info(f: Callable) -> Callable:
    """
    Decorator to log incoming request information.
    
    Usage:
        @app.route("/process", methods=["POST"])
        @log_request_info
        def process():
            return {"success": True}
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        logger.info(
            f"{request.method} {request.path}",
            extra={
                'remote_addr': request.remote_addr,
                'content_length': request.content_length,
                'content_type': request.content_type
            }
        )
        return f(*args, **kwargs)
    
    return wrapper


def get_job_document(job_id: str, collection: str = "voiceJobs") -> Tuple[Any, dict]:
    """
    Helper to get job document with error handling.
    
    Args:
        job_id: Job document ID
        collection: Firestore collection name
    
    Returns:
        Tuple of (job_ref, job_data)
    
    Raises:
        ValueError: If job not found
    """
    job_ref = get_db().collection(collection).document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        raise ValueError(f"Job {job_id} not found")
    
    return job_ref, job_doc.to_dict() or {}


def update_job_status(
    job_id: str,
    status: str,
    step: Optional[str] = None,
    progress: Optional[int] = None,
    collection: str = "voiceJobs",
    **extra_fields
) -> None:
    """
    Helper to update job status with consistent fields.
    
    Args:
        job_id: Job document ID
        status: New status
        step: Current step description
        progress: Progress percentage (0-100)
        collection: Firestore collection name
        **extra_fields: Additional fields to update
    """
    updates = {
        "status": status,
        "updatedAt": SERVER_TIMESTAMP
    }
    
    if step:
        updates["step"] = step
    
    if progress is not None:
        updates["progress"] = min(100, max(0, progress))
    
    updates.update(extra_fields)
    
    job_ref = get_db().collection(collection).document(job_id)
    job_ref.update(updates)
    
    logger.info(f"Job {job_id}: Updated status to {status}")


def get_retry_info() -> tuple[int, bool, bool]:
    """
    Extract retry information from Cloud Tasks headers.
    Returns: (retry_count, is_retry, is_final_attempt)
    """
    retry_count = int(request.headers.get('X-CloudTasks-TaskRetryCount', '0'))
    max_retries = config.MAX_RETRY_ATTEMPTS
    is_retry = retry_count > 0
    is_final_attempt = retry_count >= max_retries
    
    return retry_count, is_retry, is_final_attempt


def update_job_retry_status(
    job_ref,
    retry_count: int,
    error_message: str,
    is_final: bool,
    max_retries: Optional[int] = None
):
    """Update job document with retry information."""
    if max_retries is None:
        max_retries = config.MAX_RETRY_ATTEMPTS
        
    if is_final:
        job_ref.update({
            "status": "failed",
            "error": error_message,
            "retryCount": retry_count,
            "retriesExhausted": True,
            "failedAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP
        })
    else:
        job_ref.update({
            "status": "retrying",
            "lastError": error_message,
            "retryCount": retry_count,
            "maxRetries": max_retries,
            "nextRetryAttempt": retry_count + 1,
            "updatedAt": SERVER_TIMESTAMP
        })