# functions/proxy/utils/task_helper.py
"""
Helper module for creating Cloud Tasks with standardized configuration.
"""
import os
import json
import base64
import logging
from typing import Dict, Any, Optional, Tuple
from google.cloud import tasks_v2

logger = logging.getLogger(__name__)

# Environment variables
CLOUD_RUN_URL = os.environ.get("CLOUD_RUN_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")
GCP_PROJECT = os.environ.get("GCP_PROJECT", "fennai")
QUEUE_LOCATION = os.environ.get("QUEUE_LOCATION", "us-central1")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "voice-generation-queue")
SERVICE_ACCOUNT = os.environ.get("SERVICE_ACCOUNT_EMAIL")

# Initialize Cloud Tasks client (singleton)
_tasks_client = None
_queue_path = None


def get_tasks_client() -> tasks_v2.CloudTasksClient:
    """Get or create Cloud Tasks client singleton."""
    global _tasks_client, _queue_path
    
    if _tasks_client is None:
        _tasks_client = tasks_v2.CloudTasksClient()
        _queue_path = _tasks_client.queue_path(GCP_PROJECT, QUEUE_LOCATION, QUEUE_NAME)
    
    return _tasks_client


def get_queue_path() -> str:
    """Get Cloud Tasks queue path."""
    get_tasks_client()  # Ensure initialization
    return _queue_path


def create_cloud_task(
    task_payload: Dict[str, Any],
    endpoint: str = "/inference",
    dispatch_deadline_seconds: int = 900,
    max_retry_attempts: int = 3
) -> Tuple[bool, Optional[str]]:
    """
    Create a Cloud Task with standardized configuration.
    
    Args:
        task_payload: JSON payload for the task
        endpoint: Cloud Run endpoint path (e.g., "/inference", "/extract-audio")
        dispatch_deadline_seconds: Maximum time for task execution
        max_retry_attempts: Maximum number of retry attempts
        
    Returns:
        Tuple of (success, error_message)
    """
    if not CLOUD_RUN_URL or not INTERNAL_TOKEN:
        error_msg = "Cloud Run URL or Internal Token not configured"
        logger.error(error_msg)
        return False, error_msg
    
    try:
        client = get_tasks_client()
        queue_path = get_queue_path()
        
        # Build task configuration
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{CLOUD_RUN_URL}{endpoint}",
                "headers": {
                    "Content-Type": "application/json",
                    "X-Internal-Token": INTERNAL_TOKEN,
                },
                "body": base64.b64encode(
                    json.dumps(task_payload).encode()
                ).decode(),
            },
            "dispatch_deadline": {"seconds": dispatch_deadline_seconds},
            "retry_config": {
                "max_attempts": max_retry_attempts,
                "max_retry_duration": {"seconds": dispatch_deadline_seconds * 2},
                "min_backoff": {"seconds": 10},
                "max_backoff": {"seconds": 300},
                "max_doublings": 3,
            }
        }
        
        # Add OIDC token if service account is configured
        if SERVICE_ACCOUNT:
            task["http_request"]["oidc_token"] = {
                "service_account_email": SERVICE_ACCOUNT
            }
        
        # Create the task
        response = client.create_task(
            request={"parent": queue_path, "task": task}
        )
        
        logger.info(f"Task created: {response.name} -> {endpoint}")
        return True, None
        
    except Exception as e:
        error_msg = f"Failed to create Cloud Task: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return False, error_msg


def create_batch_tasks(
    tasks: list[Dict[str, Any]],
    endpoint: str = "/inference"
) -> Tuple[int, int, list[str]]:
    """
    Create multiple Cloud Tasks in batch.
    
    Args:
        tasks: List of task payloads
        endpoint: Cloud Run endpoint path
        
    Returns:
        Tuple of (success_count, failure_count, error_messages)
    """
    success_count = 0
    failure_count = 0
    errors = []
    
    for idx, task_payload in enumerate(tasks):
        success, error = create_cloud_task(task_payload, endpoint)
        
        if success:
            success_count += 1
        else:
            failure_count += 1
            errors.append(f"Task {idx}: {error}")
    
    logger.info(
        f"Batch task creation complete: {success_count} succeeded, "
        f"{failure_count} failed"
    )
    
    return success_count, failure_count, errors