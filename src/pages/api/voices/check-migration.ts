import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { getVoices } from '@/lib/firebase/firestore';
import { adminDb } from '@/lib/firebase/firebase-admin';

export const GET: APIRoute = async ({ request, url }) => {
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
    const characterId = url.searchParams.get('characterId');

    if (!characterId) {
        return new Response(JSON.stringify({ error: 'Missing characterId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        // 1. Get local-only voices (need sync TO cloud)
        const { voices: localOnlyVoices } = await getVoices(characterId, uid, {
            storageType: 'local-only',
        });
        const localOnlyVoiceIds = localOnlyVoices.map(v => v.id);

        // 2. Get ALL cloud voices for this character (total count)
        const { voices: allCloudVoices } = await getVoices(characterId, uid, {
            storageType: 'cloud',
        });

        // 3. Get dubbing jobs for this character
        const dubbingSnapshot = await adminDb.collection('dubbingJobs')
            .where('uid', '==', uid)
            .where('characterId', '==', characterId)
            .get();

        const allDubbingJobs = dubbingSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Array<{ id: string; isInCloudStorage?: boolean; status?: string;[key: string]: any }>;

        // Separate local-only dubs (not in cloud storage) from cloud dubs
        const localOnlyDubIds = allDubbingJobs
            .filter(job => !job.isInCloudStorage && ['completed', 'failed'].includes(job.status || ''))
            .map(job => job.id);

        const cloudDubCount = allDubbingJobs
            .filter(job => job.isInCloudStorage && ['completed', 'failed'].includes(job.status || ''))
            .length;

        return new Response(JSON.stringify({
            // Voice data
            localOnlyIds: localOnlyVoiceIds,
            count: localOnlyVoiceIds.length, // Legacy: local-only voice count
            cloudVoiceCount: allCloudVoices.length,

            // Dubbing data
            localOnlyDubIds,
            localOnlyDubCount: localOnlyDubIds.length,
            cloudDubCount,

            // Totals for cross-device display
            totalVoicesInCloud: allCloudVoices.length,
            totalDubsInCloud: cloudDubCount,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Check migration error:', error);
        return new Response(JSON.stringify({ error: 'Failed to check migration status' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};