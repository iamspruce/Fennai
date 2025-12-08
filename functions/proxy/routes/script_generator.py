# functions/proxy/routes/script_generator.py
"""
Enhanced AI Script Generator using Gemini 1.5 Pro with proper job tracking,
rate limiting, and comprehensive error handling.
"""
from firebase_functions import https_fn
import logging
import os
import uuid
import time
from typing import List, Dict, Any
import google.generativeai as genai
from firebase_admin import firestore

from firebase.admin import get_current_user
from firebase.credits import check_credits_available, confirm_credit_deduction

# Configure logging
logger = logging.getLogger(__name__)

# Configure Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Constants
SCRIPT_COST = 1  # 1 credit per script generation
MAX_CONTEXT_LENGTH = 2000
MAX_CHARACTERS = 10
RATE_LIMIT_WINDOW = 60  # 1 minute
MAX_REQUESTS_PER_WINDOW = 10

db = firestore.client()


def check_rate_limit(uid: str) -> tuple[bool, str]:
    """
    Check if user has exceeded rate limit for script generation.
    
    Args:
        uid: User ID
        
    Returns:
        Tuple of (is_allowed, error_message)
    """
    try:
        now = time.time()
        cutoff = now - RATE_LIMIT_WINDOW
        
        # Query recent script generations
        recent_scripts = (
            db.collection("scriptGenerations")
            .where("uid", "==", uid)
            .where("timestamp", ">=", cutoff)
            .stream()
        )
        
        count = sum(1 for _ in recent_scripts)
        
        if count >= MAX_REQUESTS_PER_WINDOW:
            return False, f"Rate limit exceeded. Max {MAX_REQUESTS_PER_WINDOW} scripts per minute."
        
        return True, ""
        
    except Exception as e:
        logger.error(f"Rate limit check failed: {str(e)}")
        # Allow request on error to avoid blocking users
        return True, ""


