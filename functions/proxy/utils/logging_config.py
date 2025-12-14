# functions/proxy/utils/logging_config.py
"""
Centralized logging configuration for Cloud Functions.
Import this module FIRST in main.py to ensure proper logging setup.
"""
import logging
import sys
from typing import Optional

# ✅ Global flag to prevent re-initialization
_LOGGING_CONFIGURED = False


def setup_cloud_logging(level: int = logging.INFO, force: bool = False) -> None:
    """
    Configure logging for Google Cloud Functions.
    
    This MUST be called before importing any other modules.
    
    Args:
        level: Logging level (default: INFO)
        force: Force reconfiguration even if already configured
    """
    global _LOGGING_CONFIGURED
    
    if _LOGGING_CONFIGURED and not force:
        return
    
    # ✅ Remove all existing handlers
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # ✅ Create new stdout handler with proper formatting
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    
    # Simple format for Cloud Logging (it adds its own metadata)
    formatter = logging.Formatter(
        '%(levelname)s: [%(name)s] %(message)s'
    )
    handler.setFormatter(formatter)
    
    # ✅ Configure root logger
    root_logger.addHandler(handler)
    root_logger.setLevel(level)
    
    # ✅ Force immediate flush
    handler.flush()
    sys.stdout.flush()
    
    _LOGGING_CONFIGURED = True
    
    # Log successful configuration
    print("=" * 80)
    print("LOGGING CONFIGURED FOR CLOUD FUNCTIONS")
    print(f"Level: {logging.getLevelName(level)}")
    print(f"Handler: {handler.__class__.__name__} -> stdout")
    print("=" * 80)
    sys.stdout.flush()


def get_logger(name: str, level: Optional[int] = None) -> logging.Logger:
    """
    Get a properly configured logger.
    
    Args:
        name: Logger name (usually __name__)
        level: Optional override level
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    if level is not None:
        logger.setLevel(level)
    
    # Ensure propagation is enabled
    logger.propagate = True
    
    return logger


def log_function_entry(logger: logging.Logger, function_name: str, **kwargs) -> None:
    """
    Log function entry with parameters.
    
    Args:
        logger: Logger instance
        function_name: Name of the function
        **kwargs: Function parameters to log
    """
    params = ', '.join(f"{k}={v}" for k, v in kwargs.items())
    logger.info(f"→ ENTERING {function_name}({params})")
    sys.stdout.flush()


def log_function_exit(logger: logging.Logger, function_name: str, result: any = None) -> None:
    """
    Log function exit with result.
    
    Args:
        logger: Logger instance
        function_name: Name of the function
        result: Optional return value
    """
    if result is not None:
        logger.info(f"← EXITING {function_name}: {result}")
    else:
        logger.info(f"← EXITING {function_name}")
    sys.stdout.flush()


def log_request(logger: logging.Logger, request_id: str, method: str, path: str, headers: dict = None) -> None:
    """
    Log HTTP request details.
    
    Args:
        logger: Logger instance
        request_id: Request ID
        method: HTTP method
        path: Request path
        headers: Optional request headers
    """
    logger.info("=" * 80)
    logger.info(f"REQUEST {request_id}")
    logger.info(f"Method: {method}")
    logger.info(f"Path: {path}")
    
    if headers:
        # Log important headers only
        important_headers = ['authorization', 'content-type', 'user-agent']
        for header in important_headers:
            value = headers.get(header, headers.get(header.title()))
            if value:
                # Mask auth token
                if header == 'authorization':
                    value = f"{value[:20]}..." if len(value) > 20 else value
                logger.info(f"  {header.title()}: {value}")
    
    logger.info("=" * 80)
    sys.stdout.flush()


def log_error(logger: logging.Logger, error: Exception, context: str = "") -> None:
    """
    Log error with full context.
    
    Args:
        logger: Logger instance
        error: Exception object
        context: Additional context string
    """
    import traceback
    
    logger.error("!" * 80)
    logger.error(f"ERROR: {type(error).__name__}: {str(error)}")
    
    if context:
        logger.error(f"Context: {context}")
    
    # Log full traceback
    tb = traceback.format_exc()
    logger.error(f"Traceback:\n{tb}")
    logger.error("!" * 80)
    sys.stdout.flush()


# ✅ Auto-configure when imported
setup_cloud_logging()