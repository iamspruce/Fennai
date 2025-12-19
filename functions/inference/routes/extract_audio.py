# functions/inference/routes/extract_audio.py
"""
Audio extraction route with improved error handling and resource cleanup.
Extracts audio from video and starts Google STT transcription.
"""
import logging
from pathlib import Path
from google.cloud import speech_v1 as speech, tasks_v2
from firebase_admin import firestore
import base64
import json

from config import config
from utils.cleanup import temp_file
from utils.gcs_utils import download_to_file, upload_file_to_gcs
from utils.audio_processor import extract_audio_from_video
from utils.validators import validate_request, ExtractAudioRequest
from middleware import (
    extract_job_info, 
    update_job_status, 
    get_job_document,
    get_retry_info,
    update_job_retry_status
)
from pydantic import ValidationError
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()

# BCP-47 Language Mapping for Google STT
LANGUAGE_MAP = {
    'en': 'en-US',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'it': 'it-IT',
    'pt': 'pt-PT',
    'ru': 'ru-RU',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'zh': 'zh-CN',
    'ar': 'ar-SA',
    'hi': 'hi-IN',
    'tr': 'tr-TR',
    'vi': 'vi-VN',
    'nl': 'nl-NL',
    'pl': 'pl-PL'
}


def extract_audio_route():
    """
    Extract audio from video (if needed) and start Google STT transcription.
    """
    # Get retry info
    retry_count, is_retry, is_final_attempt = get_retry_info()
    
    if is_retry:
        logger.info(f"🔄 Retry attempt {retry_count}/{config.MAX_RETRY_ATTEMPTS} for extract_audio")

    # Validate request
    try:
        req = validate_request(ExtractAudioRequest, {
            "job_id": extract_job_info()[0],
            "uid": extract_job_info()[1],
            **extract_job_info()[2]
        })
    except ValidationError as e:
        return {"error": "Invalid request", "details": e.errors()}, 400
    
    job_id = req.job_id
    uid = req.uid
    media_path = req.media_path
    media_type = req.media_type
    
    logger.info(f"Job {job_id}: Starting audio extraction")
    
    # Get job document
    try:
        job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    except Exception as e:
        logger.error(f"Job {job_id} not found: {str(e)}")
        return {"error": "Job not found"}, 404

    try:
        # Update status
        update_job_status(
            job_id,
            "extracting",
            step="Extracting audio from media...",
            progress=10,
            collection="dubbingJobs"
        )
        
        # Download and extract audio
        with temp_file(suffix=Path(media_path).suffix) as media_file_path:
            # Download media from GCS
            download_to_file(config.GCS_DUBBING_BUCKET, media_path, media_file_path)
            
            # Extract audio if video
            if media_type == "video":
                # extract_audio_from_video returns the path to the extracted audio
                audio_file_path = extract_audio_from_video(media_file_path)
                
                try:
                    # Upload extracted audio
                    audio_blob_path = f"jobs/{job_id}/audio.wav"
                    upload_file_to_gcs(
                        config.GCS_DUBBING_BUCKET,
                        audio_blob_path,
                        audio_file_path,
                        content_type="audio/wav"
                    )
                finally:
                    # Clean up the temporary file created by extract_audio_from_video
                    import os
                    if os.path.exists(audio_file_path):
                        os.remove(audio_file_path)
            else:
                # Audio file - just re-upload
                audio_blob_path = f"jobs/{job_id}/audio.wav"
                upload_file_to_gcs(
                    config.GCS_DUBBING_BUCKET,
                    audio_blob_path,
                    media_file_path,
                    content_type="audio/wav"
                )
        
        # Update job with audio path
        job_ref.update({
            "audioPath": audio_blob_path,
            "audioUrl": f"gs://{config.GCS_DUBBING_BUCKET}/{audio_blob_path}",
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Audio extraction complete")
        
        # Start Google Speech-to-Text transcription
        update_job_status(
            job_id,
            "transcribing",
            step="Transcribing audio...",
            progress=20,
            collection="dubbingJobs"
        )
        
        client = speech.SpeechClient()
        
        audio = speech.RecognitionAudio(
            uri=f"gs://{config.GCS_DUBBING_BUCKET}/{audio_blob_path}"
        )
        
        diarization_config = speech.SpeakerDiarizationConfig(
            enable_speaker_diarization=True,
            min_speaker_count=config.MIN_SPEAKER_COUNT,
            max_speaker_count=config.MAX_SPEAKER_COUNT,
        )
        
        # Map 2-letter code to BCP-47 if necessary
        raw_lang_code = str(job_data.get("detectedLanguageCode", "en-US") or "en-US")
        stt_lang_code = str(LANGUAGE_MAP.get(raw_lang_code, raw_lang_code))
        
        # Ensure it's not just 2 characters (Google 'latest_long' is picky)
        if len(stt_lang_code) == 2:
            stt_lang_code = f"{stt_lang_code}-{stt_lang_code.upper()}"

        stt_config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=config.SAMPLE_RATE,
            language_code=stt_lang_code,
            enable_automatic_punctuation=True,
            diarization_config=diarization_config,
            model="latest_long",
        )
        
        # Long running recognize (async)
        operation = client.long_running_recognize(config=stt_config, audio=audio)
        
        logger.info(f"Job {job_id}: Started STT operation")
        
        # Wait for operation to complete
        response = operation.result(timeout=config.STT_TIMEOUT)
        
        # Process results - collect all words first to deduplicate
        all_words = []
        seen_words = set()  # (start, end, word)
        
        for result in response.results:
            if not result.alternatives:
                continue
                
            alternative = result.alternatives[0]
            # Some results might be alternatives or overlaps, especially with diarization.
            # We collect all words and deduplicate by time and content.
            for word_info in alternative.words:
                start_time = word_info.start_time.total_seconds()
                end_time = word_info.end_time.total_seconds()
                word = word_info.word
                speaker_tag = word_info.speaker_tag
                
                # Deduplication key
                # We use a small epsilon for time comparison if needed, but usually exact match works
                word_key = (round(start_time, 3), round(end_time, 3), word.strip().lower())
                
                if word_key not in seen_words:
                    all_words.append({
                        "speakerId": f"speaker_{speaker_tag}",
                        "text": word,
                        "startTime": start_time,
                        "endTime": end_time,
                        "confidence": alternative.confidence
                    })
                    seen_words.add(word_key)
        
        # Sort words by start time
        all_words.sort(key=lambda x: x["startTime"])
        
        # Group consecutive words from same speaker
        transcript = []
        for word_data in all_words:
            speaker_id = word_data["speakerId"]
            word = word_data["text"]
            start_time = word_data["startTime"]
            end_time = word_data["endTime"]
            
            if transcript and transcript[-1]["speakerId"] == speaker_id:
                # Check for large gaps (e.g. > 3 seconds) - start a new segment if gap is large
                if start_time - transcript[-1]["endTime"] > 3.0:
                    transcript.append({
                        "speakerId": speaker_id,
                        "text": word,
                        "startTime": start_time,
                        "endTime": end_time,
                        "confidence": word_data["confidence"]
                    })
                else:
                    transcript[-1]["text"] += f" {word}"
                    transcript[-1]["endTime"] = end_time
            else:
                transcript.append({
                    "speakerId": speaker_id,
                    "text": word,
                    "startTime": start_time,
                    "endTime": end_time,
                    "confidence": word_data["confidence"]
                })
        
        # Merge short segments (less than 2 seconds)
        merged_transcript = []
        for segment in transcript:
            if (merged_transcript and
                merged_transcript[-1]["speakerId"] == segment["speakerId"] and
                (segment["startTime"] - merged_transcript[-1]["endTime"]) < 2.0):
                merged_transcript[-1]["text"] += f" {segment['text']}"
                merged_transcript[-1]["endTime"] = segment["endTime"]
            else:
                merged_transcript.append(segment)
        
        # Update job with transcript
        job_ref.update({
            "transcript": merged_transcript,
            "status": "transcribing",
            "step": "Clustering speakers...",
            "progress": 40,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Transcription complete, {len(merged_transcript)} segments")
        
        # Queue speaker clustering task
        tasks_client = tasks_v2.CloudTasksClient()
        queue_path = tasks_client.queue_path(
            config.GCP_PROJECT,
            config.QUEUE_LOCATION,
            config.QUEUE_NAME
        )
        
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "audio_path": audio_blob_path,
        }

        cloud_run_url = config.CLOUD_RUN_URL
        if not cloud_run_url:
            # Construct URL from service name and region
            cloud_run_url = f"https://fennai-inference-{config.GCP_PROJECT}.a.run.app"
            logger.warning(f"CLOUD_RUN_URL not set, using constructed URL: {cloud_run_url}")

        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{cloud_run_url}/cluster-speakers",
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
        
        logger.info(f"Job {job_id}: Queued speaker clustering")
        
        return {"success": True, "segments": len(merged_transcript)}, 200

    except Exception as e:
        error_msg = f"Audio extraction/STT failed: {str(e)}"
        logger.error(f"Job {job_id}: {error_msg}", exc_info=True)
        
        if is_final_attempt:
            update_job_retry_status(job_ref, retry_count, error_msg, True)
            from firebase.credits import release_credits
            release_credits(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
            return {"error": error_msg}, 500
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return {"error": "Retrying", "retry": retry_count}, 500