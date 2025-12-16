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
from middleware import extract_job_info, update_job_status, get_job_document
from pydantic import ValidationError
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()


def extract_audio_route():
    """
    Extract audio from video (if needed) and start Google STT transcription.
    All errors are handled by @handle_job_errors decorator.
    """
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
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    
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
    
    stt_config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=config.SAMPLE_RATE,
        language_code=job_data.get("detectedLanguageCode", "en-US"),
        enable_automatic_punctuation=True,
        diarization_config=diarization_config,
        model="latest_long",
    )
    
    # Long running recognize (async)
    operation = client.long_running_recognize(config=stt_config, audio=audio)
    
    logger.info(f"Job {job_id}: Started STT operation")
    
    # Wait for operation to complete
    response = operation.result(timeout=config.STT_TIMEOUT)
    
    # Process results
    transcript = []
    
    for result in response.results:
        alternative = result.alternatives[0]
        
        for word_info in alternative.words:
            speaker_tag = word_info.speaker_tag
            word = word_info.word
            start_time = word_info.start_time.total_seconds()
            end_time = word_info.end_time.total_seconds()
            
            # Group consecutive words from same speaker
            if transcript and transcript[-1]["speakerId"] == f"speaker_{speaker_tag}":
                transcript[-1]["text"] += f" {word}"
                transcript[-1]["endTime"] = end_time
            else:
                transcript.append({
                    "speakerId": f"speaker_{speaker_tag}",
                    "text": word,
                    "startTime": start_time,
                    "endTime": end_time,
                    "confidence": alternative.confidence,
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
    
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{config.CLOUD_RUN_URL}/cluster-speakers",
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