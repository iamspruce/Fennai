# functions/proxy/main.py
"""
Main entry point for Firebase Cloud Functions.
Exports all route handlers for deployment.
"""

# ✅ CRITICAL: Configure logging FIRST before any other imports
from utils.logging_config import setup_cloud_logging, get_logger
setup_cloud_logging()

import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get logger AFTER configuration
logger = get_logger(__name__)

# ✅ Verify logging is working
print("=" * 80)
print("MAIN.PY LOADING")
print("=" * 80)
sys.stdout.flush()

logger.info("🚀 Firebase Cloud Functions initializing...")

# Import all route handlers AFTER logging config
try:
    logger.info("Importing route handlers...")
    
    from routes.voice_clone import voice_clone
    logger.info("✓ voice_clone imported")
    
    from routes.script_generator import generate_script
    logger.info("✓ generate_script imported")
    
    from routes.dub_transcribe import dub_transcribe
    logger.info("✓ dub_transcribe imported")
    
    from routes.dub_translate import dub_translate
    logger.info("✓ dub_translate imported")
    
    from routes.dub_clone import dub_clone
    logger.info("✓ dub_clone imported")
    
    # Import cleanup function
    from cleanup import cleanup_pending_credits
    logger.info("✓ cleanup_pending_credits imported")
    
    logger.info("✅ All modules loaded successfully")
    
except Exception as e:
    logger.error(f"❌ Failed to import modules: {str(e)}")
    import traceback
    logger.error(traceback.format_exc())
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

logger.info("🎉 Firebase Cloud Functions initialized successfully")
sys.stdout.flush()