# functions/proxy/routes/dub_clone.py
from firebase_functions import https_fn, logger
from firebase_admin import firestore
import os
import json
import base64
from google.cloud import tasks_v2

from firebase.admin import get_current_user

# Environment
CLOUD_RUN_URL = os.environ.get("CLOUD_RUN_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")
GCP_PROJECT = os.environ.get("GCP_PROJECT", "fennai")
QUEUE_LOCATION = os.environ.get("QUEUE_LOCATION", "us-central1")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "voice-generation-queue")
SERVICE_ACCOUNT = os.environ.get("SERVICE_ACCOUNT_EMAIL")

tasks_client = tasks_v2.CloudTasksClient()
queue_path = tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)
db = firestore.client()


def chunk_dialogue_for_inference(transcript: list) -> list:
    """
    Split transcript into chunks with max 4 unique speakers per chunk
    Returns: List of chunks with {chunkId, speakers[], segments[]}
    """
    chunks = []
    current_chunk = {
        "chunkId": 0,
        "speakers": [],
        "segments": []
    }
    
    for segment in transcript:
        speaker_id = segment.get("speakerId")
        
        # Check if speaker already in current chunk
        if speaker_id in current_chunk["speakers"]:
            current_chunk["segments"].append(segment)
            continue
        
        # Check if chunk has room for new speaker
        if len(current_chunk["speakers"]) < 4:
            current_chunk["speakers"].append(speaker_id)
            current_chunk["segments"].append(segment)
            continue
        
        # Chunk full, start new chunk
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


@https_fn.on_request()
def dub_clone(req: https_fn.Request) -> https_fn.Response:
    """
    Start voice cloning for dubbing job
    Handles multi-chunk processing for >4 speakers
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
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception:
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    job_id = data.get("jobId")
    
    if not job_id:
        return https_fn.Response(
            {"error": "Missing jobId"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Get job document
    try:
        job_ref = db.collection("dubbingJobs").document(job_id)
        job_doc = job_ref.get()
        
        if not job_doc.exists:
            return https_fn.Response(
                {"error": "Job not found"},
                status=404,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        job_data = job_doc.to_dict()
        
        # Verify ownership
        if job_data.get("uid") != uid:
            return https_fn.Response(
                {"error": "Unauthorized"},
                status=403,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        transcript = job_data.get("transcript", [])
        voice_mapping = job_data.get("voiceMapping", {})
        speakers = job_data.get("speakers", [])
        speaker_voice_samples = job_data.get("speakerVoiceSamples", {})
        
        if not transcript or not voice_mapping:
            return https_fn.Response(
                {"error": "Missing transcript or voice mapping"},
                status=400,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
    except Exception as e:
        logger.error(f"Failed to get job: {str(e)}")
        return https_fn.Response(
            {"error": "Failed to retrieve job"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Use translated text if available
    for segment in transcript:
        if segment.get("translatedText"):
            segment["textToClone"] = segment["translatedText"]
        else:
            segment["textToClone"] = segment["text"]
    
    # Chunk dialogue for 4-speaker limit
    chunks = chunk_dialogue_for_inference(transcript)
    
    logger.info(f"Job {job_id}: Split into {len(chunks)} chunks")
    
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
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
    except Exception as e:
        logger.error(f"Failed to update job: {str(e)}")
        return https_fn.Response(
            {"error": "Failed to update job"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
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
                        char_doc = db.collection("characters").document(character_id).get()
                        if char_doc.exists:
                            char_data = char_doc.to_dict()
                            chunk_voice_samples[speaker_id] = char_data.get("sampleAudioUrl")
                
                elif mapping.get("type") == "original":
                    # Use original speaker voice sample
                    chunk_voice_samples[speaker_id] = speaker_voice_samples.get(speaker_id)
            
            # Build text for this chunk (format for VibeVoice)
            chunk_text_parts = []
            for segment in chunk["segments"]:
                speaker_idx = chunk["speakers"].index(segment["speakerId"]) + 1
                chunk_text_parts.append(f"Speaker {speaker_idx}: {segment['textToClone']}")
            
            chunk_text = "\n".join(chunk_text_parts)
            
            # Queue task
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "chunk_id": chunk["chunkId"],
                "speakers": chunk["speakers"],
                "text": chunk_text,
                "voice_samples": chunk_voice_samples,
            }
            
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": f"{CLOUD_RUN_URL}/clone-audio",
                    "headers": {
                        "Content-Type": "application/json",
                        "X-Internal-Token": INTERNAL_TOKEN,
                    },
                    "body": base64.b64encode(
                        json.dumps(task_payload).encode()
                    ).decode(),
                },
                "dispatch_deadline": {"seconds": 900},
            }
            
            if SERVICE_ACCOUNT:
                task["http_request"]["oidc_token"] = {
                    "service_account_email": SERVICE_ACCOUNT
                }
            
            response = tasks_client.create_task(
                request={"parent": queue_path, "task": task}
            )
            
            logger.info(f"Queued clone task for chunk {chunk['chunkId']}: {response.name}")
        
        return https_fn.Response(
            {
                "success": True,
                "totalChunks": len(chunks),
                "message": "Voice cloning started"
            },
            status=202,
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to queue clone tasks: {str(e)}")
        
        job_ref.update({
            "status": "failed",
            "error": "Failed to queue voice cloning",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        return https_fn.Response(
            {"error": "Failed to queue voice cloning"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )