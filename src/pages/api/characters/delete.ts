import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { getCharacter, deleteCharacter, getVoices, deleteVoice } from '@/lib/firebase/firestore';
import { deleteFileFromStorage } from '@/lib/firebase/storage';

export const DELETE: APIRoute = async ({ request }) => {
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

    try {
        const { characterId } = await request.json();

        if (!characterId) {
            return new Response(JSON.stringify({ error: 'Character ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get character to verify ownership
        const character = await getCharacter(characterId, uid);

        if (!character) {
            return new Response(JSON.stringify({ error: 'Character not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Delete character's sample audio from storage
        try {
            await deleteFileFromStorage(character.sampleAudioStoragePath);
        } catch (storageError) {
            console.error('Error deleting character audio:', storageError);
        }

        // Delete all voices associated with this character
        const { voices } = await getVoices(characterId, uid, { limit: 1000 });

        for (const voice of voices) {
            if (voice.audioStoragePath) {
                try {
                    await deleteFileFromStorage(voice.audioStoragePath);
                } catch (storageError) {
                    console.error('Error deleting voice audio:', storageError);
                }
            }
            await deleteVoice(voice.id, uid);
        }

        // Delete character document
        await deleteCharacter(characterId, uid);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Delete character error:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete character' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};