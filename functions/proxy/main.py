# functions/proxy/main.py
"""
Main entry point for Firebase Cloud Functions.
Exports all route handlers for deployment.
"""

import sys
from dotenv import load_dotenv

# Configure logging FIRST before any other imports
from utils.logging_config import setup_cloud_logging, get_logger
setup_cloud_logging()

# Load environment variables
load_dotenv()

# Get logger after configuration
logger = get_logger(__name__)

# Log initialization
logger.info("=" * 80)
logger.info("FIREBASE CLOUD FUNCTIONS INITIALIZING")
logger.info("=" * 80)
sys.stdout.flush()

# Import all route handlers
try:
    logger.info("Importing route handlers...")
    
    from routes.voice_clone import voice_clone
    from routes.script_generator import generate_script
    from routes.dub_transcribe import dub_transcribe
    from routes.dub_translate import dub_translate
    from routes.dub_clone import dub_clone
    from cleanup import cleanup_pending_credits
    
    logger.info("✅ All modules loaded successfully")
    
except Exception as e:
    logger.error(f"❌ Failed to import modules: {str(e)}", exc_info=True)
    raise

# Export all functions for Firebase deployment
__all__ = [
    'voice_clone',
    'generate_script',
    'dub_transcribe',
    'dub_translate',
    'dub_clone',
    'cleanup_pending_credits'
]

logger.info("🎉 Firebase Cloud Functions ready")
sys.stdout.flush()