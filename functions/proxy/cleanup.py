# functions/proxy/cleanup.py
"""
Scheduled Cloud Function to cleanup stale pending credits.
Deploy with Cloud Scheduler to run periodically (e.g., every hour).

Deployment:
gcloud functions deploy cleanup_pending_credits \
    --runtime python39 \
    --trigger-topic credit-cleanup \
    --entry-point cleanup_pending_credits \
    --region us-central1

Create scheduler:
gcloud scheduler jobs create pubsub credit-cleanup-job \
    --schedule="0 * * * *" \
    --topic=credit-cleanup \
    --message-body="cleanup"
"""
from firebase_functions import pubsub_fn
import logging
from firebase.credits import cleanup_stale_pending_credits

logger = logging.getLogger(__name__)


@pubsub_fn.on_message_published(topic="credit-cleanup")
def cleanup_pending_credits(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]):
    """
    Cleanup stale pending credits from expired jobs.
    Triggered by Cloud Scheduler via Pub/Sub.
    """
    logger.info("Starting pending credit cleanup")
    
    try:
        result = cleanup_stale_pending_credits()
        
        logger.info(
            f"Cleanup complete: {result['cleaned']} jobs cleaned, "
            f"{result['errors']} errors"
        )

    except Exception as e:
        logger.error(f"Cleanup job failed: {str(e)}")
        raise