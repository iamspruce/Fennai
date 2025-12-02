# functions/proxy/main.py
import functions_framework
from flask import jsonify, Request, abort
import requests
import os
from shared.firebase import get_current_user
from shared.credits import check_and_deduct_credits

# Set in Firebase secrets
INFERENCE_URL = os.environ.get("INFERENCE_URL")  # e.g. https://us-central1-xxx.cloudfunctions.net/inference
INTERNAL_TOKEN = os.environ.get("INTERNAL_TOKEN")  # random secret

@functions_framework.http
def voice_clone_proxy(request: Request):
    # CORS
    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
        }
        return ("", 204, headers)

    user = get_current_user(request)
    if not user:
        return (jsonify({"error": "Unauthorized"}), 401, {"Access-Control-Allow-Origin": "*"})

    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    voice_samples = data.get("voice_samples", [])
    character_texts = data.get("character_texts")  # optional for multi

    if not text or not voice_samples:
        return (jsonify({"error": "Missing text or voice_samples"}), 400, {"Access-Control-Allow-Origin": "*"})

    cost = 5 if character_texts else 1
    can_proceed, error = check_and_deduct_credits(user["uid"], cost)
    if not can_proceed:
        return (jsonify({"error": error}), 402, {"Access-Control-Allow-Origin": "*"})

    payload = {
        "text": text,
        "voice_samples": voice_samples,
        "character_texts": character_texts
    }

    try:
        response = requests.post(
            INFERENCE_URL,
            json=payload,
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=180
        )
        if response.status_code != 200:
            return (jsonify({"error": "Inference failed"}), 500, {"Access-Control-Allow-Origin": "*"})

        return (
            response.content,
            200,
            {
                "Content-Type": "audio/wav",
                "Access-Control-Allow-Origin": "*",
                "Content-Disposition": "attachment; filename=voice.wav"
            }
        )
    except requests.exceptions.Timeout:
        return (jsonify({"error": "Generation timeout"}), 504, {"Access-Control-Allow-Origin": "*"})
    except Exception as e:
        return (jsonify({"error": str(e)}), 500, {"Access-Control-Allow-Origin": "*"})