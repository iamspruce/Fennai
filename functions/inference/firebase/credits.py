# functions/inference/shared/credits.py
from firebase_admin import firestore
from typing import Tuple, Optional

def confirm_credit_deduction(transaction, user_ref, cost: int) -> Tuple[bool, Optional[str]]:
    """
    Convert pending credits to actual deduction after successful generation
    """
    try:
        doc = transaction.get(user_ref)
        if not doc.exists:
            return False, "User not found"
        
        data = doc.to_dict()
        is_pro = data.get("isPro", False)
        
        updates = {
            "totalVoicesGenerated": firestore.Increment(1),
            "updatedAt": firestore.SERVER_TIMESTAMP
        }
        
        if not is_pro:
            updates["credits"] = firestore.Increment(-cost)
            updates["pendingCredits"] = firestore.Increment(-cost)
        
        transaction.update(user_ref, updates)
        return True, None
        
    except Exception as e:
        return False, str(e)


def release_credits(transaction, user_ref, cost: int) -> Tuple[bool, Optional[str]]:
    """
    Release reserved credits when generation fails
    """
    try:
        doc = transaction.get(user_ref)
        if not doc.exists:
            return False, "User not found"
        
        data = doc.to_dict()
        is_pro = data.get("isPro", False)
        
        if not is_pro:
            updates = {
                "pendingCredits": firestore.Increment(-cost),
                "updatedAt": firestore.SERVER_TIMESTAMP
            }
            transaction.update(user_ref, updates)
        
        return True, None
        
    except Exception as e:
        return False, str(e)