def validate_script_request(data: dict) -> tuple[bool, str]:
    """
    Validate script generation request data.
    
    Args:
        data: Request data
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    mode = data.get("mode", "single")
    template = data.get("template", "custom")
    context = data.get("context", "").strip()
    characters = data.get("characters", [])
    
    # Validate mode
    if mode not in ["single", "dialogue"]:
        return False, "Invalid mode. Must be 'single' or 'dialogue'"
    
    # Validate context
    if not context and template == "custom":
        return False, "Context required for custom template"
    
    if len(context) > MAX_CONTEXT_LENGTH:
        return False, f"Context too long. Max {MAX_CONTEXT_LENGTH} characters"
    
    # Validate characters
    if not isinstance(characters, list):
        return False, "Characters must be an array"
    
    if len(characters) > MAX_CHARACTERS:
        return False, f"Too many characters. Max {MAX_CHARACTERS}"
    
    if mode == "dialogue" and len(characters) < 2:
        return False, "Dialogue mode requires at least 2 characters"
    
    for idx, char in enumerate(characters):
        if not isinstance(char, dict) or "name" not in char:
            return False, f"Invalid character format at index {idx}"
        if not char["name"].strip():
            return False, f"Character name cannot be empty at index {idx}"
    
    return True, ""


def log_script_generation(uid: str, generation_id: str, data: dict):
    """
    Log script generation for rate limiting and analytics.
    
    Args:
        uid: User ID
        generation_id: Unique generation ID
        data: Generation metadata
    """
    try:
        db.collection("scriptGenerations").document(generation_id).set({
            "uid": uid,
            "mode": data.get("mode"),
            "template": data.get("template"),
            "timestamp": time.time(),
            "createdAt": firestore.SERVER_TIMESTAMP
        })
    except Exception as e:
        logger.error(f"Failed to log script generation: {str(e)}")


@https_fn.on_request()
def generate_script(req: https_fn.Request) -> https_fn.Response:
    """
    AI Script Generator using Gemini 1.5 Pro.
    Costs 1 credit per generation with rate limiting.
    """
    request_id = str(uuid.uuid4())
    logger.info(f"[{request_id}] Script generation request received")
    
    # CORS
    if req.method == "OPTIONS":
        return https_fn.Response(
            "",
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
            }
        )
    
    if req.method != "POST":
        return https_fn.Response(
            {"error": "Method not allowed"},
            status=405,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Auth
    user = get_current_user(req)
    if not user:
        logger.warning(f"[{request_id}] Unauthorized request")
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
    # Check Gemini API key
    if not GEMINI_API_KEY:
        logger.error(f"[{request_id}] GEMINI_API_KEY not configured")
        return https_fn.Response(
            {"error": "AI service not configured"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception as e:
        logger.error(f"[{request_id}] JSON parse error: {str(e)}")
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Validate request
    is_valid, error_msg = validate_script_request(data)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return https_fn.Response(
            {"error": error_msg},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check rate limit
    allowed, rate_error = check_rate_limit(uid)
    if not allowed:
        logger.warning(f"[{request_id}] Rate limit exceeded for {uid}")
        return https_fn.Response(
            {"error": rate_error},
            status=429,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check credits
    has_credits, credit_error = check_credits_available(uid, SCRIPT_COST)
    if not has_credits:
        logger.warning(f"[{request_id}] Insufficient credits for {uid}")
        return https_fn.Response(
            {"error": credit_error or "Insufficient credits"},
            status=402,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Extract parameters
    mode = data.get("mode", "single")
    template = data.get("template", "custom")
    context = data.get("context", "").strip()
    characters = data.get("characters", [])
    
    # Build prompt
    prompt = build_gemini_prompt(mode, template, context, characters)
    logger.info(f"[{request_id}] Generated prompt for mode={mode}, template={template}")
    
    # Call Gemini
    generation_id = str(uuid.uuid4())
    try:
        model = genai.GenerativeModel('gemini-1.5-pro')
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.9,
                top_p=0.95,
                max_output_tokens=2048,
            )
        )
        
        script = response.text.strip()
        
        # Deduct credits (non-refundable for AI generations)
        confirm_credit_deduction(uid, generation_id, SCRIPT_COST)
        
        # Log generation for rate limiting
        log_script_generation(uid, generation_id, data)
        
        logger.info(
            f"[{request_id}] Script generated successfully for user {uid}, "
            f"generation_id={generation_id}"
        )
        
        return https_fn.Response(
            {
                "success": True,
                "script": script,
                "generationId": generation_id,
                "requestId": request_id
            },
            status=200,
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"[{request_id}] Gemini API error: {str(e)}")
        return https_fn.Response(
            {
                "error": "Failed to generate script. Please try again.",
                "details": str(e) if os.getenv("DEBUG") else None
            },
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )


def build_gemini_prompt(
    mode: str, 
    template: str, 
    context: str, 
    characters: List[Dict[str, Any]]
) -> str:
    """
    Build structured prompt for Gemini.
    
    Args:
        mode: 'single' or 'dialogue'
        template: Template type
        context: User-provided context
        characters: List of character dictionaries
        
    Returns:
        Formatted prompt string
    """
    
    # Template prompts
    TEMPLATE_PROMPTS = {
        "youtube_ad": "Create a compelling 30-second YouTube ad script that hooks viewers in the first 3 seconds",
        "podcast_intro": "Write an engaging podcast episode introduction that sets the tone and introduces topics",
        "product_demo": "Create an exciting product demonstration script highlighting key features and benefits",
        "tutorial": "Write a clear educational tutorial script that explains concepts step-by-step",
        "storytelling": "Create a captivating story narration with vivid imagery and emotional impact",
        "sales_pitch": "Write a persuasive sales pitch that addresses pain points and presents solutions",
        "announcement": "Create an important announcement script that is clear, concise, and memorable",
        "interview": "Generate thoughtful interview questions and talking points for engaging conversation",
        "comedy": "Write a funny comedy sketch or bit with good timing and punchlines",
        "motivational": "Create an inspiring motivational speech that energizes and empowers listeners",
    }
    
    base_instruction = TEMPLATE_PROMPTS.get(template, "")
    
    if mode == "single":
        char_name = characters[0].get("name", "the character") if characters else "the character"
        
        prompt = f"""You are a professional script writer. {base_instruction}

Character: {char_name}
Context: {context}

Write a natural, engaging script for {char_name} to speak. The script should:
- Sound like natural speech (not written text)
- Be appropriate for voice acting/text-to-speech
- Have clear pacing and rhythm
- Be emotionally engaging
- Be between 100-500 words

Output only the script text, no labels or stage directions."""

    else:  # dialogue mode
        char_names = [c.get("name", f"Character {i+1}") for i, c in enumerate(characters)]
        char_list = ", ".join(char_names[:-1]) + f" and {char_names[-1]}" if len(char_names) > 1 else char_names[0]
        
        prompt = f"""You are a professional dialogue writer. {base_instruction}

Characters: {char_list}
Context: {context}

Write a natural, engaging dialogue between these characters. The dialogue should:
- Have distinct speaking styles for each character
- Flow naturally like real conversation
- Be appropriate for voice acting
- Stay true to the context provided
- Be between 200-800 words total

Format each line as:
Character Name: dialogue text

Output only the dialogue, no stage directions or descriptions."""
    
    return prompt