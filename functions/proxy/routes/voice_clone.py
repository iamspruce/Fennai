from firebase_functions import https_fn, options
from flask import Request, jsonify
import sys
import uuid
from typing import List, Dict, Any, Optional
from firebase.db import get_db
from google.cloud.firestore import SERVER_TIMESTAMP

from firebase.admin import get_current_user
from firebase.credits import reserve_credits, release_credits, calculate_cost_from_duration
from utils import (
    MAX_TEXT_LENGTH,
    MAX_SPEAKERS_PER_CHUNK,
    SECONDS_PER_SPEAKER_ESTIMATE,
    SPEAKER_LIMITS,
    ResponseBuilder,
)
from utils.task_helper import create_cloud_task
from utils.logging_config import get_logger, log_request

logger = get_logger(__name__)

# ✅ Log module load
print("voice_clone.py module loaded")
sys.stdout.flush()


def validate_voice_clone_request(data: dict) -> tuple[bool, Optional[str]]:
    """Validate voice clone request with character IDs."""
    text = data.get("text", "").strip()
    character_ids = data.get("character_ids", [])
    
    if not text:
        return False, "Text is required"
    
    if not character_ids:
        return False, "Character IDs are required"
    
    if len(text) > MAX_TEXT_LENGTH:
        return False, f"Text exceeds maximum length of {MAX_TEXT_LENGTH} characters"
    
    if not isinstance(character_ids, list):
        return False, "Character IDs must be an array"
    
    for idx, char_id in enumerate(character_ids):
        if not isinstance(char_id, str) or len(char_id) == 0:
            return False, f"Invalid character ID at index {idx}"
    
    return True, None


def chunk_multi_speaker_dialogue(
    text: str, 
    character_ids: List[str], 
    max_speakers: int = MAX_SPEAKERS_PER_CHUNK
) -> List[Dict[str, Any]]:
    """
    Split multi-speaker dialogue into chunks.
    Now stores character IDs instead of voice samples.
    """
    lines = text.strip().split('\n')
    chunks = []
    current_chunk: Dict[str, Any] = {
        'speakers': [],
        'lines': [],
        'character_indices': []
    }
    
    speaker_to_char_idx = {}
    
    for line in lines:
        if ':' not in line:
            continue
            
        speaker_label, dialogue = line.split(':', 1)
        speaker_label = speaker_label.strip()
        dialogue = dialogue.strip()
        
        if not speaker_label or not dialogue:
            continue
        
        if speaker_label not in speaker_to_char_idx:
            speaker_to_char_idx[speaker_label] = len(speaker_to_char_idx)
        
        char_idx = speaker_to_char_idx[speaker_label]
        
        if speaker_label in current_chunk['speakers']:
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        elif len(current_chunk['speakers']) < max_speakers:
            current_chunk['speakers'].append(speaker_label)
            current_chunk['character_indices'].append(char_idx)
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        else:
            if current_chunk['lines']:
                current_chunk['text'] = '\n'.join(current_chunk['lines'])
                current_chunk['characterIds'] = [
                    character_ids[idx] for idx in current_chunk['character_indices']
                    if idx < len(character_ids)
                ]
                chunks.append(current_chunk)
            
            current_chunk = {
                'speakers': [speaker_label],
                'lines': [f"{speaker_label}: {dialogue}"],
                'character_indices': [char_idx]
            }
    
    if current_chunk['lines']:
        current_chunk['text'] = '\n'.join(current_chunk['lines'])
        current_chunk['characterIds'] = [
            character_ids[idx] for idx in current_chunk['character_indices']
            if idx < len(character_ids)
        ]
        chunks.append(current_chunk)
    
    return chunks


