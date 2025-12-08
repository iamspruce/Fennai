# functions/proxy/main.py
"""
Complete proxy main entry point with unlimited speaker support
Exports all Cloud Functions for Firebase deployment
"""

# Import all route handlers
from routes.script_generator import generate_script
from routes.dub_transcribe import dub_transcribe
from routes.dub_translate import dub_translate
from routes.dub_clone import dub_clone

# Import original voice_clone function
from firebase_functions import https_fn, logger
from firebase_admin import firestore
import os
import json
import base64
import uuid
from google.cloud import tasks_v2
from dotenv import load_dotenv

load_dotenv()

from firebase.admin import get_current_user
from firebase.credits import reserve_credits

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
db = firestore.client()

# Speaker limits per tier
SPEAKER_LIMITS = {
    'free': 4,
    'pro': 12,
    'enterprise': float('inf')
}


def get_user_tier(user_data: dict) -> str:
    """Determine user tier from user document"""
    if user_data.get("isEnterprise", False):
        return 'enterprise'
    elif user_data.get("isPro", False):
        return 'pro'
    return 'free'


def count_speakers_in_text(text: str) -> int:
    """Count unique speakers in multi-character text"""
    lines = text.strip().split('\n')
    speakers = set()
    
    for line in lines:
        # Match "Speaker N:" or "Character Name:" patterns
        if ':' in line:
            speaker_label = line.split(':', 1)[0].strip()
            speakers.add(speaker_label)
    
    return len(speakers)


def chunk_multi_speaker_dialogue(text: str, voice_samples: list, max_speakers: int = 4) -> list:
    """
    Split multi-speaker dialogue into chunks with max 4 speakers each
    Returns list of chunks: [{text, voice_samples, speakers}]
    """
    lines = text.strip().split('\n')
    chunks = []
    current_chunk = {
        'speakers': [],  # Speaker labels in order
        'lines': [],
        'voice_sample_indices': []
    }
    
    speaker_to_sample_idx = {}  # Map speaker label to voice sample index
    
    for line in lines:
        if ':' not in line:
            continue
            
        speaker_label, dialogue = line.split(':', 1)
        speaker_label = speaker_label.strip()
        dialogue = dialogue.strip()
        
        # Find speaker index in original text
        if speaker_label not in speaker_to_sample_idx:
            # Assign next voice sample
            speaker_to_sample_idx[speaker_label] = len(speaker_to_sample_idx)
        
        sample_idx = speaker_to_sample_idx[speaker_label]
        
        # Check if speaker already in current chunk
        if speaker_label in current_chunk['speakers']:
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        # Check if we can add new speaker
        elif len(current_chunk['speakers']) < max_speakers:
            current_chunk['speakers'].append(speaker_label)
            current_chunk['voice_sample_indices'].append(sample_idx)
            current_chunk['lines'].append(f"{speaker_label}: {dialogue}")
        else:
            # Chunk full, start new chunk
            if current_chunk['lines']:
                current_chunk['text'] = '\n'.join(current_chunk['lines'])
                current_chunk['voice_samples'] = [
                    voice_samples[idx] for idx in current_chunk['voice_sample_indices']
                    if idx < len(voice_samples)
                ]
                chunks.append(current_chunk)
            
            # Start new chunk with this speaker
            current_chunk = {
                'speakers': [speaker_label],
                'lines': [f"{speaker_label}: {dialogue}"],
                'voice_sample_indices': [sample_idx]
            }
    
    # Add last chunk
    if current_chunk['lines']:
        current_chunk['text'] = '\n'.join(current_chunk['lines'])
        current_chunk['voice_samples'] = [
            voice_samples[idx] for idx in current_chunk['voice_sample_indices']
            if idx < len(voice_samples)
        ]
        chunks.append(current_chunk)
    
    return chunks


