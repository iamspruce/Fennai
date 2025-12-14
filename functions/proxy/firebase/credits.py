# functions/proxy/firebase/credits.py
"""
Enhanced credit management with race condition prevention.
All credit operations are atomic and idempotent.
"""
from firebase_admin import firestore
from google.cloud.firestore import transactional, SERVER_TIMESTAMP, Increment
from typing import Tuple, Optional, Dict, Any
from datetime import datetime, timedelta
import logging
import sys

from utils import MULTI_CHARACTER_MULTIPLIER, SECONDS_PER_CREDIT, DUBBING_TRANSLATION_MULTIPLIER, DUBBING_VIDEO_MULTIPLIER, PENDING_CREDIT_TIMEOUT_HOURS
from utils.logging_config import get_logger

logger = get_logger(__name__)


def calculate_cost(character_texts: Optional[list] = None) -> int:
    """Calculate cost based on number of characters"""
    if character_texts:
        return len(character_texts)
    return 1


def calculate_cost_from_duration(
    duration_seconds: float, 
    is_multi_character: bool = False
) -> int:
    """Calculate cost based on audio duration"""
    base_cost = max(1, int(duration_seconds / SECONDS_PER_CREDIT))
    multiplier = MULTI_CHARACTER_MULTIPLIER if is_multi_character else 1.0
    return max(1, int(base_cost * multiplier))


def calculate_dubbing_cost(
    duration_seconds: float, 
    has_translation: bool, 
    is_video: bool
) -> int:
    """Calculate dubbing cost with multipliers"""
    base_credits = max(1, int(duration_seconds / SECONDS_PER_CREDIT))
    translation_mult = DUBBING_TRANSLATION_MULTIPLIER if has_translation else 1.0
    video_mult = DUBBING_VIDEO_MULTIPLIER if is_video else 1.0
    return max(1, int(base_credits * translation_mult * video_mult))


