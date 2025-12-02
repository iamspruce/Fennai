from firebase_functions import https_fn
from firebase_functions.core import init
from firebase_admin import initialize_app
import requests
import os
import sys

# Add parent directory to path for shared modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Environment variables
INFERENCE_URL = os.environ.get("INFERENCE_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")

# Global variables (will be initialized in onInit)
get_current_user = None
check_and_deduct_credits = None

@init
def initialize():
    """Initialize Firebase Admin and import shared modules during first invocation"""
    global get_current_user, check_and_deduct_credits
    
    # Initialize Firebase Admin
    initialize_app()
    
    # Import shared modules (deferred to avoid deployment timeout)
    from shared.firebase import get_current_user as _get_current_user
    from shared.credits import check_and_deduct_credits as _check_and_deduct_credits
    
    get_current_user = _get_current_user
    check_and_deduct_credits = _check_and_deduct_credits
    
    print("Firebase Admin and shared modules initialized")

@https_fn.on_request()
def voice_clone_proxy(req: https_fn.Request) -> https_fn.Response:
    """
    Voice cloning proxy endpoint.
    Handles authentication, credit deduction, and forwards to inference service.
    """
    
    # Handle CORS preflight
    if req.method == "OPTIONS":
        return https_fn.Response(
            "",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Max-Age": "3600"
            }
        )
    
    # Only allow POST requests
    if req.method != "POST":
        return https_fn.Response(
            {"error": "Method not allowed"},
            status=405,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Authenticate user
    user = get_current_user(req)
    if not user:
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Parse request data
    try:
        data = req.get_json(silent=True) or {}
    except Exception:
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    text = data.get("text", "").strip()
    voice_samples = data.get("voice_samples", [])
    character_texts = data.get("character_texts")
    
    # Validate required fields
    if not text or not voice_samples:
        return https_fn.Response(
            {"error": "Missing text or voice_samples"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check if inference service is configured
    if not INFERENCE_URL or not INTERNAL_TOKEN:
        return https_fn.Response(
            {"error": "Inference service not configured"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost (multi-character costs more)
    cost = 5 if character_texts else 1
    
    # Check and deduct credits
    can_proceed, error_msg = check_and_deduct_credits(user["uid"], cost)
    if not can_proceed:
        return https_fn.Response(
            {"error": error_msg or "Insufficient credits"},
            status=402,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Prepare payload for inference service
    payload = {
        "text": text,
        "voice_samples": voice_samples,
    }
    
    if character_texts:
        payload["character_texts"] = character_texts
    
    # Call inference service
    try:
        response = requests.post(
            INFERENCE_URL,
            json=payload,
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=180
        )
        
        if response.status_code != 200:
            return https_fn.Response(
                {"error": f"Inference failed with status {response.status_code}"},
                status=500,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        # Return audio file
        return https_fn.Response(
            response.content,
            status=200,
            headers={
                "Content-Type": "audio/wav",
                "Access-Control-Allow-Origin": "*",
                "Content-Disposition": "attachment; filename=voice.wav",
                "Cache-Control": "no-cache"
            }
        )
        
    except requests.exceptions.Timeout:
        return https_fn.Response(
            {"error": "Generation timeout - please try again"},
            status=504,
            headers={"Access-Control-Allow-Origin": "*"}
        )
        
    except requests.exceptions.RequestException as e:
        return https_fn.Response(
            {"error": f"Network error: {str(e)}"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
        
    except Exception as e:
        return https_fn.Response(
            {"error": f"Unexpected error: {str(e)}"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )