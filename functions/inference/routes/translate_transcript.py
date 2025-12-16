"""
Translate transcript route.
Translates the transcript and prepares audio chunks for synthesis.
"""
import logging
import json
import base64
import html
from google.cloud import translate_v2 as translate
from google.cloud import tasks_v2
from firebase_admin import firestore
from google.cloud.firestore import SERVER_TIMESTAMP

from config import config
from utils.validators import validate_request, TranslateTranscriptRequest
from middleware import extract_job_info, get_job_document, update_job_status

logger = logging.getLogger(__name__)
db = firestore.client()


def translate_transcript_route():
    """
    Translate transcript and queue inference jobs.
    """
    # Validate request
    req = validate_request(TranslateTranscriptRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    target_language = req.target_language
    
    logger.info(f"Job {job_id}: Starting translation to {target_language}")
    
    # Get job data
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    transcript = job_data.get("transcript", [])
    
    if not transcript:
        raise ValueError("No transcript found")
    
    update_job_status(job_id, "translating", "Translating transcript...", 60, "dubbingJobs")
    
    # Translate
    try:
        translate_client = translate.Client()
        
        full_text = [t["text"] for t in transcript]
        
        # Perform translation
        results = translate_client.translate(
            full_text,
            target_language=target_language,
            format_="text"
        )
        
        # Handle single result case (if list was length 1, sometimes it returns dict, but usually list for list input)
        if isinstance(results, dict):
            results = [results]
            
        translated_transcript = []
        cloned_audio_chunks = []
        
        for i, res in enumerate(results):
            original_segment = transcript[i]
            translated_text = res["translatedText"]
            
            # Unescape HTML entities
            translated_text = html.unescape(translated_text)
            
            translated_segment = original_segment.copy()
            translated_segment["text"] = translated_text
            translated_segment["originalText"] = original_segment["text"]
            translated_transcript.append(translated_segment)
            
            # Create chunk for inference
            # We assume we want to clone the original speaker
            speaker_id = original_segment["speakerId"] # e.g. "speaker_1"
            
            cloned_audio_chunks.append({
                "chunkId": i,
                "text": translated_text,
                "characterIds": [f"original:{speaker_id}"],
                "startTime": original_segment["startTime"],
                "endTime": original_segment["endTime"],
                "status": "pending",
                "speakerId": speaker_id
            })
            
        # Update job with translated transcript and initialized chunks
        job_ref.update({
            "translatedTranscript": translated_transcript,
            "clonedAudioChunks": cloned_audio_chunks,
            "targetLanguage": target_language,
            "status": "cloning",
            "step": "Synthesizing dubbed audio...",
            "progress": 70,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Translation complete, queuing {len(cloned_audio_chunks)} inference tasks")
        
        # Queue inference tasks
        tasks_client = tasks_v2.CloudTasksClient()
        queue_path = tasks_client.queue_path(
            config.GCP_PROJECT,
            config.QUEUE_LOCATION,
            config.QUEUE_NAME
        )
        
        for chunk in cloned_audio_chunks:
            task_payload = {
                "job_id": job_id,
                "uid": uid,
                "chunk_id": chunk["chunkId"]
            }
            
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": f"{config.CLOUD_RUN_URL}/inference",
                    "headers": {
                        "Content-Type": "application/json",
                        "X-Internal-Token": config.INTERNAL_TOKEN,
                    },
                    "body": base64.b64encode(json.dumps(task_payload).encode()).decode(),
                },
                "dispatch_deadline": {"seconds": config.TASK_DEADLINE},
            }
            
            if config.SERVICE_ACCOUNT_EMAIL:
                task["http_request"]["oidc_token"] = {
                    "service_account_email": config.SERVICE_ACCOUNT_EMAIL
                }
                
            tasks_client.create_task(request={"parent": queue_path, "task": task})
            
        return {
            "success": True, 
            "segments": len(translated_transcript),
            "queued_chunks": len(cloned_audio_chunks)
        }, 200
        
    except Exception as e:
        logger.error(f"Translation failed: {str(e)}", exc_info=True)
        # We don't want to fail the job immediately if it's a transient translation error,
        # but the route handler doesn't have retry logic built-in yet (handled by Caller or Task queue)
        # However, we should probably raise so the generic error handler catches it
        raise
