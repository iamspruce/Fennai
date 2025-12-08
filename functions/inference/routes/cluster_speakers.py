# functions/inference/routes/cluster_speakers.py
import os
import logging
import tempfile
import numpy as np
from pathlib import Path
from google.cloud import storage
from firebase_admin import firestore
from pydub import AudioSegment

from utils.speaker_clustering import cluster_speakers_embeddings, generate_speaker_sample

logger = logging.getLogger(__name__)
db = firestore.client()
storage_client = storage.Client()

GCS_DUBBING_BUCKET = os.getenv("GCS_DUBBING_BUCKET", "fennai-dubbing-temp")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")


def cluster_speakers_route(request):
    """
    Cluster speakers using Resemblyzer embeddings + HDBSCAN
    Generate 15-second voice samples for each unique speaker
    """
    
    # Verify internal token
    if request.headers.get("X-Internal-Token") != INTERNAL_TOKEN:
        logger.warning("Unauthorized cluster-speakers request")
        return {"error": "Unauthorized"}, 403
    
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    uid = data.get("uid")
    audio_path = data.get("audio_path")
    
    if not all([job_id, uid, audio_path]):
        return {"error": "Missing required fields"}, 400
    
    logger.info(f"Job {job_id}: Starting speaker clustering")
    
    # Get job document
    job_ref = db.collection("dubbingJobs").document(job_id)
    job_doc = job_ref.get()
    
    if not job_doc.exists:
        return {"error": "Job not found"}, 404
    
    job_data = job_doc.to_dict()
    transcript = job_data.get("transcript", [])
    
    if not transcript:
        return {"error": "No transcript available"}, 400
    
    # Update status
    job_ref.update({
        "status": "clustering",
        "step": "Analyzing speaker voices...",
        "progress": 50,
        "updatedAt": firestore.SERVER_TIMESTAMP
    })
    
    try:
        # Download audio from GCS
        bucket = storage_client.bucket(GCS_DUBBING_BUCKET)
        audio_blob = bucket.blob(audio_path)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_audio:
            audio_blob.download_to_filename(tmp_audio.name)
            audio_file_path = tmp_audio.name
        
        # Load audio
        audio = AudioSegment.from_wav(audio_file_path)
        
        # Extract audio chunks for each transcript segment
        audio_chunks = []
        for segment in transcript:
            start_ms = int(segment["startTime"] * 1000)
            end_ms = int(segment["endTime"] * 1000)
            chunk = audio[start_ms:end_ms]
            
            # Save chunk to temp file for Resemblyzer
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_chunk:
                chunk.export(tmp_chunk.name, format="wav")
                audio_chunks.append(tmp_chunk.name)
        
        # Cluster speakers
        speaker_mapping = cluster_speakers_embeddings(audio_chunks)
        
        # Map STT speaker tags to clustered speaker IDs
        unique_speakers = set(speaker_mapping.values())
        logger.info(f"Job {job_id}: Found {len(unique_speakers)} unique speakers")
        
        # Update transcript with consistent speaker IDs
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
        
        # Generate voice samples for each speaker (15 seconds)
        speaker_voice_samples = {}
        speakers_info = []
        
        for speaker_id, segments in speaker_segments.items():
            # Generate sample
            sample_path = generate_speaker_sample(
                audio_file_path,
                segments,
                target_duration=15.0
            )
            
            if sample_path:
                # Upload sample to GCS
                sample_blob_path = f"jobs/{job_id}/samples/{speaker_id}.wav"
                sample_blob = bucket.blob(sample_blob_path)
                sample_blob.upload_from_filename(sample_path)
                
                sample_url = f"gs://{GCS_DUBBING_BUCKET}/{sample_blob_path}"
                speaker_voice_samples[speaker_id] = sample_url
                
                # Calculate total duration
                total_duration = sum(s["endTime"] - s["startTime"] for s in segments)
                
                speakers_info.append({
                    "id": speaker_id,
                    "voiceSampleUrl": sample_url,
                    "voiceSamplePath": sample_blob_path,
                    "totalDuration": total_duration,
                    "segmentCount": len(segments)
                })
                
                # Clean up temp sample
                os.unlink(sample_path)
            
            logger.info(f"Job {job_id}: Generated sample for {speaker_id}")
        
        # Clean up temp files
        os.unlink(audio_file_path)
        for chunk_path in audio_chunks:
            try:
                os.unlink(chunk_path)
            except:
                pass
        
        # Update job with clustered transcript and speaker info
        job_ref.update({
            "transcript": transcript,
            "speakers": speakers_info,
            "speakerVoiceSamples": speaker_voice_samples,
            "status": "transcribing_done",
            "step": "Transcription complete. Ready for dubbing settings.",
            "progress": 55,
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        logger.info(f"Job {job_id}: Speaker clustering complete")
        
        return {
            "success": True,
            "uniqueSpeakers": len(unique_speakers),
            "segments": len(transcript)
        }, 200
        
    except Exception as e:
        logger.error(f"Job {job_id}: Speaker clustering failed: {str(e)}")
        job_ref.update({
            "status": "failed",
            "error": "Speaker clustering failed",
            "errorDetails": str(e),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        
        from shared.credits import release_credits
        release_credits(uid, job_id, job_data.get("cost", 0))
        
        return {"error": "Speaker clustering failed"}, 500