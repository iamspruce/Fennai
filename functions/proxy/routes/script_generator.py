"""
Enhanced AI Script Generator with improved prompts for better quality.
"""
from firebase_functions import https_fn
import logging
import os
import uuid
import time
from typing import List, Dict, Any
import google.generativeai as genai
from firebase.db import get_db
from google.cloud.firestore import SERVER_TIMESTAMP

from firebase.admin import get_current_user
from firebase.credits import check_credits_available, confirm_credit_deduction

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

SCRIPT_COST = 1
MAX_CONTEXT_LENGTH = 2000
MAX_CHARACTERS = 10
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 10

def check_rate_limit(uid: str) -> tuple[bool, str]:
    """Check if user has exceeded rate limit."""
    try:
        now = time.time()
        cutoff = now - RATE_LIMIT_WINDOW
        
        db = get_db()
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
        return True, ""


def validate_script_request(data: dict) -> tuple[bool, str]:
    """Validate script generation request data."""
    mode = data.get("mode", "single")
    template = data.get("template", "custom")
    context = data.get("context", "").strip()
    characters = data.get("characters", [])
    tone = data.get("tone", "")
    length = data.get("length", "")
    
    if mode not in ["single", "dialogue"]:
        return False, "Invalid mode. Must be 'single' or 'dialogue'"
    
    if not context and template == "custom":
        return False, "Context required for custom template"
    
    if len(context) > MAX_CONTEXT_LENGTH:
        return False, f"Context too long. Max {MAX_CONTEXT_LENGTH} characters"
    
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
    """Log script generation for analytics."""
    try:
        db = get_db()
        db.collection("scriptGenerations").document(generation_id).set({
            "uid": uid,
            "mode": data.get("mode"),
            "template": data.get("template"),
            "timestamp": time.time(),
            "createdAt": SERVER_TIMESTAMP
        })
    except Exception as e:
        logger.error(f"Failed to log script generation: {str(e)}")


@https_fn.on_request()
def generate_script(req: https_fn.Request) -> https_fn.Response:
    """Generate AI script using Gemini 1.5 Pro."""
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
    if not uid or not isinstance(uid, str):
        logger.error(f"[{request_id}] Invalid user uid")
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    logger.info(f"[{request_id}] User authenticated: {uid}")
    
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
    
    # Validate
    is_valid, error_msg = validate_script_request(data)
    if not is_valid:
        logger.warning(f"[{request_id}] Validation failed: {error_msg}")
        return https_fn.Response(
            {"error": error_msg},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Rate limit
    allowed, rate_error = check_rate_limit(uid)
    if not allowed:
        logger.warning(f"[{request_id}] Rate limit exceeded for {uid}")
        return https_fn.Response(
            {"error": rate_error},
            status=429,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Credits
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
    tone = data.get("tone", "Professional")
    length = data.get("length", "Medium (1-2m)")
    
    # Build enhanced prompt
    prompt = build_enhanced_prompt(mode, template, context, characters, tone, length)
    logger.info(f"[{request_id}] Generated prompt for mode={mode}, template={template}")
    
    # Call Gemini
    generation_id = str(uuid.uuid4())
    try:
        model = genai.GenerativeModel('gemini-1.5-pro')
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.85,  # Slightly lower for more consistent quality
                top_p=0.95,
                top_k=40,
                max_output_tokens=2048,
            )
        )
        
        script = response.text.strip()
        
        # Deduct credits
        confirm_credit_deduction(uid, generation_id, SCRIPT_COST)
        
        # Log generation
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


