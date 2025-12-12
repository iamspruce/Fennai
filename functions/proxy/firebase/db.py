# functions/proxy/firebase/db.py
"""
Centralized Firestore client with lazy initialization.
Import this instead of firebase_admin.firestore in route files.
"""
from firebase_admin import firestore

_db_client = None

def get_db():
    """
    Get Firestore client with lazy initialization.
    Safe to call during module import and at runtime.
    
    Returns:
        Firestore client instance
    """
    global _db_client
    if _db_client is None:
        _db_client = firestore.client()
    return _db_client