import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { adminDb, adminStorage } from '@/lib/firebase/firebase-admin';

export const GET: APIRoute = async ({ params, request }) => {
    try {
        const { id } = params;

        if (!id) {
            return new Response(JSON.stringify({ error: 'Character ID required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Verify session
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

        // Fetch character using Admin SDK
        const docRef = adminDb.collection('characters').doc(id);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return new Response(JSON.stringify({ error: 'Character not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const character = docSnap.data();

        // Verify ownership
        if (character?.userId !== uid) {
            return new Response(JSON.stringify({ error: 'Permission denied' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get audio file from Firebase Storage using Admin SDK
        const bucket = adminStorage.bucket();
        const file = bucket.file(character.sampleAudioStoragePath);

        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
            return new Response(JSON.stringify({ error: 'Audio file not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Download file as buffer
        const [audioBuffer] = await file.download();

        // Return audio file
        return new Response(audioBuffer as unknown as BodyInit, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
                'Content-Length': audioBuffer.length.toString(),
            }
        });

    } catch (error: any) {
        console.error('Error fetching character audio:', error);

        return new Response(
            JSON.stringify({
                error: 'Failed to fetch audio',
                details: error.message
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
};