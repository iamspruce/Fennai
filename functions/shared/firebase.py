# functions/shared/firebase.py
import firebase_admin
from firebase_admin import auth, credentials
from flask import Request

# Initialize only once
if not firebase_admin._apps:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)

def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    id_token = auth_header.split("Bearer ")[1]
    try:
        decoded = auth.verify_id_token(id_token)
        return decoded
    except:
        return None