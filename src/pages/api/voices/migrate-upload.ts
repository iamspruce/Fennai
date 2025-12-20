import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie, checkProStatus } from '@/lib/firebase/auth';
import { getVoice, updateVoiceStorageType } from '@/lib/firebase/firestore';
import { uploadVoiceAudio } from '@/lib/firebase/storage';

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
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
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
        const voiceId = formData.get('voiceId') as string;
        const audioBlob = formData.get('audioBlob') as Blob;

        if (!voiceId || !audioBlob) {
            return new Response(JSON.stringify({ error: 'Missing voiceId or audioBlob' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Verify voice exists and belongs to user
        const voice = await getVoice(voiceId, uid);
        if (!voice) {
            return new Response(JSON.stringify({ error: 'Voice not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (voice.storageType !== 'local-only') {
            return new Response(JSON.stringify({ error: 'Voice is already in cloud storage' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Upload to Firebase Storage
        const audioFile = new File([audioBlob], `voice_${Date.now()}.mp3`, { type: 'audio/mpeg' });
        const { url, path } = await uploadVoiceAudio(uid, voice.characterId, audioFile);

        // Update Firestore document
        await updateVoiceStorageType(voiceId, uid, url, path);

        return new Response(JSON.stringify({
            success: true,
            voiceId,
            audioUrl: url,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Migration upload error:', error);
        return new Response(JSON.stringify({ error: 'Failed to migrate voice' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