@https_fn.on_request(memory=options.MemoryOption.GB_1, timeout_sec=60, max_instances=10)
def voice_clone(req: Request):
    """Voice cloning endpoint - now uses character IDs."""
    request_id = str(uuid.uuid4())
    
    # ✅ CRITICAL: Force immediate output to verify function is called
    print("=" * 100)
    print(f"VOICE_CLONE FUNCTION CALLED - Request ID: {request_id}")
    print(f"Method: {req.method}")
    print(f"Path: {req.path}")
    print(f"Headers: {dict(req.headers)}")
    print("=" * 100)
    sys.stdout.flush()
    
    # Log request details
    log_request(logger, request_id, req.method, req.path, dict(req.headers))
    logger.info(f"[{request_id}] Voice clone request received")
    sys.stdout.flush()
    
    db = get_db()
    
    # CORS headers to use in all responses
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    }
    
    # Health check handling
    if req.path == "/health" or req.path.endswith("/health"):
        return jsonify(ResponseBuilder.success({"status": "healthy"})), 200, cors_headers
    
    # OPTIONS request for CORS
    if req.method == "OPTIONS":
        options_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
        }
        return "", 204, options_headers
    
    # Only allow POST
    if req.method != "POST":
        return jsonify(ResponseBuilder.error("Method not allowed", request_id=request_id)), 405, cors_headers
    
    # Authenticate
    user = get_current_user(req)
    if not user or not user.get("uid"):
        return jsonify(ResponseBuilder.error("Unauthorized", request_id=request_id)), 401, cors_headers
    
    uid = user.get("uid")
    if not uid:
        logger.warning(f"[{request_id}] User missing UID")
        return jsonify(ResponseBuilder.error("Unauthorized", request_id=request_id)), 401, cors_headers
    
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Get user tier
    user_doc = db.collection("users").document(uid).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_tier = get_user_tier(user_data)
    max_speakers = SPEAKER_LIMITS[user_tier]
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"[{request_id}] JSON parse error: {str(e)}")
        return jsonify(ResponseBuilder.error("Invalid JSON", request_id=request_id)), 400, cors_headers
    
    # Validate request
    is_valid, error_msg = validate_voice_clone_request(data)
    if not is_valid:
        return jsonify(ResponseBuilder.error(error_msg or "Validation failed", request_id=request_id)), 400, cors_headers
    
    text = data.get("text", "").strip()
    character_ids = data.get("character_ids", [])
    character_texts = data.get("character_texts")
    
    # Count speakers
    speaker_count = count_speakers_in_text(text) if character_texts else 1
    logger.info(f"[{request_id}] Detected {speaker_count} speakers")
    
    # Validate speaker limit
    if speaker_count > max_speakers:
        return jsonify(ResponseBuilder.error(
            f"Speaker limit exceeded. Your {user_tier} tier allows max {int(max_speakers)} speakers.",
            request_id=request_id
        )), 400, cors_headers
    
    # Calculate cost and create job
    estimated_duration = speaker_count * SECONDS_PER_SPEAKER_ESTIMATE
    cost = calculate_cost_from_duration(estimated_duration, speaker_count > 1)
    job_id = str(uuid.uuid4())
    
    # ✅ IMPORTANT: reserve_credits() creates the job document atomically
    # We pass job metadata so it can create the document in the same transaction
    job_metadata = {
        "text": data.get("text", ""),
        "character_texts": data.get("character_texts"),
        "estimatedDuration": estimated_duration,
        "speakerCount": speaker_count,
    }
    
    # Reserve credits - this also creates the job document atomically
    try:
        logger.info(f"[{request_id}] Attempting to reserve {cost} credits for user {uid}")
        success, error_msg = reserve_credits(uid, job_id, cost, job_metadata)
        
        logger.info(f"[{request_id}] Credit reservation result: success={success}, error={error_msg}")
        
        if not success:
            logger.error(f"[{request_id}] Credit reservation FAILED - returning 402 error")
            sys.stdout.flush()
            return jsonify(ResponseBuilder.error(
                error_msg or "Credit reservation failed", 
                request_id=request_id
            )), 402, cors_headers
        
        logger.info(f"[{request_id}] Credit reservation SUCCESS - job document created atomically")
        
    except Exception as e:
        logger.error(f"[{request_id}] Credit reservation exception: {str(e)}")
        sys.stdout.flush()
        return jsonify(ResponseBuilder.error("Credit reservation failed", request_id=request_id)), 500, cors_headers
    
    # Get job reference (already created by reserve_credits)
    job_ref = db.collection("voiceJobs").document(job_id)
    
    # Handle chunking
    needs_chunking = speaker_count > MAX_SPEAKERS_PER_CHUNK
    chunks = []
    
    if needs_chunking:
        chunks = chunk_multi_speaker_dialogue(text, character_ids, MAX_SPEAKERS_PER_CHUNK)
        logger.info(f"[{request_id}] Split into {len(chunks)} chunks")
        
        try:
            job_ref.update({
                "totalChunks": len(chunks),
                "completedChunks": 0,
                "chunks": [
                    {
                        "chunkId": i,
                        "text": chunk['text'],
                        "characterIds": chunk['characterIds'],
                        "speakers": chunk['speakers'],
                        "status": "pending"
                    }
                    for i, chunk in enumerate(chunks)
                ]
            })
        except Exception as e:
            logger.error(f"[{request_id}] Failed to update job: {str(e)}")
            release_credits(uid, job_id, cost)
            return jsonify(ResponseBuilder.error("Failed to create job", request_id=request_id)), 500, cors_headers
        
        # Queue chunks (minimal payload)
        for i in range(len(chunks)):
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "chunk_id": i
            }
            
            success, error = create_cloud_task(task_payload, endpoint="/inference")
            if not success:
                logger.error(f"[{request_id}] Failed to queue chunk {i}: {error}")
                release_credits(uid, job_id, cost)
                return jsonify(ResponseBuilder.error("Failed to queue task", request_id=request_id)), 500, cors_headers
    
    else:
        # Single chunk - store text AND character IDs
        try:
            job_ref.update({
                "text": text,
                "characterIds": character_ids
            })
        except Exception as e:
            logger.error(f"[{request_id}] Failed to update job: {str(e)}")
            release_credits(uid, job_id, cost)
            return jsonify(ResponseBuilder.error("Failed to store job data", request_id=request_id)), 500, cors_headers
        
        task_payload = {
            "job_id": job_id,
            "uid": uid
        }
        
        success, error = create_cloud_task(task_payload, endpoint="/inference")
        if not success:
            logger.error(f"[{request_id}] Failed to queue task: {error}")
            release_credits(uid, job_id, cost)
            return jsonify(ResponseBuilder.error("Failed to queue task", request_id=request_id)), 500, cors_headers
    
    logger.info(f"[{request_id}] Job {job_id} queued successfully")
    
    return jsonify(ResponseBuilder.success({
        "jobId": job_id,
        "status": "queued",
        "message": "Voice generation queued",
        "speakerCount": speaker_count,
        "chunkCount": len(chunks) if needs_chunking else 1,
        "estimatedCost": cost
    }, request_id=request_id)), 202, cors_headers


def get_user_tier(user_data: Optional[Dict[str, Any]]) -> str:
    """Determine user tier."""
    if not user_data:
        return 'free'
    if user_data.get("isEnterprise", False):
        return 'enterprise'
    elif user_data.get("isPro", False):
        return 'pro'
    return 'free'


def count_speakers_in_text(text: str) -> int:
    """Count unique speakers in text."""
    if not text:
        return 0
    lines = text.strip().split('\n')
    speakers = set()
    for line in lines:
        if ':' in line:
            speaker_label = line.split(':', 1)[0].strip()
            if speaker_label:
                speakers.add(speaker_label)
    return len(speakers)