def reserve_credits(
    uid: str, 
    job_id: str, 
    cost: int, 
    job_data: Dict[str, Any],
    collection_name: str = "voiceJobs"
) -> Tuple[bool, Optional[str]]:
    """
    Atomically reserve credits and create job document.
    IMPROVED: Prevents race conditions and double reservations.
    
    Args:
        uid: User ID
        job_id: Job ID
        cost: Credit cost
        job_data: Job metadata to store in document
        collection_name: Firestore collection name (default: "voiceJobs")
        
    Returns:
        Tuple of (success, error_message)
    """
    logger.info(f"reserve_credits called: uid={uid}, job_id={job_id}, cost={cost}, collection={collection_name}")
    
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    job_ref = db.collection(collection_name).document(job_id)
    
    @transactional
    def update_in_transaction(transaction):
        logger.info(f"Transaction started for job {job_id}")
        
        # Check if job already exists (prevent double reservation)
        try:
            job_snapshot = job_ref.get(transaction=transaction)
            if job_snapshot.exists:
                logger.error(f"Job {job_id} already exists - double reservation prevented")
                raise ValueError("Job already exists - credits may already be reserved")
        except Exception as e:
            # If it's our ValueError, re-raise it
            if "already exists" in str(e):
                raise
            # Otherwise, job doesn't exist - continue
            logger.debug(f"Job {job_id} doesn't exist (expected): {str(e)}")
        
        # Get user document
        user_snapshot = user_ref.get(transaction=transaction)
        if not user_snapshot.exists:
            logger.error(f"User {uid} document not found")
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        total_credits = user_data.get("credits", 0)
        pending_credits = user_data.get("pendingCredits", 0)
        
        logger.info(
            f"User {uid}: total_credits={total_credits}, "
            f"pending_credits={pending_credits}, is_pro={is_pro}"
        )
        
        # Calculate available credits
        available_credits = total_credits - pending_credits
        
        logger.info(f"Available credits: {available_credits}, Required: {cost}")
        
        # Pro users bypass credit check
        if not is_pro and available_credits < cost:
            error_msg = f"Insufficient credits. Available: {available_credits}, Required: {cost}"
            logger.warning(f"Credit check failed for user {uid}: {error_msg}")
            raise ValueError(error_msg)
        
        logger.info(f"Credit check passed for user {uid}")
        
        # Reserve credits by incrementing pendingCredits
        user_updates: Dict[str, Any] = {
            "updatedAt": SERVER_TIMESTAMP
        }
        
        if not is_pro:
            user_updates["pendingCredits"] = Increment(cost)
            logger.info(f"Incrementing pendingCredits by {cost}")
        
        transaction.update(user_ref, user_updates)
        logger.info(f"User credits updated for {uid}")
        
        # Create job document with reservation flag
        job_doc_data = {
            "uid": uid,
            "status": "queued",
            "cost": cost,
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
            "pendingCreditExpiry": datetime.utcnow() + timedelta(hours=PENDING_CREDIT_TIMEOUT_HOURS),
            "creditsReserved": True,
            "creditsConfirmed": False,
        }
        
        # Merge in any additional job data
        job_doc_data.update(job_data)
        
        transaction.set(job_ref, job_doc_data)
        logger.info(f"Job document created in {collection_name}/{job_id}")
        
        logger.info(f"✓ Reserved {cost} credits for user {uid}, job {job_id}")
        return True, None
    
    try:
        transaction = db.transaction()
        result = update_in_transaction(transaction)
        logger.info(f"Transaction completed successfully for job {job_id}")
        sys.stdout.flush()
        return result
    except ValueError as e:
        logger.warning(f"✗ Credit reservation failed for {uid}: {str(e)}")
        sys.stdout.flush()
        return False, str(e)
    except Exception as e:
        logger.error(f"✗ Credit reservation transaction failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        sys.stdout.flush()
        return False, f"Transaction failed: {str(e)}"


def confirm_credit_deduction(
    uid: str, 
    job_id: str, 
    cost: int,
    collection_name: str = "voiceJobs"
) -> Tuple[bool, Optional[str]]:
    """
    Convert pending credits to actual deduction after successful generation.
    IMPROVED: Prevents double confirmation with idempotency check.
    
    Args:
        uid: User ID
        job_id: Job ID
        cost: Credit cost
        collection_name: Firestore collection name (default: "voiceJobs")
        
    Returns:
        Tuple of (success, error_message)
    """
    logger.info(f"Confirming credit deduction: uid={uid}, job_id={job_id}, cost={cost}, collection={collection_name}")
    
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    job_ref = db.collection(collection_name).document(job_id)
    
    @transactional
    def update_in_transaction(transaction):
        # Get job document
        job_snapshot = job_ref.get(transaction=transaction)
        if not job_snapshot.exists:
            raise ValueError("Job document not found")
        
        job_data = job_snapshot.to_dict() or {}
        if job_data.get("creditsConfirmed"):
            logger.warning(f"Credits already confirmed for job {job_id}")
            return True, None
        
        if not job_data.get("creditsReserved"):
            raise ValueError("Credits were not reserved for this job")
        
        # Get user document
        user_snapshot = user_ref.get(transaction=transaction)
        if not user_snapshot.exists:
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        
        # Update user credits
        updates: Dict[str, Any] = {
            "totalVoicesGenerated": Increment(1),
            "updatedAt": SERVER_TIMESTAMP
        }
        
        if not is_pro:
            # Deduct from actual credits and remove from pending
            updates["credits"] = Increment(-cost)
            updates["pendingCredits"] = Increment(-cost)
        
        transaction.update(user_ref, updates)
        
        # Mark credits as confirmed in job
        transaction.update(job_ref, {
            "creditsConfirmed": True,
            "creditsConfirmedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"✓ Confirmed {cost} credit deduction for user {uid}, job {job_id}")
        return True, None
    
    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        logger.warning(f"Credit confirmation failed for {uid}: {str(e)}")
        return False, str(e)
    except Exception as e:
        logger.error(f"Credit confirmation transaction failed: {str(e)}")
        return False, f"Credit confirmation failed: {str(e)}"


def release_credits(
    uid: str, 
    job_id: str, 
    cost: int,
    collection_name: str = "voiceJobs"
) -> Tuple[bool, Optional[str]]:
    """
    Release reserved credits when generation fails.
    IMPROVED: Idempotent - safe to call multiple times.
    
    Args:
        uid: User ID
        job_id: Job ID
        cost: Credit cost
        collection_name: Firestore collection name (default: "voiceJobs")
        
    Returns:
        Tuple of (success, error_message)
    """
    logger.info(f"Releasing credits: uid={uid}, job_id={job_id}, cost={cost}, collection={collection_name}")
    
    db = firestore.client()
    user_ref = db.collection("users").document(uid)
    job_ref = db.collection(collection_name).document(job_id)
    
    @transactional
    def update_in_transaction(transaction):
        # Get job document
        try:
            job_snapshot = job_ref.get(transaction=transaction)
        except Exception:
            job_snapshot = None
        
        if not job_snapshot or not job_snapshot.exists:
            logger.warning(f"Job {job_id} not found, skipping credit release")
            return True, None
        
        job_data = job_snapshot.to_dict() or {}
        
        # If credits already confirmed, don't release
        if job_data.get("creditsConfirmed"):
            logger.warning(f"Credits already confirmed for job {job_id}, cannot release")
            return False, "Credits already confirmed"
        
        # If credits already released, skip (idempotency)
        if job_data.get("creditsReleased"):
            logger.info(f"Credits already released for job {job_id}")
            return True, None
        
        if not job_data.get("creditsReserved"):
            logger.warning(f"Credits were not reserved for job {job_id}")
            return True, None
        
        # Get user document
        user_snapshot = user_ref.get(transaction=transaction)
        if not user_snapshot.exists:
            raise ValueError("User document not found")
        
        user_data = user_snapshot.to_dict() or {}
        is_pro = user_data.get("isPro", False)
        
        # Release credits
        if not is_pro:
            updates = {
                "pendingCredits": Increment(-cost),
                "updatedAt": SERVER_TIMESTAMP
            }
            transaction.update(user_ref, updates)
        
        # Mark credits as released in job
        transaction.update(job_ref, {
            "creditsReleased": True,
            "creditsReleasedAt": SERVER_TIMESTAMP
        })
        
        logger.info(f"✓ Released {cost} credits for user {uid}, job {job_id}")
        return True, None
    
    try:
        transaction = db.transaction()
        return update_in_transaction(transaction)
    except ValueError as e:
        logger.warning(f"Credit release failed for {uid}: {str(e)}")
        return False, str(e)
    except Exception as e:
        logger.error(f"Credit release transaction failed: {str(e)}")
        return False, f"Credit release failed: {str(e)}"


def check_credits_available(uid: str, cost: int = 1) -> Tuple[bool, Optional[str]]:
    """Check if user has enough credits WITHOUT reserving them"""
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
        logger.error(f"Credit check failed for {uid}: {str(e)}")
        return False, f"Credit check failed: {str(e)}"


def cleanup_stale_pending_credits() -> Dict[str, Any]:
    """
    Cleanup function to release pending credits from expired jobs.
    Should be called periodically via Cloud Scheduler.
    """
    db = firestore.client()
    now = datetime.utcnow()
    
    # Find expired jobs with pending credits
    jobs_query = (
        db.collection("voiceJobs")
        .where("status", "in", ["queued", "processing"])
        .where("pendingCreditExpiry", "<=", now)
        .where("creditsReleased", "==", False)
        .limit(100)
    )
    
    cleaned_count = 0
    error_count = 0
    
    for job_doc in jobs_query.stream():
        job_data = job_doc.to_dict()
        uid = job_data.get("uid")
        cost = job_data.get("cost", 0)
        
        try:
            success, error = release_credits(uid, job_doc.id, cost)
            
            if success:
                # Update job as expired
                job_doc.reference.update({
                    "status": "expired",
                    "error": "Job expired - credits released",
                    "updatedAt": SERVER_TIMESTAMP
                })
                cleaned_count += 1
                logger.info(f"Cleaned up expired job {job_doc.id}")
            else:
                error_count += 1
                logger.error(f"Failed to release credits for job {job_doc.id}: {error}")
                
        except Exception as e:
            error_count += 1
            logger.error(f"Error cleaning up job {job_doc.id}: {str(e)}")
    
    result = {
        "cleaned": cleaned_count,
        "errors": error_count,
        "timestamp": now.isoformat()
    }
    
    logger.info(f"Pending credit cleanup complete: {result}")
    return result