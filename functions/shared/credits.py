# functions/shared/credits.py
from firebase_admin import firestore
import time


def check_and_deduct_credits(uid: str, cost: int = 1):
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    
    def transaction(t):
        doc = user_ref.get(transaction=t)
        if not doc.exists:
            return False, "User not found"
        
        data = doc.to_dict()
        is_pro = data.get("isPro", False)
        credits = data.get("credits", 0)

        if not is_pro and credits < cost:
            return False, "Insufficient credits"

        if not is_pro:
            t.update(user_ref, {
                "credits": firestore.Increment(-cost),
                "totalVoicesGenerated": firestore.Increment(1),
                "updatedAt": firestore.SERVER_TIMESTAMP
            })
        return True, None

    try:
        success, msg = db.transaction()(transaction)()
        return success, msg
    except Exception as e:
        return False, f"Transaction failed: {str(e)}"

def refund_credits(uid: str, amount: int = 1):
    """Refund credits to user (e.g., on generation failure)"""
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    
    try:
        user_ref.update({
            "credits": firestore.Increment(amount),
            "updatedAt": firestore.SERVER_TIMESTAMP
        })
        return True
    except Exception as e:
        print(f"Failed to refund credits: {e}")
        return False