# functions/proxy/routes/script_generator.py
from firebase_functions import https_fn, logger
import os
import google.generativeai as genai
from firebase.admin import get_current_user

# Configure Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

SCRIPT_COST = 1  # 1 credit per script generation

@https_fn.on_request()
def generate_script(req: https_fn.Request) -> https_fn.Response:
    """
    AI Script Generator using Gemini 1.5 Pro
    Costs 1 credit per generation
    """
    
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
        return https_fn.Response(
            {"error": "Unauthorized"},
            status=401,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    uid = user.get("uid")
    
    # Check Gemini API key
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY not configured")
        return https_fn.Response(
            {"error": "AI service not configured"},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Parse request
    try:
        data = req.get_json(silent=True) or {}
    except Exception:
        return https_fn.Response(
            {"error": "Invalid JSON"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    mode = data.get("mode", "single")
    template = data.get("template", "custom")
    context = data.get("context", "").strip()
    characters = data.get("characters", [])
    
    if not context and template == "custom":
        return https_fn.Response(
            {"error": "Context required for custom template"},
            status=400,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Check credits
    from firebase.credits import check_credits_available
    has_credits, error_msg = check_credits_available(uid, SCRIPT_COST)
    if not has_credits:
        return https_fn.Response(
            {"error": error_msg or "Insufficient credits"},
            status=402,
            headers={"Access-Control-Allow-Origin": "*"}
        )
    
    # Build prompt
    prompt = build_gemini_prompt(mode, template, context, characters)
    
    # Call Gemini
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
        from firebase.credits import confirm_credit_deduction
        confirm_credit_deduction(uid, "script_generation", SCRIPT_COST)
        
        logger.info(f"Script generated for user {uid}, mode={mode}, template={template}")
        
        return https_fn.Response(
            {"script": script},
            status=200,
            headers={
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        )
        
    except Exception as e:
        logger.error(f"Gemini API error: {str(e)}")
        return https_fn.Response(
            {"error": "Failed to generate script. Please try again."},
            status=500,
            headers={"Access-Control-Allow-Origin": "*"}
        )


def build_gemini_prompt(mode: str, template: str, context: str, characters: list) -> str:
    """Build structured prompt for Gemini"""
    
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

Format each line as:
Character Name: dialogue text

Output only the dialogue, no stage directions or descriptions."""
    
    return prompt