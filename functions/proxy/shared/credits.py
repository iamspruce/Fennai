# shared/credits.py
from firebase_admin import firestore
from typing import Tuple

def check_credits_available(uid: str, cost: int = 1) -> Tuple[bool, str | None]:
    """
    Check if user has enough credits WITHOUT deducting them.
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
        
        # Check if free user has enough credits
        credits = data.get("credits", 0)
        if credits < cost:
            return False, "Insufficient credits"
        
        return True, None
        
    except Exception as e:
        return False, f"Credit check failed: {str(e)}"


def check_and_deduct_credits(uid: str, cost: int = 1) -> Tuple[bool, str | None]:
    """
    Check if user has enough credits and deduct them in a transaction.
    Returns (success: bool, error_message: str | None)
    """
    # Initialize db only when function is called (works locally + in production)
    db = firestore.client()
    user_ref = db.collection("users").document(uid)

    @firestore.transactional
    def update_in_transaction(transaction):
        snapshot_iter = transaction.get(user_ref)
        
        try:
            snapshot = next(snapshot_iter)
        except StopIteration:
            raise ValueError("User document not found")

        if not snapshot.exists:
            raise ValueError("User document not found")

        data = snapshot.to_dict() or {}
        is_pro = data.get("isPro", False)
        credits = data.get("credits", 0)

        update_data = {
            "totalVoicesGenerated": firestore.Increment(1),
            "updatedAt": firestore.SERVER_TIMESTAMP
        }

        if not is_pro:
            if credits < cost:
                raise ValueError("Insufficient credits")
            update_data["credits"] = firestore.Increment(-cost)

        transaction.update(user_ref, update_data)
        return True, None

    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        return False, f"Transaction failed: {str(e)}"