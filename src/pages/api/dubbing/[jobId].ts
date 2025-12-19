import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { getDubbingJob, deleteDubbingJob, updateDubbingJob } from '@/lib/firebase/firestore';
import { deleteFileFromStorage } from '@/lib/firebase/storage';

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

        // 1. Update job in Firestore
        await updateDubbingJob(jobId, uid, body);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error: any) {
        console.error('[API Dubbing Update] Error:', error);
        return new Response(JSON.stringify({
            error: error.message || 'Failed to update dubbing job'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
