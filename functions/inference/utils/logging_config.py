# functions/inference/utils/logging_config.py
"""
Structured logging configuration with request tracing.
Provides context-aware logging with job IDs and request IDs.
"""
import logging
import uuid
from typing import Optional, Dict, Any
from flask import request, g, has_request_context


class RequestContextFilter(logging.Filter):
    """Add request and job context to log records"""
    
    def filter(self, record: logging.LogRecord) -> bool:
        if has_request_context():
            record.request_id = getattr(g, 'request_id', 'NO_REQUEST_ID')
            record.job_id = getattr(request, 'job_id', 'NO_JOB')
        else:
            record.request_id = 'NO_REQUEST_ID'
            record.job_id = 'NO_JOB'
        
        return True


def setup_logging(log_level: str = "INFO") -> None:
    """
    Configure application logging with structured format.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    # Create formatter with request context
    formatter = logging.Formatter(
        fmt='%(asctime)s | %(request_id)s | %(job_id)s | %(levelname)s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Add console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(RequestContextFilter())
    root_logger.addHandler(console_handler)
    
    # Reduce noise from third-party libraries
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('google').setLevel(logging.WARNING)
    logging.getLogger('werkzeug').setLevel(logging.WARNING)


def add_request_id() -> None:
    """
    Add request ID to Flask request context.
    Should be called in before_request handler.
    """
    if has_request_context():
        g.request_id = request.headers.get('X-Request-ID', str(uuid.uuid4()))


def get_request_id() -> str:
    """Get current request ID"""
    if has_request_context():
        return getattr(g, 'request_id', 'NO_REQUEST_ID')
    return 'NO_REQUEST_ID'


def get_job_id() -> str:
    """Get current job ID"""
    if has_request_context():
        return getattr(request, 'job_id', 'NO_JOB')
    return 'NO_JOB'


def log_with_context(
    logger: logging.Logger,
    level: str,
    message: str,
    **context: Any
) -> None:
    """
    Log message with additional context.
    
    Args:
        logger: Logger instance
        level: Log level (info, warning, error, etc.)
        message: Log message
        **context: Additional context to include
    """
    context_str = " | ".join(f"{k}={v}" for k, v in context.items())
    full_message = f"{message} | {context_str}" if context else message
    
    log_func = getattr(logger, level.lower())
    log_func(full_message)


def sanitize_for_logging(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remove or mask sensitive data from logs.
    
    Args:
        data: Dictionary that may contain sensitive data
    
    Returns:
        Sanitized dictionary safe for logging
    """
    sensitive_keys = {'uid', 'email', 'voice_samples', 'api_key', 'token', 'password'}
    sanitized = {}
    
    for key, value in data.items():
        if key.lower() in sensitive_keys:
            if key == 'voice_samples' and isinstance(value, list):
                sanitized[key] = f"[{len(value)} samples]"
            elif isinstance(value, str) and len(value) > 8:
                sanitized[key] = f"{value[:8]}***"
            else:
                sanitized[key] = "***"
        else:
            sanitized[key] = value
    
    return sanitized