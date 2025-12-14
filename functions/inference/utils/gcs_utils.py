# functions/inference/utils/gcs_utils.py
"""
Google Cloud Storage utilities with retry logic and circuit breaker.
Handles file uploads, downloads, and signed URL generation.
"""
import logging
from typing import Optional, BinaryIO
from datetime import timedelta
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

from google.cloud import storage
from google.api_core import retry, exceptions
from pydub import AudioSegment

from config import config

logger = logging.getLogger(__name__)

# Initialize storage client (reuse across requests)
storage_client = storage.Client()


@retry.Retry(
    predicate=retry.if_exception_type(
        exceptions.ServiceUnavailable,
        exceptions.TooManyRequests,
        exceptions.InternalServerError
    ),
    initial=1.0,
    maximum=10.0,
    multiplier=2.0,
    deadline=60.0
)
def upload_to_gcs(
    bucket_name: str,
    blob_path: str,
    data: bytes,
    content_type: str = "application/octet-stream"
) -> storage.Blob:
    """
    Upload data to GCS with retry logic.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
        data: Binary data to upload
        content_type: MIME type
    
    Returns:
        Uploaded blob
    
    Raises:
        google.api_core.exceptions.GoogleAPIError: On failure after retries
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.upload_from_string(data, content_type=content_type)
    
    logger.info(f"Uploaded to gs://{bucket_name}/{blob_path} ({len(data)} bytes)")
    return blob


@retry.Retry(
    predicate=retry.if_exception_type(
        exceptions.ServiceUnavailable,
        exceptions.TooManyRequests,
        exceptions.InternalServerError
    ),
    initial=1.0,
    maximum=10.0,
    multiplier=2.0,
    deadline=60.0
)
def upload_file_to_gcs(
    bucket_name: str,
    blob_path: str,
    file_path: str,
    content_type: str = "application/octet-stream"
) -> storage.Blob:
    """
    Upload file to GCS with retry logic.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
        file_path: Local file path
        content_type: MIME type
    
    Returns:
        Uploaded blob
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.upload_from_filename(file_path, content_type=content_type)
    
    logger.info(f"Uploaded file to gs://{bucket_name}/{blob_path}")
    return blob


@retry.Retry(
    predicate=retry.if_exception_type(
        exceptions.ServiceUnavailable,
        exceptions.TooManyRequests,
        exceptions.InternalServerError
    ),
    initial=1.0,
    maximum=10.0,
    multiplier=2.0,
    deadline=60.0
)
def download_from_gcs(bucket_name: str, blob_path: str) -> bytes:
    """
    Download data from GCS with retry logic.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
    
    Returns:
        Downloaded bytes
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    data = blob.download_as_bytes()
    
    logger.debug(f"Downloaded from gs://{bucket_name}/{blob_path} ({len(data)} bytes)")
    return data


@retry.Retry(
    predicate=retry.if_exception_type(
        exceptions.ServiceUnavailable,
        exceptions.TooManyRequests,
        exceptions.InternalServerError
    ),
    initial=1.0,
    maximum=10.0,
    multiplier=2.0,
    deadline=60.0
)
def download_to_file(bucket_name: str, blob_path: str, destination: str) -> None:
    """
    Download GCS object to local file with retry logic.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
        destination: Local file path
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(destination)
    
    logger.debug(f"Downloaded to {destination}")


def generate_signed_url(
    bucket_name: str,
    blob_path: str,
    expiration_hours: int = 24,
    service_account_email: Optional[str] = None  # <--- ADDED parameter
) -> str:
    """
    Generate signed URL for GCS object.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
        expiration_hours: URL expiration time in hours
        service_account_email: Service account email for signing (required in Cloud Run)
    
    Returns:
        Signed URL string
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    
    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(hours=expiration_hours),
        method="GET",
        service_account_email=service_account_email,  # <--- ADDED argument
    )
    
    return url

def parse_gcs_url(url: str) -> tuple[str, str]:
    """
    Parse GCS URL into bucket and blob path.
    
    Args:
        url: GCS URL (gs://bucket/path or https://...)
    
    Returns:
        Tuple of (bucket_name, blob_path)
    
    Example:
        >>> parse_gcs_url("gs://my-bucket/path/file.wav")
        ("my-bucket", "path/file.wav")
    """
    if url.startswith("gs://"):
        url = url.replace("gs://", "")
        parts = url.split("/", 1)
        return parts[0], parts[1] if len(parts) > 1 else ""
    
    raise ValueError(f"Invalid GCS URL: {url}")


def merge_audio_chunks_from_gcs(
    bucket_name: str,
    chunk_urls: list[str]
) -> BytesIO:
    """
    Download and merge multiple audio chunks from GCS in parallel.
    
    Args:
        bucket_name: GCS bucket name
        chunk_urls: List of GCS URLs (gs://...)
    
    Returns:
        BytesIO containing merged audio
    """
    def download_chunk(url: str, index: int) -> tuple[int, AudioSegment]:
        """Download a single chunk"""
        _, blob_path = parse_gcs_url(url)
        audio_bytes = download_from_gcs(bucket_name, blob_path)
        audio = AudioSegment.from_wav(BytesIO(audio_bytes))
        logger.debug(f"Downloaded chunk {index+1}/{len(chunk_urls)}")
        return index, audio
    
    # Download chunks in parallel
    chunks = {}
    with ThreadPoolExecutor(max_workers=config.PARALLEL_DOWNLOAD_WORKERS) as executor:
        futures = {
            executor.submit(download_chunk, url, i): i
            for i, url in enumerate(chunk_urls)
        }
        
        for future in as_completed(futures):
            try:
                idx, audio = future.result()
                chunks[idx] = audio
            except Exception as e:
                logger.error(f"Failed to download chunk: {e}")
                raise
    
    # Merge in order
    merged = None
    for i in sorted(chunks.keys()):
        merged = chunks[i] if merged is None else merged + chunks[i]
    
    if merged is None:
        raise ValueError("No chunks to merge")
    
    # Export to BytesIO
    output = BytesIO()
    merged.export(output, format="wav")
    output.seek(0)
    
    logger.info(f"Merged {len(chunk_urls)} audio chunks")
    return output


def batch_delete_blobs(bucket_name: str, blob_paths: list[str]) -> int:
    """
    Delete multiple blobs from GCS.
    
    Args:
        bucket_name: GCS bucket name
        blob_paths: List of blob paths to delete
    
    Returns:
        Number of successfully deleted blobs
    """
    bucket = storage_client.bucket(bucket_name)
    deleted = 0
    
    for blob_path in blob_paths:
        try:
            blob = bucket.blob(blob_path)
            blob.delete()
            deleted += 1
        except Exception as e:
            logger.warning(f"Failed to delete {blob_path}: {e}")
    
    logger.info(f"Deleted {deleted}/{len(blob_paths)} blobs")
    return deleted


def blob_exists(bucket_name: str, blob_path: str) -> bool:
    """
    Check if blob exists in GCS.
    
    Args:
        bucket_name: GCS bucket name
        blob_path: Path within bucket
    
    Returns:
        True if blob exists
    """
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    return blob.exists()