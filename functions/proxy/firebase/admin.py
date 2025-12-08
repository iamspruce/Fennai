# functions/proxy/firebase/admin.py
import firebase_admin
from firebase_admin import auth, credentials
from firebase_functions import logger # Import logger
from flask import Request

# Initialize only once
if not firebase_admin._apps:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)

def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    
    if not auth_header:
        logger.warn("Authentication failed: Missing Authorization header")
        return None
        
    if not auth_header.startswith("Bearer "):
        logger.warn(f"Authentication failed: Invalid header format. Received: {auth_header[:10]}...")
        return None
        
    id_token = auth_header.split("Bearer ")[1]
    
    try:
        # Verify the token
        decoded = auth.verify_id_token(id_token)
        return decoded
    except auth.ExpiredIdTokenError:
        logger.error("Authentication failed: Token has expired")
        return None
    except auth.InvalidIdTokenError:
        logger.error("Authentication failed: Token is invalid (malformed or revoked)")
        return None
    except Exception as e:
        # Catch other errors (e.g. wrong project config, connection issues)
        logger.error(f"Authentication unexpected error: {str(e)}")
        return None