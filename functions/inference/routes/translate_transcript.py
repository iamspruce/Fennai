"""Translate transcript segments using Google Translate API"""
import logging
from google.cloud import translate_v2 as translate
from firebase_admin import firestore

from config import config
from utils.validators import validate_request
from middleware import extract_job_info, get_job_document, update_job_status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
db = firestore.client()


class TranslateTranscriptRequest(BaseModel):
    """Validation for translate transcript request"""
    job_id: str = Field(..., min_length=1, max_length=100)
    uid: str = Field(..., min_length=1, max_length=100)
    target_language: str = Field(..., min_length=2, max_length=10)
    transcript: list = Field(..., min_items=1)


def translate_transcript_route():
    """
    Translate transcript segments to target language.
    Called from proxy's dub_translate route.
    """
    req = validate_request(TranslateTranscriptRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    target_language = req.target_language
    transcript = req.transcript
    
    logger.info(f"Job {job_id}: Translating to {target_language}")
    
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    
    update_job_status(
        job_id,
        "translating",
        f"Translating to {target_language}...",
        60,
        "dubbingJobs"
    )
    
    # Initialize Google Translate client
    translate_client = translate.Client()
    
    # Translate each segment
    translated_transcript = []
    for segment in transcript:
        text = segment.get("text", "")
        
        if not text:
            translated_transcript.append(segment)
            continue
        
        try:
            # Translate text
            result = translate_client.translate(
                text,
                target_language=target_language,
                source_language="auto"  # Auto-detect source
            )
            
            # Add translated text to segment
            segment_copy = segment.copy()
            segment_copy["translatedText"] = result["translatedText"]
            segment_copy["detectedSourceLanguage"] = result.get("detectedSourceLanguage")
            translated_transcript.append(segment_copy)
            
        except Exception as e:
            logger.error(f"Translation failed for segment: {e}")
            segment_copy = segment.copy()
            segment_copy["translatedText"] = text  # Fallback to original
            segment_copy["translationError"] = str(e)
            translated_transcript.append(segment_copy)
    
    # Update job with translated transcript
    job_ref.update({
        "transcript": translated_transcript,
        "targetLanguage": target_language,
        "status": "translated",
        "step": "Translation complete. Ready for voice cloning.",
        "progress": 65,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    logger.info(f"Job {job_id}: Translation complete")
    
    return {
        "success": True,
        "translatedSegments": len(translated_transcript)
    }, 200
