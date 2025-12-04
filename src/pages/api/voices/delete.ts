// api/voices/delete.ts
import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { deleteVoice, getVoice, incrementVoiceCount } from '@/lib/firebase/firestore';
import { deleteVoiceAudio } from '@/lib/firebase/storage';

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
        const { voiceId } = await request.json();

        if (!voiceId) {
            return new Response(JSON.stringify({ error: 'Voice ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get voice data to check storage path
        const voice = await getVoice(voiceId, uid);

        if (!voice) {
            return new Response(JSON.stringify({ error: 'Voice not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Delete from Firebase Storage ONLY if it exists (Pro users with saveAcrossBrowsers enabled)
        let deletedFromStorage = false;
        if (voice.audioStoragePath) {
            try {
                await deleteVoiceAudio(voice.audioStoragePath);
                deletedFromStorage = true;
            } catch (storageError: any) {
                // Only log error if it's not "file not found"
                if (storageError.code !== 'storage/object-not-found') {
                    console.error('Failed to delete audio from storage:', storageError);
                }
                // Continue with Firestore deletion even if storage fails
            }
        }

        // Delete from Firestore
        await deleteVoice(voiceId, uid);

        // Decrement character voice count
        try {
            await incrementVoiceCount(voice.characterId, uid, -1);
        } catch (error) {
            console.error('Failed to decrement voice count:', error);
            // Don't fail the whole operation if count update fails
        }

        return new Response(JSON.stringify({
            success: true,
            voiceId,
            hadStorageFile: !!voice.audioStoragePath,
            deletedFromStorage,
            // Signal to client whether they should also delete from IndexedDB
            deleteFromIndexedDB: !voice.audioStoragePath, // Delete from IDB if not in cloud
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Delete voice error:', error);
        return new Response(JSON.stringify({
            error: error instanceof Error ? error.message : 'Failed to delete voice'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};