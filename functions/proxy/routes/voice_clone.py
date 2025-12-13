# functions/proxy/routes/voice_clone.py
"""
Enhanced voice cloning route with unlimited speaker support.
Handles multi-speaker dialogue with automatic chunking.
"""
from firebase_functions import https_fn, options
from flask import Request, Response
import logging
import uuid
from typing import List, Dict, Any, Optional
from firebase.db import get_db
from google.cloud.firestore import SERVER_TIMESTAMP

from firebase.admin import get_current_user
from firebase.credits import reserve_credits, release_credits, calculate_cost_from_duration
from utils import (
    MAX_TEXT_LENGTH,
    MAX_VOICE_SAMPLES,
    MAX_SPEAKERS_PER_CHUNK,
    SECONDS_PER_SPEAKER_ESTIMATE,
    SPEAKER_LIMITS,
    ResponseBuilder,
    validate_file_size
)
from utils.task_helper import create_cloud_task

logger = logging.getLogger(__name__)


def get_user_tier(user_data: Optional[Dict[str, Any]]) -> str:
    """
    Determine user tier from user document.
    
    Args:
        user_data: User document data
        
    Returns:
        Tier name: 'free', 'pro', or 'enterprise'
    """
    if not user_data:
        return 'free'

    if user_data.get("isEnterprise", False):
        return 'enterprise'
    elif user_data.get("isPro", False):
        return 'pro'
    return 'free'


def count_speakers_in_text(text: str) -> int:
    """
    Count unique speakers in multi-character text.
    
    Args:
        text: Multi-line text with "Speaker N: dialogue" format
        
    Returns:
        Number of unique speakers
    """
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


