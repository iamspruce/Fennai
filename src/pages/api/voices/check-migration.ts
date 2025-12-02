import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { getVoices } from '@/lib/firebase/firestore';

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
        const { voices } = await getVoices(characterId, uid, {
            storageType: 'local-only',
        });

        const localOnlyIds = voices.map(v => v.id);

        return new Response(JSON.stringify({
            localOnlyIds,
            count: localOnlyIds.length,
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