# functions/proxy/routes/dub_clone.py
"""
Enhanced dubbing voice cloning route with multi-chunk processing
and comprehensive error handling.
"""
from firebase_functions import https_fn, options
import logging
import os
import uuid
from typing import List, Dict, Any, Optional
from firebase.db import get_db

from firebase.admin import get_current_user
from utils import ResponseBuilder, MAX_SPEAKERS_PER_CHUNK
from utils.task_helper import create_cloud_task
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)


def chunk_dialogue_for_inference(transcript: List[Dict]) -> List[Dict[str, Any]]:
    """
    Split transcript into chunks with max 4 unique speakers per chunk.
    
    Args:
        transcript: List of transcript segments with speaker IDs
        
    Returns:
        List of chunks with {chunkId, speakers[], segments[]}
    """
    chunks = []
    current_chunk = {
        "chunkId": 0,
        "speakers": [],
        "segments": []
    }
    
    for segment in transcript:
        speaker_id = segment.get("speakerId")
        
        if not speaker_id:
            logger.warning(f"Segment missing speakerId: {segment}")
            continue
        
        # Check if speaker already in current chunk
        if speaker_id in current_chunk["speakers"]:
            current_chunk["segments"].append(segment)
            continue
        
        # Check if chunk has room for new speaker
        if len(current_chunk["speakers"]) < MAX_SPEAKERS_PER_CHUNK:
            current_chunk["speakers"].append(speaker_id)
            current_chunk["segments"].append(segment)
            continue
        
        # Chunk full, start new chunk
        if current_chunk["segments"]:
            chunks.append(current_chunk)
        
        current_chunk = {
            "chunkId": len(chunks),
            "speakers": [speaker_id],
            "segments": [segment]
        }
    
    # Add last chunk
    if current_chunk["segments"]:
        chunks.append(current_chunk)
    
    return chunks


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


@https_fn.on_request(memory=options.MemoryOption.MB_1GB,
    timeout_sec=60,
    max_instances=10)
def dub_clone(req: https_fn.Request) -> https_fn.Response:
    """
    Start voice cloning for dubbing job.
    Handles multi-chunk processing for >4 speakers.
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Dubbing clone request received")

    db = get_db()

    
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
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
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
    is_valid, error_msg = validate_clone_request(data)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return https_fn.Response(
            ResponseBuilder.error(error_msg or "Invalid request", request_id=request_id),
            status=400,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    job_id = data.get("jobId")
    
    # Get job document
    try:
        job_ref = db.collection("dubbingJobs").document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            logger.warning(f"[{request_id}] Job not found: {job_id}")
            return https_fn.Response(
                ResponseBuilder.error("Job not found", request_id=request_id),
                status=404,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        job_data = job_doc.to_dict()
        
        if not job_data:
            logger.error(f"[{request_id}] Job data is None for {job_id}")
            return https_fn.Response(
                ResponseBuilder.error("Job data not found", request_id=request_id),
                status=500,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        # Verify ownership
        if job_data.get("uid") != uid:
            logger.warning(f"[{request_id}] Unauthorized access attempt to job {job_id}")
            return https_fn.Response(
                ResponseBuilder.error("Unauthorized", request_id=request_id),
                status=403,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        transcript = job_data.get("transcript", [])
        voice_mapping = job_data.get("voiceMapping", {})
        speakers = job_data.get("speakers", [])
        speaker_voice_samples = job_data.get("speakerVoiceSamples", {})
        
        if not transcript:
            return https_fn.Response(
                ResponseBuilder.error("No transcript available", request_id=request_id),
                status=400,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
        if not voice_mapping:
            return https_fn.Response(
                ResponseBuilder.error("Voice mapping not configured", request_id=request_id),
                status=400,
                headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
            )
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to get job: {str(e)}")
        return https_fn.Response(
            ResponseBuilder.error("Failed to retrieve job", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Use translated text if available
    for segment in transcript:
        if segment.get("translatedText"):
            segment["textToClone"] = segment["translatedText"]
        else:
            segment["textToClone"] = segment["text"]
    
    # Chunk dialogue for 4-speaker limit
    chunks = chunk_dialogue_for_inference(transcript)
    
    logger.info(f"[{request_id}] Job {job_id}: Split into {len(chunks)} chunks")
    
    # Update job with chunks
    try:
        cloned_chunks = [
            {
                "chunkId": chunk["chunkId"],
                "speakers": chunk["speakers"],
                "audioUrl": None,
                "audioPath": None,
                "status": "pending"
            }
            for chunk in chunks
        ]
        
        job_ref.update({
            "status": "cloning",
            "step": f"Cloning voices (0/{len(chunks)} chunks)...",
            "progress": 75,
            "totalChunks": len(chunks),
            "completedChunks": 0,
            "clonedAudioChunks": cloned_chunks,
            "updatedAt": SERVER_TIMESTAMP
        })
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to update job: {str(e)}")
        return https_fn.Response(
            ResponseBuilder.error("Failed to update job", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
    
    # Queue clone tasks for each chunk
    try:
        for chunk in chunks:
            # Build voice samples for this chunk's speakers
            chunk_voice_samples = {}
            
            for speaker_id in chunk["speakers"]:
                mapping = voice_mapping.get(speaker_id, {})
                
                if mapping.get("type") == "character":
                    # Fetch character's voice sample
                    character_id = mapping.get("characterId")
                    if character_id:
                        try:
                            char_doc = db.collection("characters").document(character_id).get()
                            if char_doc.exists:
                                char_data = char_doc.to_dict()
                                if char_data:
                                    chunk_voice_samples[speaker_id] = char_data.get("sampleAudioUrl")
                        except Exception as e:
                            logger.warning(
                                f"[{request_id}] Failed to fetch character {character_id}: {str(e)}"
                            )
                
                elif mapping.get("type") == "original":
                    # Use original speaker voice sample
                    chunk_voice_samples[speaker_id] = speaker_voice_samples.get(speaker_id)
            
            # Build text for this chunk (format for VibeVoice)
            chunk_text_parts = []
            for segment in chunk["segments"]:
                try:
                    speaker_idx = chunk["speakers"].index(segment["speakerId"]) + 1
                    chunk_text_parts.append(f"Speaker {speaker_idx}: {segment['textToClone']}")
                except ValueError:
                    logger.warning(
                        f"[{request_id}] Speaker {segment['speakerId']} not in chunk speakers"
                    )
                    continue
            
            chunk_text = "\n".join(chunk_text_parts)
            
            # Queue task
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "chunk_id": chunk["chunkId"],
                "speakers": chunk["speakers"],
                "text": chunk_text,
                "voice_samples": chunk_voice_samples,
                "request_id": request_id,
            }
            
            success, error = create_cloud_task(task_payload, endpoint="/clone-audio")
            
            if not success:
                raise Exception(f"Failed to queue chunk {chunk['chunkId']}: {error}")
            
            logger.info(
                f"[{request_id}] Queued clone task for chunk {chunk['chunkId']} "
                f"with {len(chunk['speakers'])} speakers"
            )
        
        return https_fn.Response(
            ResponseBuilder.success({
                "jobId": job_id,
                "status": "cloning",
                "totalChunks": len(chunks),
                "message": "Voice cloning started"
            }, request_id=request_id),
            status=202,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )
        
    except Exception as e:
        logger.error(f"[{request_id}] Failed to queue clone tasks: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue voice cloning",
            "errorDetails": str(e),
            "updatedAt": SERVER_TIMESTAMP
        })
        
        return https_fn.Response(
            ResponseBuilder.error("Failed to queue voice cloning", request_id=request_id),
            status=500,
            headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}
        )