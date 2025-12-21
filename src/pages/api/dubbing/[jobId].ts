import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { getDubbingJob, deleteDubbingJob, updateDubbingJob } from '@/lib/firebase/firestore';
import { deleteFileFromStorage } from '@/lib/firebase/storage';
import { adminDb, FieldValue } from '@/lib/firebase/firebase-admin';
import { calculateDubbingCost } from '@/types/dubbing';

export const DELETE: APIRoute = async ({ params, request }) => {
    const { jobId } = params;
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const decodedClaims = await verifySessionCookie(sessionCookie);
    if (!decodedClaims) {
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const uid = decodedClaims.uid;

    if (!jobId) {
        return new Response(JSON.stringify({ error: 'Job ID required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        // 1. Get job to check ownership and get paths
        const job = await getDubbingJob(jobId, uid);

        if (!job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 2. Delete files from storage if they exist
        const pathsToDelete = [
            job.originalMediaPath,
            job.audioPath,
            job.clonedAudioPath,
            job.finalMediaPath,
        ].filter(Boolean);

        for (const path of pathsToDelete) {
            try {
                await deleteFileFromStorage(path);
            } catch (storageError) {
                console.error(`Failed to delete storage file at ${path}:`, storageError);
                // Continue with other files/deletion
            }
        }

        // 3. Delete from Firestore
        await deleteDubbingJob(jobId, uid);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('[API Dubbing Delete] Error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to delete dubbing job'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

export const PUT: APIRoute = async ({ params, request }) => {
    const { jobId } = params;
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const decodedClaims = await verifySessionCookie(sessionCookie);
    if (!decodedClaims) {
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const uid = decodedClaims.uid;

    if (!jobId) {
        return new Response(JSON.stringify({ error: 'Job ID required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const body = await request.json();

        // 1. Get current job to calculate cost difference
        const job = await getDubbingJob(jobId as string, uid);
        if (!job) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 2. Recalculate cost if relevant fields change
        const duration = body.duration ?? job.duration;
        const mediaType = body.mediaType ?? job.mediaType;
        const targetLanguage = body.targetLanguage ?? job.targetLanguage;
        const detectedLanguageCode = job.detectedLanguageCode;

        // If no target language, or it matches detected, hasTranslation is false
        const hasTranslation = !!targetLanguage && targetLanguage !== detectedLanguageCode;
        const newCost = calculateDubbingCost(duration, hasTranslation, mediaType === 'video');

        const oldCost = job.cost || 0;
        const costDiff = newCost - oldCost;

        console.log(`[API Dubbing Update] Job ${jobId}: oldCost=${oldCost}, newCost=${newCost}, diff=${costDiff}`);

        // 3. Update job and adjust credits in transaction if cost changed
        if (costDiff !== 0) {
            await adminDb.runTransaction(async (transaction) => {
                const userRef = adminDb.collection('users').doc(uid);
                const userDoc = await transaction.get(userRef);

                if (!userDoc.exists) throw new Error('User not found');
                const userData = userDoc.data()!;

                // Check for enough credits ONLY if cost is increasing
                if (costDiff > 0) {
                    const availableCredits = (userData.credits || 0) - (userData.pendingCredits || 0);
                    if (availableCredits < costDiff) {
                        throw new Error('Insufficient credits for these settings. Please add more credits.');
                    }
                }

                // A. Adjust reservation
                transaction.update(userRef, {
                    pendingCredits: FieldValue.increment(costDiff),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // B. Update job
                const jobRef = adminDb.collection('dubbingJobs').doc(jobId as string);
                transaction.update(jobRef, {
                    ...body,
                    cost: newCost,
                    updatedAt: FieldValue.serverTimestamp()
                });
            });
        } else {
            // Normal update if cost didn't change
            await updateDubbingJob(jobId as string, uid, body);
        }

        return new Response(JSON.stringify({ success: true, newCost }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('[API Dubbing Update] Error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to update dubbing job'
        }), {
            status: error.message?.includes('credits') ? 402 : 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

