import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie, checkProStatus } from '@/lib/firebase/auth'; //
import { updateCharacter } from '@/lib/firebase/firestore'; //

export const POST: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) return new Response('Unauthorized', { status: 401 });

    const decodedClaims = await verifySessionCookie(sessionCookie);
    if (!decodedClaims) return new Response('Invalid session', { status: 401 });

    const uid = decodedClaims.uid;
    const isPro = await checkProStatus(uid);

    if (!isPro) {
        return new Response(JSON.stringify({ error: 'Pro subscription required' }), { status: 403 });
    }

    try {
        const formData = await request.formData();
        const characterId = formData.get('characterId') as string;

        if (!characterId) return new Response('Missing characterId', { status: 400 });

        // Update character to enable cloud saving
        await updateCharacter(characterId, uid, {
            // This is the field inferred from your context
            // You might need to add this to your UpdateCharacterInput interface in character.ts
            // @ts-ignore - assuming dynamic update allowed or interface updated
            saveAcrossBrowsers: true
        });

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
        console.error('Failed to enable cloud:', error);
        return new Response(JSON.stringify({ error: 'Failed to update character' }), { status: 500 });
    }
};