# functions/proxy/firebase/credits.py
from firebase_admin import firestore
from typing import Tuple, Optional, Dict, Any
from datetime import datetime, timedelta

def calculate_cost(character_texts: Optional[list] = None) -> int:
    """Calculate cost based on number of characters"""
    if character_texts:
        return len(character_texts)  # 1 credit per character
    return 1  # Single character


def reserve_credits(
    uid: str, 
    job_id: str, 
    cost: int, 
    job_data: Dict[str, Any]
) -> Tuple[bool, Optional[str]]:
    """
    Atomically reserve credits and create job document.
    This prevents race conditions where multiple requests bypass credit checks.
    
    Returns (success: bool, error_message: str | None)
    """
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    job_ref = db.collection("voiceJobs").document(job_id)
    
    @firestore.transactional
    def update_in_transaction(transaction):
        # Get user document
        user_snapshot_iter = transaction.get(user_ref)
        try:
            user_snapshot = next(user_snapshot_iter)
        except StopIteration:
            raise ValueError("User document not found")
        
        if not user_snapshot.exists:
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        total_credits = user_data.get("credits", 0)
        pending_credits = user_data.get("pendingCredits", 0)
        
        # Calculate available credits
        available_credits = total_credits - pending_credits
        
        # Pro users bypass credit check
        if not is_pro:
            if available_credits < cost:
                raise ValueError(
                    f"Insufficient credits. Available: {available_credits}, Required: {cost}"
                )
        
        # Reserve credits by incrementing pendingCredits
        user_updates = {
            "updatedAt": firestore.SERVER_TIMESTAMP
        }
        
        if not is_pro:
            user_updates["pendingCredits"] = firestore.Increment(cost)
        
        transaction.update(user_ref, user_updates)
        
        # Create job document
        job_doc = {
            "uid": uid,
            "status": "queued",
            "cost": cost,
            "text": job_data.get("text", ""),
            "isMultiCharacter": bool(job_data.get("character_texts")),
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        
        transaction.set(job_ref, job_doc)
        
        return True, None
    
    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        return False, f"Transaction failed: {str(e)}"


def confirm_credit_deduction(uid: str, job_id: str, cost: int) -> Tuple[bool, Optional[str]]:
    """
    Convert pending credits to actual deduction after successful generation.
    This is called by Cloud Run after audio is successfully generated.
    
    Returns (success: bool, error_message: str | None)
    """
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    
    @firestore.transactional
    def update_in_transaction(transaction):
        user_snapshot_iter = transaction.get(user_ref)
        try:
            user_snapshot = next(user_snapshot_iter)
        except StopIteration:
            raise ValueError("User document not found")
        
        if not user_snapshot.exists:
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        
        updates = {
            "totalVoicesGenerated": firestore.Increment(1),
            "updatedAt": firestore.SERVER_TIMESTAMP
        }
        
        if not is_pro:
            # Deduct from actual credits and remove from pending
            updates["credits"] = firestore.Increment(-cost)
            updates["pendingCredits"] = firestore.Increment(-cost)
        
        transaction.update(user_ref, updates)
        return True, None
    
    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        return False, f"Credit confirmation failed: {str(e)}"


def release_credits(uid: str, job_id: str, cost: int) -> Tuple[bool, Optional[str]]:
    """
    Release reserved credits when generation fails.
    This ensures users don't lose credits for failed generations.
    
    Returns (success: bool, error_message: str | None)
    """
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    
    @firestore.transactional
    def update_in_transaction(transaction):
        user_snapshot_iter = transaction.get(user_ref)
        try:
            user_snapshot = next(user_snapshot_iter)
        except StopIteration:
            raise ValueError("User document not found")
        
        if not user_snapshot.exists:
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        
        # Only release if not pro (pro users don't have pending credits)
        if not is_pro:
            updates = {
                "pendingCredits": firestore.Increment(-cost),
                "updatedAt": firestore.SERVER_TIMESTAMP
            }
            transaction.update(user_ref, updates)
        
        return True, None
    
    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        return False, f"Credit release failed: {str(e)}"


def check_credits_available(uid: str, cost: int = 1) -> Tuple[bool, Optional[str]]:
    """
    Check if user has enough credits WITHOUT reserving them.
    Used for UI validation before user clicks generate.
    
    Returns (has_credits: bool, error_message: str | None)
    """
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    
    try:
        doc = user_ref.get()
        
        if not doc.exists:
            return False, "User document not found"
        
        data = doc.to_dict() or {}
        is_pro = data.get("isPro", False)
        
        # Pro users always have credits
        if is_pro:
            return True, None
        
        # Calculate available credits
        total_credits = data.get("credits", 0)
        pending_credits = data.get("pendingCredits", 0)
        available = total_credits - pending_credits
        
        if available < cost:
            return False, f"Insufficient credits. Available: {available}, Required: {cost}"
        
        return True, None
        
    except Exception as e:
        return False, f"Credit check failed: {str(e)}"