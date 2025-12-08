# functions/proxy/main.py
"""
Main entry point for Firebase Cloud Functions.
Exports all route handlers for deployment.
"""
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Import all route handlers
from routes.voice_clone import voice_clone
from routes.script_generator import generate_script
from routes.dub_transcribe import dub_transcribe
from routes.dub_translate import dub_translate
from routes.dub_clone import dub_clone

# Import cleanup function
from cleanup import cleanup_pending_credits

# Export all functions for Firebase deployment
__all__ = [
    'voice_clone',
    'generate_script',
    'dub_transcribe',
    'dub_translate',
    'dub_clone',
    'cleanup_pending_credits'
]