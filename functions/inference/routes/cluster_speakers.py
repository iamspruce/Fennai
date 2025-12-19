"""Speaker clustering route with improved resource management"""
import logging
import os
from firebase_admin import firestore

from config import config
from utils.cleanup import temp_file, TempFileManager
from utils.gcs_utils import download_to_file, upload_file_to_gcs
from utils.speaker_clustering import cluster_speakers_embeddings, generate_speaker_sample
from utils.validators import validate_request, ClusterSpeakersRequest
from middleware import (
    extract_job_info, 
    get_job_document, 
    update_job_status,
    get_retry_info,
    update_job_retry_status
)
from pydub import AudioSegment
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()


def cluster_speakers_route():
    """Cluster speakers and generate voice samples"""
    # Get retry info
    retry_count, is_retry, is_final_attempt = get_retry_info()
    
    if is_retry:
        logger.info(f"🔄 Retry attempt {retry_count}/{config.MAX_RETRY_ATTEMPTS} for cluster_speakers")

    # Validate request
    try:
        req = validate_request(ClusterSpeakersRequest, extract_job_info()[2])
    except Exception as e:
        return {"error": "Invalid request", "details": str(e)}, 400

    job_id = req.job_id
    uid = req.uid
    audio_path = req.audio_path
    
    logger.info(f"Job {job_id}: Starting speaker clustering")
    
    # Get job document
    try:
        job_ref, job_data = get_job_document(job_id, "dubbingJobs")
    except Exception as e:
        logger.error(f"Job {job_id} not found: {str(e)}")
        return {"error": "Job not found"}, 404

    try:
        transcript = job_data.get("transcript", [])
        
        if not transcript:
            raise ValueError("No transcript available")
        
        update_job_status(job_id, "clustering", "Analyzing speaker voices...", 50, "dubbingJobs")
        
        # Use TempFileManager for multiple temp files
        with TempFileManager() as tmp_manager:
            # Download audio
            audio_file_path = tmp_manager.create(".wav")
            download_to_file(config.GCS_DUBBING_BUCKET, audio_path, audio_file_path)
            
            audio = AudioSegment.from_wav(audio_file_path)
            
            # Extract audio chunks
            audio_chunks = []
            for segment in transcript:
                start_ms = int(segment["startTime"] * 1000)
                end_ms = int(segment["endTime"] * 1000)
                chunk = audio[start_ms:end_ms]
                
                chunk_path = tmp_manager.create(".wav")
                chunk.export(chunk_path, format="wav")
                audio_chunks.append(chunk_path)
            
            # Cluster speakers
            if len(audio_chunks) < 2:
                logger.info(f"Job {job_id}: {len(audio_chunks)} segments found. Skipping clustering.")
                speaker_mapping = {i: 0 for i in range(len(audio_chunks))}
                unique_speakers = {0}
            else:
                try:
                    speaker_mapping = cluster_speakers_embeddings(audio_chunks)
                    unique_speakers = set(speaker_mapping.values())
                    
                    logger.info(f"Job {job_id}: Found {len(unique_speakers)} unique speakers")
                    
                    # Update transcript with speaker IDs
                    for i, segment in enumerate(transcript):
                        cluster_id = speaker_mapping[i]
                        segment["speakerId"] = f"speaker_{cluster_id + 1}"
                except Exception as e:
                    logger.warning(f"Job {job_id}: Speaker clustering failed ({str(e)}). Falling back to transcript speaker IDs.")
                    # Fallback: use existing speaker IDs from transcript (e.g. "speaker_0", "speaker_1" from STT)
                    unique_speakers = set(s["speakerId"] for s in transcript)
            
            # Group segments by speaker
            speaker_segments = {}
            for segment in transcript:
                speaker_id = segment["speakerId"]
                if speaker_id not in speaker_segments:
                    speaker_segments[speaker_id] = []
                speaker_segments[speaker_id].append(segment)
            
            # Generate voice samples
            speaker_voice_samples = {}
            speakers_info = []
            
            for speaker_id, segments in speaker_segments.items():
                sample_path = generate_speaker_sample(
                    audio_file_path,
                    segments,
                    target_duration=config.SPEAKER_SAMPLE_TARGET_DURATION
                )
                
                if sample_path:
                    try:
                        sample_blob_path = f"jobs/{job_id}/samples/{speaker_id}.wav"
                        upload_file_to_gcs(
                            config.GCS_DUBBING_BUCKET,
                            sample_blob_path,
                            sample_path,
                            "audio/wav"
                        )
                        
                        sample_url = f"gs://{config.GCS_DUBBING_BUCKET}/{sample_blob_path}"
                        speaker_voice_samples[speaker_id] = sample_url
                        
                        total_duration = sum(s["endTime"] - s["startTime"] for s in segments)
                        
                        speakers_info.append({
                            "id": speaker_id,
                            "voiceSampleUrl": sample_url,
                            "voiceSamplePath": sample_blob_path,
                            "totalDuration": total_duration,
                            "segmentCount": len(segments)
                        })
                        
                        logger.info(f"Job {job_id}: Generated sample for {speaker_id}")
                    finally:
                        # Clean up temp file after upload
                        if os.path.exists(sample_path):
                            os.unlink(sample_path)

        # Update job
        job_ref.update({
            "transcript": transcript,
            "speakers": speakers_info,
            "speakerVoiceSamples": speaker_voice_samples,
            "status": "transcribing_done",
            "step": "Transcription complete. Ready for dubbing settings.",
            "progress": 55,
            "updatedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Speaker clustering complete")
        
        return {
            "success": True,
            "uniqueSpeakers": len(unique_speakers),
            "segments": len(transcript)
        }, 200

    except Exception as e:
        error_msg = f"Speaker clustering failed: {str(e)}"
        logger.error(f"Job {job_id}: {error_msg}", exc_info=True)
        
        if is_final_attempt:
            update_job_retry_status(job_ref, retry_count, error_msg, True)
            from firebase.credits import release_credits
            release_credits(uid, job_id, job_data.get("cost", 0), collection_name="dubbingJobs")
            return {"error": error_msg}, 500
        else:
            update_job_retry_status(job_ref, retry_count, error_msg, False)
            return {"error": "Retrying", "retry": retry_count}, 500

