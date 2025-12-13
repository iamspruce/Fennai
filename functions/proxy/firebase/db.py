# functions/proxy/firebase/db.py
"""
Centralized Firestore client with lazy initialization.
Import this instead of firebase_admin.firestore in route files.
"""
import firebase_admin
from firebase_admin import firestore, credentials

_db_client = None

def _ensure_firebase_initialized():
    """Ensure Firebase is initialized (lazy initialization)."""
    if not firebase_admin._apps:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)

def get_db():
    """
    Get Firestore client with lazy initialization.
    Safe to call during module import and at runtime.
    
    Returns:
        Firestore client instance
    """
    global _db_client
    if _db_client is None:
        _ensure_firebase_initialized()  # Add this line
        _db_client = firestore.client()
    return _db_client