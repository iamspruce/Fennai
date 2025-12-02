import type { APIRoute } from 'astro';
import { getSessionCookie, verifySessionCookie, checkProStatus, deductCredits } from '@/lib/firebase/auth';
import { createVoice, incrementVoiceCount, getCharacter } from '@/lib/firebase/firestore';
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
        return new Response('Invalid session', { status: 401 });
    }

    const uid = decodedClaims.uid;

    try {
        const formData = await request.formData();
        const characterId = formData.get('characterId') as string;
        const text = formData.get('text') as string;
        const audioBlob = formData.get('audioBlob') as Blob;
        const duration = parseFloat(formData.get('duration') as string);
        const isMultiCharacter = formData.get('isMultiCharacter') === 'true';
        const characterIds = formData.get('characterIds') as string;
        const dialoguesStr = formData.get('dialogues') as string;

        if (!characterId || !text || !audioBlob) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let dialogues;
        if (dialoguesStr) {
            try {
                dialogues = JSON.parse(dialoguesStr);
            } catch (e) {
                console.error('Failed to parse dialogues:', e);
            }
        }

        const isPro = await checkProStatus(uid);
        const character = await getCharacter(characterId, uid);

        if (!character) {
            return new Response(JSON.stringify({ error: 'Character not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let voiceId: string;
        let audioUrl: string | undefined;
        let audioStoragePath: string | undefined;
        let storageType: 'cloud' | 'local-only';

        // Determine storage strategy
        if (isPro && character.saveAcrossBrowsers === true) {
            // PRO with saveAcrossBrowsers: Upload to cloud
            storageType = 'cloud';

            const audioFile = new File([audioBlob], `voice_${Date.now()}.mp3`, { type: 'audio/mpeg' });
            const { url, path } = await uploadVoiceAudio(uid, characterId, audioFile);
            audioUrl = url;
            audioStoragePath = path;

            voiceId = await createVoice(uid, {
                characterId,
                text,
                audioUrl,
                audioStoragePath,
                storageType: 'cloud',
                isMultiCharacter,
                characterIds: characterIds ? JSON.parse(characterIds) : undefined,
                dialogues,
                duration,
            });
        } else {
            // FREE or PRO without saveAcrossBrowsers: Local-only
            storageType = 'local-only';

            // CRITICAL: Still create Firestore metadata (without audioUrl)
            voiceId = await createVoice(uid, {
                characterId,
                text,
                storageType: 'local-only',
                isMultiCharacter,
                characterIds: characterIds ? JSON.parse(characterIds) : undefined,
                dialogues,
                duration,
            });

            // Deduct credits for non-pro users
            if (!isPro) {
                const success = await deductCredits(uid, 1);
                if (!success) {
                    return new Response(JSON.stringify({ error: 'Failed to deduct credits' }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            }
        }

        // Always increment voice count (includes both cloud and local-only)
        await incrementVoiceCount(characterId, uid);

        return new Response(JSON.stringify({
            success: true,
            voiceId,
            isPro,
            storageType,
            // Return audio blob as base64 for local storage
            audioData: storageType === 'local-only' ? await blobToBase64(audioBlob) : undefined,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Save voice error:', error);
        return new Response(JSON.stringify({ error: 'Failed to save voice' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = Buffer.from(await blob.arrayBuffer());
    return `data:${blob.type};base64,` + buffer.toString('base64');
}