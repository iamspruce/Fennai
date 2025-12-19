# functions/proxy/routes/dub_clone.py
"""
Enhanced dubbing voice cloning route with multi-chunk processing
and comprehensive error handling.
"""
from firebase_functions import https_fn, options
from flask import Request, jsonify, make_response, Response
import logging
import uuid
from typing import List, Dict, Any, Optional
from firebase.db import get_db

from firebase.admin import get_current_user
from utils import ResponseBuilder, MAX_SPEAKERS_PER_CHUNK
from utils.task_helper import create_cloud_task
from google.cloud.firestore import SERVER_TIMESTAMP
from utils.logging_config import get_logger, log_request

logger = get_logger(__name__)


def validate_clone_request(data: dict) -> tuple[bool, Optional[str]]:
    """
    Validate voice clone request.
    
    Args:
        data: Request data
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    job_id = data.get("jobId")
    
    if not job_id:
        return False, "Job ID is required"
    
    return True, None



def create_response(body: Any, status: int, headers: Dict[str, str]) -> Response:
    """Create a Flask Response object with headers."""
    response = jsonify(body) if isinstance(body, (dict, list)) else make_response(body)
    response.status_code = status
    for k, v in headers.items():
        response.headers[k] = v
    return response


@https_fn.on_request(memory=options.MemoryOption.GB_1, timeout_sec=60, max_instances=10)
def dub_clone(req: Request):
    """Start voice cloning for dubbing - uses character IDs."""
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Dubbing clone request received")
    
    db = get_db()
    
    # CORS headers
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    }
    
    # CORS handling
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
    if not user or not user.get("uid"):
        return create_response(ResponseBuilder.error("Unauthorized", request_id=request_id), 401, cors_headers)
    
    uid = user.get("uid")
    if not uid:
        logger.warning(f"[{request_id}] User missing UID")
        return create_response(ResponseBuilder.error("Unauthorized", request_id=request_id), 401, cors_headers)
    
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        return create_response(ResponseBuilder.error("Invalid JSON", request_id=request_id), 400, cors_headers)
    
    job_id = data.get("jobId")
    if not job_id:
        return create_response(ResponseBuilder.error("Job ID is required", request_id=request_id), 400, cors_headers)
    
    # Get job
    try:
        job_ref = db.collection("dubbingJobs").document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            return create_response(ResponseBuilder.error("Job not found", request_id=request_id), 404, cors_headers)
        
        job_data = job_doc.to_dict()

        if not job_data:
            logger.error(f"[{request_id}] Job data is None for {job_id}")
            return create_response(ResponseBuilder.error("Job data not found", request_id=request_id), 500, cors_headers)
        
        if job_data.get("uid") != uid:
            return create_response(ResponseBuilder.error("Unauthorized", request_id=request_id), 403, cors_headers)
        
        transcript = job_data.get("transcript", [])
        voice_mapping = job_data.get("voiceMapping", {})
        
        if not transcript or not voice_mapping:
            return create_response(ResponseBuilder.error("Incomplete job data", request_id=request_id), 400, cors_headers)
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to get job: {str(e)}")
        return create_response(ResponseBuilder.error("Failed to retrieve job", request_id=request_id), 500, cors_headers)
    
    # Use translated text if available
    for segment in transcript:
        segment["textToClone"] = segment.get("translatedText") or segment["text"]
    
    # Chunk dialogue
    chunks = chunk_dialogue_for_inference(transcript)
    logger.info(f"[{request_id}] Job {job_id}: Split into {len(chunks)} chunks")
    
    # Build chunks with character IDs
    try:
        cloned_chunks = []
        
        for chunk in chunks:
            # Build text
            chunk_text_parts = []
            for segment in chunk["segments"]:
                try:
                    speaker_idx = chunk["speakers"].index(segment["speakerId"]) + 1
                    chunk_text_parts.append(f"Speaker {speaker_idx}: {segment['textToClone']}")
                except ValueError:
                    continue
            
            # Build character IDs list (ordered by speaker)
            chunk_character_ids = []
            for speaker_id in chunk["speakers"]:
                mapping = voice_mapping.get(speaker_id, {})
                
                if mapping.get("type") == "character":
                    char_id = mapping.get("characterId")
                    if char_id:
                        chunk_character_ids.append(char_id)
                    else:
                        chunk_character_ids.append(None)  # Placeholder
                elif mapping.get("type") == "original":
                    # For original voices, store a special marker
                    chunk_character_ids.append(f"original:{speaker_id}")
                else:
                    chunk_character_ids.append(None)
            
            cloned_chunks.append({
                "chunkId": chunk["chunkId"],
                "speakers": chunk["speakers"],
                "text": "\n".join(chunk_text_parts),
                "characterIds": chunk_character_ids,
                "audioUrl": None,
                "status": "pending"
            })
        
        # Update job with chunks
        job_ref.update({
            "status": "cloning",
            "step": "Creating your custom voices...",
            "progress": 75,
            "totalChunks": len(chunks),
            "completedChunks": 0,
            "clonedAudioChunks": cloned_chunks,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        # Queue tasks (minimal payload)
        for chunk in chunks:
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "chunk_id": chunk["chunkId"]
            }
            
            
            success, error = create_cloud_task(task_payload, endpoint="/inference")
            if not success:
                raise Exception(f"Failed to queue chunk {chunk['chunkId']}: {error}")
        
        return create_response(ResponseBuilder.success({
            "jobId": job_id,
            "status": "cloning",
            "totalChunks": len(chunks),
            "message": "Voice cloning started"
        }, request_id=request_id), 202, cors_headers)
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to queue tasks: {str(e)}")
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue voice cloning",
            "updatedAt": SERVER_TIMESTAMP
        })
        return create_response(ResponseBuilder.error("Failed to queue cloning", request_id=request_id), 500, cors_headers)


def chunk_dialogue_for_inference(transcript: List[Dict]) -> List[Dict[str, Any]]:
    """Split transcript into chunks with max 4 speakers."""
    chunks = []
    current_chunk = {
        "chunkId": 0,
        "speakers": [],
        "segments": []
    }
    
    for segment in transcript:
        speaker_id = segment.get("speakerId")
        if not speaker_id:
            continue
        
        if speaker_id in current_chunk["speakers"]:
            current_chunk["segments"].append(segment)
        elif len(current_chunk["speakers"]) < MAX_SPEAKERS_PER_CHUNK:
            current_chunk["speakers"].append(speaker_id)
            current_chunk["segments"].append(segment)
        else:
            if current_chunk["segments"]:
                chunks.append(current_chunk)
            current_chunk = {
                "chunkId": len(chunks),
                "speakers": [speaker_id],
                "segments": [segment]
            }
    
    if current_chunk["segments"]:
        chunks.append(current_chunk)
    
    return chunks