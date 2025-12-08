# functions/inference/routes/extract_audio.py
import os
import logging
import subprocess
import tempfile
from pathlib import Path
from google.cloud import storage, speech_v1 as speech
from firebase_admin import firestore

from utils.audio_processor import extract_audio_from_video

logger = logging.getLogger(__name__)
db = firestore.client()
storage_client = storage.Client()

GCS_DUBBING_BUCKET = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")


def extract_audio_route(request):
    """
    Extract audio from video (if needed) and start Google STT transcription
    """
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized extract-audio request")
        return {"error": "Unauthorized"}, 403
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    media_path = data.get("media_path")
    media_type = data.get("media_type", "audio")
    
    if not all([job_id, uid, media_path]):
        return {"error": "Missing required fields"}, 400
    
    logger.info(f"Job {job_id}: Starting audio extraction")
    
    # Get job document
    job_ref = db.collection("dubbingJobs").document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        return {"error": "Job not found"}, 404
    
    job_data = job_doc.to_dict()
    
    # Update status
    job_ref.update({
        "status": "extracting",
        "step": "Extracting audio from media...",
        "progress": 10,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    try:
        # Download media from GCS
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        media_blob = bucket.blob(media_path)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(media_path).suffix) as tmp_media:
            media_blob.download_to_filename(tmp_media.name)
            media_file_path = tmp_media.name
        
        # Extract audio if video
        if media_type == "video":
            audio_file_path = extract_audio_from_video(media_file_path)
            audio_extension = "wav"
        else:
            audio_file_path = media_file_path
            audio_extension = "wav"
        
        # Upload extracted audio to GCS
        audio_blob_path = f"jobs/{job_id}/audio.{audio_extension}"
        audio_blob = bucket.blob(audio_blob_path)
        audio_blob.upload_from_filename(audio_file_path)
        
        logger.info(f"Job {job_id}: Uploaded audio to gs://{GCS_DUBBING_BUCKET}/{audio_blob_path}")
        
        # Update job with audio path
        job_ref.update({
            "audioPath": audio_blob_path,
            "audioUrl": f"gs://{GCS_DUBBING_BUCKET}/{audio_blob_path}",
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        # Clean up temp files
        os.unlink(media_file_path)
        if media_type == "video" and audio_file_path != media_file_path:
            os.unlink(audio_file_path)
        
    except Exception as e:
        logger.error(f"Job {job_id}: Audio extraction failed: {str(e)}")
        job_ref.update({
            "status": "failed",
            "error": "Audio extraction failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        # Release credits
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Audio extraction failed"}, 500
    
    # Start Google Speech-to-Text transcription
    try:
        job_ref.update({
            "status": "transcribing",
            "step": "Transcribing audio...",
            "progress": 20,
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        client = speech.SpeechClient()
        
        audio = speech.RecognitionAudio(uri=f"gs://{GCS_DUBBING_BUCKET}/{audio_blob_path}")
        
        diarization_config = speech.SpeakerDiarizationConfig(
            enable_speaker_diarization=True,
            min_speaker_count=1,
            max_speaker_count=10,
        )
        
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=24000,
            language_code=job_data.get("detectedLanguageCode", "en-US"),
            enable_automatic_punctuation=True,
            diarization_config=diarization_config,
            model="latest_long",
        )
        
        # Long running recognize (async)
        operation = client.long_running_recognize(config=config, audio=audio)
        
        logger.info(f"Job {job_id}: Started STT operation")
        
        # Wait for operation to complete (this blocks)
        response = operation.result(timeout=1200)  # 20 minutes timeout
        
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
            if merged_transcript and \
               merged_transcript[-1]["speakerId"] == segment["speakerId"] and \
               (segment["startTime"] - merged_transcript[-1]["endTime"]) < 2.0:
                merged_transcript[-1]["text"] += f" {segment['text']}"
                merged_transcript[-1]["endTime"] = segment["endTime"]
            else:
                merged_transcript.append(segment)
        
        # Detect language from results
        detected_language_code = config.language_code
        
        # Update job with transcript
        job_ref.update({
            "transcript": merged_transcript,
            "detectedLanguageCode": detected_language_code,
            "status": "transcribing",
            "step": "Clustering speakers...",
            "progress": 40,
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Transcription complete, {len(merged_transcript)} segments")
        
        # Queue speaker clustering task
        from google.cloud import tasks_v2
        import json
        import base64
        
        CLOUD_RUN_URL = os.getenv("CLOUD_RUN_URL")
        GCP_PROJECT = os.getenv("GCP_PROJECT", "fennai")
        QUEUE_LOCATION = os.getenv("QUEUE_LOCATION", "us-central1")
        QUEUE_NAME = os.getenv("QUEUE_NAME", "voice-generation-queue")
        SERVICE_ACCOUNT = os.getenv("SERVICE_ACCOUNT_EMAIL")
        
        tasks_client = tasks_v2.CloudTasksClient()
        queue_path = tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)
        
        task_payload = {
            "job_id": job_id,
            "uid": uid,
            "audio_path": audio_blob_path,
        }
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{CLOUD_RUN_URL}/cluster-speakers",
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
        
        tasks_client.create_task(request={"parent": queue_path, "task": task})
        
        logger.info(f"Job {job_id}: Queued speaker clustering")
        
        return {"success": True, "segments": len(merged_transcript)}, 200
        
    except Exception as e:
        logger.error(f"Job {job_id}: Transcription failed: {str(e)}")
        job_ref.update({
            "status": "failed",
            "error": "Transcription failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Transcription failed"}, 500