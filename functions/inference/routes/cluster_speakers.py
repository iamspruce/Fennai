"""Speaker clustering route with improved resource management"""
import logging
import os
from firebase_admin import firestore

from config import config
from utils.cleanup import temp_file, TempFileManager
from utils.gcs_utils import download_to_file, upload_file_to_gcs
from utils.speaker_clustering import cluster_speakers_embeddings, generate_speaker_sample
from utils.validators import validate_request, ClusterSpeakersRequest
from middleware import extract_job_info, get_job_document, update_job_status
from pydub import AudioSegment
from google.cloud.firestore import SERVER_TIMESTAMP

logger = logging.getLogger(__name__)
db = firestore.client()


def cluster_speakers_route():
    """Cluster speakers and generate voice samples"""
    req = validate_request(ClusterSpeakersRequest, extract_job_info()[2])
    job_id = req.job_id
    uid = req.uid
    audio_path = req.audio_path
    
    logger.info(f"Job {job_id}: Starting speaker clustering")
    
    job_ref, job_data = get_job_document(job_id, "dubbingJobs")
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
        speaker_mapping = cluster_speakers_embeddings(audio_chunks)
        unique_speakers = set(speaker_mapping.values())
        
        logger.info(f"Job {job_id}: Found {len(unique_speakers)} unique speakers")
        
        # Update transcript with speaker IDs
        for i, segment in enumerate(transcript):
            cluster_id = speaker_mapping[i]
            segment["speakerId"] = f"speaker_{cluster_id + 1}"
        
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

