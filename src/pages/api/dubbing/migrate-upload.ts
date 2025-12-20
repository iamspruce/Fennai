
import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie, checkProStatus } from '@/lib/firebase/auth';
import { getDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { uploadDubbingMedia } from '@/lib/firebase/storage';

export const POST: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const decodedClaims = await verifySessionCookie(sessionCookie);
    if (!decodedClaims) {
        return new Response('Invalid session', { status: 401 });
    }

    const uid = decodedClaims.uid;

    // Verify Pro status
    const isPro = await checkProStatus(uid);
    if (!isPro) {
        return new Response(JSON.stringify({ error: 'Pro subscription required' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const formData = await request.formData();
        const jobId = formData.get('jobId') as string;
        const characterId = formData.get('characterId') as string;
        // videoBlob might be "audioBlob" if it's audio-only dubbing, but usually it's video
        const mediaBlob = (formData.get('videoBlob') || formData.get('audioBlob')) as Blob;
        const mediaType = formData.get('mediaType') as 'video' | 'audio';

        if (!jobId || !mediaBlob || !characterId) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Verify job exists and belongs to user
        const jobRef = doc(db, 'dubbingJobs', jobId);
        const jobSnap = await getDoc(jobRef);

        if (!jobSnap.exists()) {
            return new Response(JSON.stringify({ error: 'Job not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const jobData = jobSnap.data();
        if (jobData.uid !== uid) {
            return new Response(JSON.stringify({ error: 'Unauthorized access to job' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (jobData.isInCloudStorage) {
            return new Response(JSON.stringify({ error: 'Media is already in cloud storage' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Upload to Firebase Storage
        const fileExt = mediaType === 'video' ? 'mp4' : 'wav';
        const fileName = `dub_${jobId}.${fileExt}`;

        const { url, path } = await uploadDubbingMedia(uid, characterId, mediaBlob, fileName, mediaType);

        // Update Firestore document
        await updateDoc(jobRef, {
            storageType: 'cloud',
            finalMediaUrl: url,
            isInCloudStorage: true,
            storagePath: path
        });

        return new Response(JSON.stringify({
            success: true,
            jobId,
            mediaUrl: url,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Migration upload error:', error);
        return new Response(JSON.stringify({ error: 'Failed to migrate dubbing media' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