def validate_voice_clone_request(data: dict) -> tuple[bool, Optional[str]]:
    """
    Validate voice clone request data.
    
    Args:
        data: Request JSON data
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    text = data.get("text", "").strip()
    voice_samples = data.get("voice_samples", [])
    
    # Check required fields
    if not text:
        return False, "Text is required"
    
    if not voice_samples:
        return False, "Voice samples are required"
    
    # Validate text length
    if len(text) > MAX_TEXT_LENGTH:
        return False, f"Text exceeds maximum length of {MAX_TEXT_LENGTH} characters"
    
    # Validate voice samples
    if not isinstance(voice_samples, list):
        return False, "Voice samples must be an array"
    
    if len(voice_samples) > MAX_VOICE_SAMPLES:
        return False, f"Too many voice samples (max {MAX_VOICE_SAMPLES})"
    
    # Validate voice sample format
    for idx, sample in enumerate(voice_samples):
        if not isinstance(sample, str) or len(sample) == 0:
            return False, f"Invalid voice sample at index {idx}"
    
    return True, None


def chunk_multi_speaker_dialogue(
    text: str, 
    voice_samples: List[str], 
    max_speakers: int = MAX_SPEAKERS_PER_CHUNK
) -> List[Dict[str, Any]]:
    """
    Split multi-speaker dialogue into chunks with max speakers per chunk.
    
    Args:
        text: Multi-line dialogue text
        voice_samples: List of voice sample URLs/data
        max_speakers: Maximum speakers per chunk
        
    Returns:
        List of chunks with format: [{text, voice_samples, speakers}]
    """
    lines = text.strip().split('\n')
    chunks = []
    current_chunk: Dict[str, Any] = {
        'speakers': [],
        'lines': [],
        'voice_sample_indices': []
    }
    
    speaker_to_sample_idx = {}
    
    for line in lines:
        if ':' not in line:
            continue
            
        speaker_label, dialogue = line.split(':', 1)
        speaker_label = speaker_label.strip()
        dialogue = dialogue.strip()
        
        if not speaker_label or not dialogue:
            continue
        
        if speaker_label not in speaker_to_sample_idx:
            speaker_to_sample_idx[speaker_label] = len(speaker_to_sample_idx)
        
        sample_idx = speaker_to_sample_idx[speaker_label]
        
        if speaker_label in current_chunk['speakers']:
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        elif len(current_chunk['speakers']) < max_speakers:
            current_chunk['speakers'].append(speaker_label)
            current_chunk['voice_sample_indices'].append(sample_idx)
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        else:
            if current_chunk['lines']:
                current_chunk['text'] = '\n'.join(current_chunk['lines'])
                current_chunk['voice_samples'] = [
                    voice_samples[idx] for idx in current_chunk['voice_sample_indices']
                    if idx < len(voice_samples)
                ]
                chunks.append(current_chunk)
            
            current_chunk = {
                'speakers': [speaker_label],
                'lines': [f"{speaker_label}: {dialogue}"],
                'voice_sample_indices': [sample_idx]
            }
    
    if current_chunk['lines']:
        current_chunk['text'] = '\n'.join(current_chunk['lines'])
        current_chunk['voice_samples'] = [
            voice_samples[idx] for idx in current_chunk['voice_sample_indices']
            if idx < len(voice_samples)
        ]
        chunks.append(current_chunk)
    
    return chunks


@https_fn.on_request(memory=options.MemoryOption.GB_1,
    timeout_sec=60,
    max_instances=10)
def voice_clone(req: Request) -> Response:
    """
    Voice cloning endpoint with unlimited speaker support.
    - Free: max 4 speakers
    - Pro: max 12 speakers
    - Enterprise: unlimited
    
    Automatically chunks dialogue for >4 speakers
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Voice clone request received. Method: {req.method}")
    
    db = get_db()

    
    # Health check
    if req.path == "/health" or req.path.endswith("/health"):
        return Response(
            ResponseBuilder.success({"status": "healthy", "service": "voice-clone"}),
            status=200,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # CORS preflight
    if req.method == "OPTIONS":
        return Response(
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
        return Response(
            ResponseBuilder.error("Method not allowed", request_id=request_id),
            status=405,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Authenticate
    user = get_current_user(req)
    if not user:
        logger.warning(f"[{request_id}] Unauthorized request")
        return Response(
            ResponseBuilder.error("Unauthorized", request_id=request_id),
            status=401,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    if not uid or not isinstance(uid, str):
        logger.warning(f"[{request_id}] Unauthorized request: Missing or invalid UID")
        return Response(
            ResponseBuilder.error("Unauthorized", request_id=request_id),
            status=401,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Get user tier
    user_doc = db.collection("users").document(uid).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_tier = get_user_tier(user_data)
    max_speakers = SPEAKER_LIMITS[user_tier]
    
    logger.info(f"[{request_id}] User tier: {user_tier}, max speakers: {max_speakers}")
    
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
    is_valid, error_msg = validate_voice_clone_request(data)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return Response(
            ResponseBuilder.error(error_msg or "Invalid request", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    text = data.get("text", "").strip()
    voice_samples = data.get("voice_samples", [])
    character_texts = data.get("character_texts")
    
    # Count speakers
    speaker_count = count_speakers_in_text(text) if character_texts else 1
    logger.info(f"[{request_id}] Detected {speaker_count} speakers")
    
    # Validate speaker limit
    if speaker_count > max_speakers:
        logger.warning(f"[{request_id}] Speaker limit exceeded: {speaker_count} > {max_speakers}")
        return Response(
            ResponseBuilder.error(
                f"Speaker limit exceeded. Your {user_tier} tier allows max {int(max_speakers)} speakers, but you have {speaker_count}.",
                details={
                    "speakerCount": speaker_count,
                    "maxSpeakers": int(max_speakers),
                    "userTier": user_tier
                },
                request_id=request_id
            ),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost
    estimated_duration = speaker_count * SECONDS_PER_SPEAKER_ESTIMATE
    cost = calculate_cost_from_duration(estimated_duration, speaker_count > 1)
    job_id = str(uuid.uuid4())
    
    logger.info(
        f"[{request_id}] Creating job {job_id}: {speaker_count} speakers, "
        f"cost {cost}, estimated {estimated_duration}s"
    )
    
    # Reserve credits
    try:
        success, error_msg = reserve_credits(uid, job_id, cost, data)
        if not success:
            logger.warning(f"[{request_id}] Credit reservation failed: {error_msg}")
            return Response(
                ResponseBuilder.error(error_msg or "Insufficient credits", request_id=request_id),
                status=402,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
    except Exception as e:
        logger.error(f"[{request_id}] Credit reservation exception: {str(e)}")
        return Response(
            ResponseBuilder.error(f"Credit reservation failed: {str(e)}", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Determine chunking
    needs_chunking = speaker_count > MAX_SPEAKERS_PER_CHUNK
    chunks = []
    
    if needs_chunking:
        chunks = chunk_multi_speaker_dialogue(text, voice_samples, MAX_SPEAKERS_PER_CHUNK)
        logger.info(f"[{request_id}] Split into {len(chunks)} chunks")
        
        try:
            job_ref = db.collection("voiceJobs").document(job_id)
            job_ref.update({
                "totalChunks": len(chunks),
                "completedChunks": 0,
                "chunks": [
                    {
                        "chunkId": i,
                        "text": chunk['text'],
                        "speakers": chunk['speakers'],
                        "status": "pending"
                    }
                    for i, chunk in enumerate(chunks)
                ]
            })
        except Exception as e:
            logger.error(f"[{request_id}] Failed to update job: {str(e)}")
            release_credits(uid, job_id, cost)
            return Response(
                ResponseBuilder.error("Failed to create job", request_id=request_id),
                status=500,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        # Queue chunks
        for i, chunk in enumerate(chunks):
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "cost": cost,
                "chunk_id": i,
                "total_chunks": len(chunks),
                "text": chunk['text'],
                "voice_samples": chunk['voice_samples'],
                "request_id": request_id
            }
            
            success, error = create_cloud_task(task_payload, endpoint="/inference")
            if not success:
                logger.error(f"[{request_id}] Failed to queue chunk {i}: {error}")
                release_credits(uid, job_id, cost)
                return Response(
                    ResponseBuilder.error("Failed to queue generation task", request_id=request_id),
                    status=500,
                    headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
                )
    
    else:
        # Single chunk
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "cost": cost,
            "text": text,
            "voice_samples": voice_samples,
            "request_id": request_id
        }
        
        if character_texts:
            task_payload["character_texts"] = character_texts
        
        success, error = create_cloud_task(task_payload, endpoint="/inference")
        if not success:
            logger.error(f"[{request_id}] Failed to queue task: {error}")
            release_credits(uid, job_id, cost)
            return Response(
                ResponseBuilder.error("Failed to queue generation task", request_id=request_id),
                status=500,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
    
    logger.info(f"[{request_id}] Job {job_id} queued successfully")
    
    return Response(
        ResponseBuilder.success({
            "jobId": job_id,
            "status": "queued",
            "message": "Voice generation queued successfully",
            "speakerCount": speaker_count,
            "chunkCount": len(chunks) if needs_chunking else 1,
            "estimatedCost": cost
        }, request_id=request_id),
        status=202,
        headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
    )