@https_fn.on_request()
def voice_clone(req: https_fn.Request) -> https_fn.Response:
    """
    ENHANCED voice cloning endpoint with unlimited speaker support
    - Free: max 4 speakers
    - Pro: max 12 speakers
    - Enterprise: unlimited
    
    Automatically chunks dialogue for >4 speakers
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

    # Get user tier
    user_doc = db.collection("users").document(uid).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    user_tier = get_user_tier(user_data)
    max_speakers = SPEAKER_LIMITS[user_tier]
    
    logger.info(f"User {uid} tier: {user_tier}, max speakers: {max_speakers}")

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
    
    # Count speakers in dialogue
    speaker_count = count_speakers_in_text(text) if character_texts else 1
    
    # Validate speaker limit
    if speaker_count > max_speakers:
        logger.warn(f"User {uid} ({user_tier}) exceeded speaker limit: {speaker_count} > {max_speakers}")
        return https_fn.Response(
            {
                "error": f"Speaker limit exceeded. Your {user_tier} tier allows max {int(max_speakers)} speakers, but you have {speaker_count}.",
                "speakerCount": speaker_count,
                "maxSpeakers": int(max_speakers),
                "userTier": user_tier
            },
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost (conservative estimate)
    estimated_duration = speaker_count * 15  # 15 seconds per speaker
    from firebase.credits import calculate_cost_from_duration
    cost = calculate_cost_from_duration(estimated_duration, speaker_count > 1)
    
    job_id = str(uuid.uuid4())
    
    logger.info(f"Creating job {job_id} for user {uid} with {speaker_count} speakers, cost {cost}")
    
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
    
    # Determine if we need to chunk (>4 speakers)
    needs_chunking = speaker_count > 4
    
    if needs_chunking:
        # Chunk dialogue into 4-speaker chunks
        chunks = chunk_multi_speaker_dialogue(text, voice_samples, max_speakers=4)
        logger.info(f"Job {job_id}: Split {speaker_count} speakers into {len(chunks)} chunks")
        
        # Update job with chunking info
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
        
        # Queue multiple tasks (one per chunk)
        try:
            for i, chunk in enumerate(chunks):
                task_payload = {
                    "job_id": job_id,
                    "uid": uid,
                    "cost": cost,
                    "chunk_id": i,
                    "total_chunks": len(chunks),
                    "text": chunk['text'],
                    "voice_samples": chunk['voice_samples'],
                }
                
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
                    "dispatch_deadline": {"seconds": 900},
                }
                
                if SERVICE_ACCOUNT:
                    task["http_request"]["oidc_token"] = {
                        "service_account_email": SERVICE_ACCOUNT
                    }
                
                task["retry_config"] = {
                    "max_attempts": 3,
                    "max_retry_duration": {"seconds": 1800},
                    "min_backoff": {"seconds": 10},
                    "max_backoff": {"seconds": 300},
                    "max_doublings": 3,
                }
                
                response = tasks_client.create_task(
                    request={"parent": queue_path, "task": task}
                )
                
                logger.info(f"Task created for chunk {i}: {response.name}")
        
        except Exception as e:
            logger.error(f"Failed to create Cloud Tasks: {str(e)}")
            
            from firebase.credits import release_credits
            release_credits(uid, job_id, cost)
            
            return https_fn.Response(
                {"error": "Failed to queue generation task"},
                status=500,
                headers={"Access-Control-Allow-Origin": "*"}
            )
    
    else:
        # Single chunk (≤4 speakers) - use original flow
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "cost": cost,
            "text": text,
            "voice_samples": voice_samples,
        }
        
        if character_texts:
            task_payload["character_texts"] = character_texts
        
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
                "dispatch_deadline": {"seconds": 900},
            }
            
            if SERVICE_ACCOUNT:
                task["http_request"]["oidc_token"] = {
                    "service_account_email": SERVICE_ACCOUNT
                }
            
            task["retry_config"] = {
                "max_attempts": 3,
                "max_retry_duration": {"seconds": 1800},
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
            
            from firebase.credits import release_credits
            release_credits(uid, job_id, cost)
            
            return https_fn.Response(
                {"error": "Failed to queue generation task"},
                status=500,
                headers={"Access-Control-Allow-Origin": "*"}
            )
    
    # Return immediately with job_id
    logger.info(f"Job {job_id} queued successfully for user {uid} ({speaker_count} speakers, {len(chunks) if needs_chunking else 1} chunks)")
    
    return https_fn.Response(
        {
            "job_id": job_id,
            "status": "queued",
            "message": "Voice generation queued successfully",
            "speakerCount": speaker_count,
            "chunkCount": len(chunks) if needs_chunking else 1,
            "estimatedCost": cost
        },
        status=202,
        headers={
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    )


# Export all functions for Firebase deployment
__all__ = [
    'voice_clone',
    'generate_script',
    'dub_transcribe',
    'dub_translate',
    'dub_clone'
]