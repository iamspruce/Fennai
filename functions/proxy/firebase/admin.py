# functions/proxy/firebase/admin.py
"""
Firebase authentication utilities with enhanced error handling and logging.
"""
import firebase_admin
from firebase_admin import auth, credentials
import logging
import time
from typing import Optional, Dict, Any
from flask import Request

logger = logging.getLogger(__name__)

# Initialize only once
if not firebase_admin._apps:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)

# Constants
TOKEN_EXPIRY_WARNING_SECONDS = 300  # 5 minutes


def get_current_user(request: Request) -> Optional[Dict[str, Any]]:
    """
    Extract and verify Firebase ID token from Authorization header.
    
    Args:
        request: Flask request object
        
    Returns:
        Decoded token dictionary if valid, None otherwise
    """
    auth_header = request.headers.get("Authorization")
    
    if not auth_header:
        logger.warning("Authentication failed: Missing Authorization header")
        return None
        
    if not auth_header.startswith("Bearer "):
        logger.warning(f"Authentication failed: Invalid header format. Received: {auth_header[:10]}...")
        return None
        
    id_token = auth_header.split("Bearer ")[1]
    
    try:
        # Verify the token
        decoded = auth.verify_id_token(id_token)
        
        # Check if token is about to expire
        exp_time = decoded.get('exp', 0)
        time_to_expiry = exp_time - time.time()
        
        if time_to_expiry < TOKEN_EXPIRY_WARNING_SECONDS:
            logger.warning(
                f"Token for user {decoded.get('uid')} expires in {int(time_to_expiry)}s"
            )
        
        return decoded
        
    except auth.ExpiredIdTokenError:
        logger.error("Authentication failed: Token has expired")
        return None
    except auth.RevokedIdTokenError:
        logger.error("Authentication failed: Token has been revoked")
        return None
    except auth.InvalidIdTokenError:
        logger.error("Authentication failed: Token is invalid")
        return None
    except Exception as e:
        # Catch other errors (e.g. wrong project config, connection issues)
        logger.error(f"Authentication unexpected error: {str(e)}")
        return None


def verify_admin_access(uid: str) -> bool:
    """
    Check if user has admin privileges.
    
    Args:
        uid: User ID
        
    Returns:
        True if user is admin, False otherwise
    """
    try:
        user = auth.get_user(uid)
        custom_claims = user.custom_claims or {}
        return custom_claims.get('admin', False)
    except Exception as e:
        logger.error(f"Failed to verify admin access for {uid}: {str(e)}")
        return False