def build_enhanced_prompt(
    mode: str,
    template: str,
    context: str,
    characters: List[Dict[str, Any]],
    tone: str,
    length: str
) -> str:
    """Build enhanced prompt for better script quality."""
    
    # Enhanced template descriptions
    TEMPLATE_PROMPTS = {
        "youtube_ad": {
            "goal": "Create a high-converting YouTube ad",
            "structure": "Hook (3s) → Problem → Solution → Call-to-Action",
            "tips": "Start with a pattern interrupt, use 'you' language, create urgency"
        },
        "podcast_intro": {
            "goal": "Create an engaging podcast intro",
            "structure": "Hook → Host intro → Episode topic → Value promise",
            "tips": "Build anticipation, tease key takeaways, use storytelling"
        },
        "product_demo": {
            "goal": "Showcase product features effectively",
            "structure": "Problem → Solution reveal → Feature walkthrough → Results",
            "tips": "Focus on benefits over features, show don't tell, use concrete examples"
        },
        "tutorial": {
            "goal": "Teach a skill clearly and concisely",
            "structure": "What you'll learn → Step-by-step process → Summary",
            "tips": "Use simple language, anticipate questions, include helpful analogies"
        },
        "storytelling": {
            "goal": "Tell a compelling narrative",
            "structure": "Setup → Conflict → Rising action → Climax → Resolution",
            "tips": "Use vivid sensory details, create emotional connection, build tension"
        },
        "sales_pitch": {
            "goal": "Persuade prospects to buy",
            "structure": "Attention → Problem → Solution → Proof → Call-to-action",
            "tips": "Address objections, use social proof, create scarcity"
        },
        "interview": {
            "goal": "Facilitate engaging conversation",
            "structure": "Warm-up → Core questions → Deepening → Memorable close",
            "tips": "Ask open-ended questions, build on answers, create moments"
        },
        "comedy": {
            "goal": "Entertain and make people laugh",
            "structure": "Setup → Misdirection → Punchline → Callback (optional)",
            "tips": "Use rule of three, subvert expectations, perfect timing"
        },
        "motivational": {
            "goal": "Inspire action and belief",
            "structure": "Challenge → Vision → Path forward → Empowerment",
            "tips": "Use powerful metaphors, call to action, leave them energized"
        }
    }
    
    template_info = TEMPLATE_PROMPTS.get(template, {
        "goal": "Create compelling content",
        "structure": "Introduction → Body → Conclusion",
        "tips": "Engage audience, deliver value, end memorably"
    })
    
    # Length guidelines
    LENGTH_WORDS = {
        "Short (<30s)": "75-100 words",
        "Medium (1-2m)": "150-300 words",
        "Long (3m+)": "450-600 words"
    }
    
    word_target = LENGTH_WORDS.get(length, "200-300 words")
    
    if mode == "single":
        char_name = characters[0].get("name", "the character") if characters else "the speaker"
        
        prompt = f"""You are an expert scriptwriter specializing in voice content. Your scripts are known for being natural, engaging, and perfectly suited for voice delivery.

**ASSIGNMENT**: {template_info['goal']}

**SPEAKER**: {char_name}
**TONE**: {tone}
**LENGTH**: {word_target}
**CONTEXT**: {context}

**STRUCTURAL FRAMEWORK**:
{template_info['structure']}

**WRITING GUIDELINES**:
✓ Write for the EAR, not the eye (conversational, natural speech)
✓ Use short sentences and active voice
✓ Include strategic pauses with punctuation
✓ Vary sentence length for rhythm and emphasis
✓ Avoid tongue-twisters and difficult pronunciation
✓ Write contractions (don't, we'll, you're) for naturalness
✓ {template_info['tips']}

**VOICE DELIVERY TIPS**:
- Use CAPS for emphasis on key words
- Add ellipses (...) for dramatic pauses
- Break complex ideas into digestible chunks
- End with strong, memorable statement

**OUTPUT FORMAT**:
Write ONLY the script text. No labels, no stage directions, no formatting except:
- Paragraph breaks for major sections
- Punctuation for pacing
- CAPS for emphasis

Begin writing the script now:"""

    else:  # dialogue mode
        char_names = [c.get("name", f"Character {i+1}") for i, c in enumerate(characters)]
        char_list = ", ".join(char_names[:-1]) + f" and {char_names[-1]}" if len(char_names) > 1 else char_names[0]
        
        # Create character profiles
        char_profiles = "\n".join([
            f"- {name}: [Define unique speaking style based on tone {tone}]" 
            for name in char_names
        ])
        
        prompt = f"""You are an expert dialogue writer. Your scripts feature natural conversation flow, distinct character voices, and engaging exchanges.

**ASSIGNMENT**: {template_info['goal']}

**CHARACTERS**: {char_list}
**TONE**: {tone}
**LENGTH**: {word_target} total
**CONTEXT**: {context}

**CHARACTER VOICES**:
{char_profiles}

**DIALOGUE GUIDELINES**:
✓ Each character has distinct speaking patterns
✓ Natural interruptions and reactions (where appropriate)
✓ Authentic conversational rhythm
✓ Build on each other's statements
✓ Mix of question-answer and statement-response
✓ Show personality through word choice
✓ {template_info['tips']}

**STRUCTURAL FRAMEWORK**:
{template_info['structure']}

**FORMATTING RULES**:
- Format: "Character Name: dialogue"
- One line per speaking turn
- Natural back-and-forth exchange
- Strategic pauses indicated by ellipses
- CAPS for emphasis
- Keep responses concise and punchy

**OUTPUT FORMAT**:
Write ONLY the dialogue. No stage directions, no descriptions, no narration.

Example format:
{char_names[0]}: Opening line here...
{char_names[1] if len(char_names) > 1 else char_names[0]}: Response here.
{char_names[0]}: Building on that.

Begin writing the dialogue now:"""
    
    return prompt