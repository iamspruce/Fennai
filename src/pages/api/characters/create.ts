import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { adminDb } from '@/lib/firebase/firebase-admin';
import { uploadCharacterAudio } from '@/lib/firebase/storage';
import { generateAvatarUrl } from '@/lib/utils/avatar';
import { isValidCharacterName, isValidAudioFile } from '@/lib/utils/validation';

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

    try {
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const avatarStyle = formData.get('avatarStyle') as string;
        const voiceFile = formData.get('voiceFile') as File;

        // Validation
        if (!name || !avatarStyle || !voiceFile) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!isValidCharacterName(name)) {
            return new Response(JSON.stringify({ error: 'Character name must be between 2 and 50 characters' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!isValidAudioFile(voiceFile)) {
            return new Response(JSON.stringify({ error: 'Invalid audio file' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Generate avatar URL
        const avatarUrl = generateAvatarUrl(name, avatarStyle);

        // Create character document first to get ID
        const tempCharacterId = `temp_${Date.now()}`;

        // Upload audio to Firebase Storage (using Admin SDK)
        const { url: sampleAudioUrl, path: sampleAudioStoragePath } = await uploadCharacterAudio(
            uid,
            tempCharacterId,
            voiceFile
        );

        // Create character in Firestore using Admin SDK
        const now = new Date();
        const docRef = await adminDb.collection('characters').add({
            userId: uid,
            name,
            avatarUrl,
            sampleAudioUrl,
            sampleAudioStoragePath,
            voiceCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        return new Response(JSON.stringify({
            success: true,
            characterId: docRef.id
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Create character error:', error);
        return new Response(JSON.stringify({ error: 'Failed to create character' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};