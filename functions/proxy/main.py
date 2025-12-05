from firebase_functions import https_fn, logger
import requests
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import from local shared directory (copied into proxy/)
from shared.firebase import get_current_user
from shared.credits import check_and_deduct_credits

# Environment variables - these will come from Firebase Functions config
INFERENCE_URL = os.environ.get("INFERENCE_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")

@https_fn.on_request()
def voice_clone(req: https_fn.Request) -> https_fn.Response:
    # Health check endpoint
    if req.path == "/health" or req.path.endswith("/health"):
        logger.info("Health check requested")
        return https_fn.Response(
            {"status": "healthy", "service": "voice-clone-proxy"},
            status=200,
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        )
    
    logger.info(f"Request received. Method: {req.method}")

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
    
    if req.method != "POST":
        logger.warn(f"Method not allowed: {req.method}")
        return https_fn.Response(
            {"error": "Method not allowed"},
            status=405,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Authenticate user
    logger.info("Attempting to authenticate user...")
    user = get_current_user(req)
    
    if not user:
        logger.warn("Returning 401 Unauthorized")
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    logger.info(f"User authenticated successfully: {uid}")

    # Parse request data
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"JSON Parse error: {str(e)}")
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
        logger.warn(f"Missing fields for user {uid}. Text len: {len(text)}, Samples: {len(voice_samples)}")
        return https_fn.Response(
            {"error": "Missing text or voice_samples"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check if inference service is configured
    if not INFERENCE_URL or not INTERNAL_TOKEN:
        logger.error("Environment Configuration Error: Missing INFERENCE_URL or INTERNAL_TOKEN")
        return https_fn.Response(
            {"error": "Inference service not configured"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Calculate cost (multi-character costs more)
    if character_texts:
        cost = len(character_texts)  # 1 credit per character
    else:
        cost = 1  # Single character
    
    # Check credits availability (don't deduct yet)
    logger.info(f"Checking credit availability for user {uid} (cost: {cost})")
    from shared.credits import check_credits_available
    has_credits, error_msg = check_credits_available(uid, cost)
    
    if not has_credits:
        logger.warn(f"Insufficient credits for {uid}: {error_msg}")
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
    
    # Call inference service FIRST
    try:
        # CRITICAL FIX: Add /inference to the URL
        inference_endpoint = f"{INFERENCE_URL}/inference"
        logger.info(f"Forwarding request to: {inference_endpoint}")
        
        response = requests.post(
            inference_endpoint,
            json=payload,
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=180
        )
        
        if response.status_code != 200:
            logger.error(f"Inference Service Error: Status {response.status_code}, Body: {response.text}")
            return https_fn.Response(
                {"error": f"Inference failed with status {response.status_code}"},
                status=500,
                headers={"Access-Control-Allow-Origin": "*"}
            )
        
        # SUCCESS! Now deduct credits
        logger.info(f"Generation successful, deducting {cost} credits for user {uid}")
        can_proceed, deduct_error = check_and_deduct_credits(uid, cost)
        
        if not can_proceed:
            logger.error(f"Credit deduction failed after successful generation for {uid}: {deduct_error}")
            # Still return the audio since generation succeeded
        
        # Return audio file
        logger.info(f"Returning audio to {uid}")
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
        logger.error(f"Inference Timeout for {uid} - NO CREDITS DEDUCTED")
        return https_fn.Response(
            {"error": "Generation timeout - please try again"},
            status=504,
            headers={"Access-Control-Allow-Origin": "*"}
        )
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Network Error contacting inference service: {str(e)} - NO CREDITS DEDUCTED")
        return https_fn.Response(
            {"error": f"Network error: {str(e)}"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
        
    except Exception as e:
        logger.error(f"Unexpected error in proxy: {str(e)} - NO CREDITS DEDUCTED")
        return https_fn.Response(
            {"error": f"Unexpected error: {str(e)}"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
