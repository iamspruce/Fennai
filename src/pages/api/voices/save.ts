// src/pages/api/voices/save.ts - UPDATED WITH SAFARI FIX
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

        // Validate audio blob (Safari compatibility check)
        if (audioBlob.size === 0) {
            return new Response(JSON.stringify({ error: 'Empty audio file' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // NEW: Validate WAV header for Safari compatibility
        try {
            await validateWAVBlob(audioBlob);
        } catch (validationError) {
            console.error('[API] WAV validation failed:', validationError);
            return new Response(JSON.stringify({
                error: 'Invalid audio format',
                details: validationError instanceof Error ? validationError.message : 'Unknown error'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let dialogues;
        if (dialoguesStr) {
            try {
                dialogues = JSON.parse(dialoguesStr);
            } catch (e) {
                console.error('[API] Failed to parse dialogues:', e);
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

        console.log('[API] Processing voice save:', {
            characterId,
            userId: uid,
            isPro,
            saveAcrossBrowsers: character.saveAcrossBrowsers,
            audioBlobSize: audioBlob.size,
            audioBlobType: audioBlob.type,
            duration
        });

        // Determine storage strategy
        if (isPro && character.saveAcrossBrowsers === true) {
            // PRO with saveAcrossBrowsers: Upload to cloud
            storageType = 'cloud';

            console.log('[API] Using cloud storage for Pro user');

            // NEW: Use proper filename with .wav extension for Safari compatibility
            const audioFile = new File(
                [audioBlob],
                `voice_${Date.now()}.wav`, // Changed from .mp3 to .wav
                { type: audioBlob.type || 'audio/wav' } // Use actual blob type
            );

            try {
                const { url, path } = await uploadVoiceAudio(uid, characterId, audioFile);
                audioUrl = url;
                audioStoragePath = path;

                console.log('[API] Audio uploaded successfully:', { url, path });
            } catch (uploadError) {
                console.error('[API] Upload failed:', uploadError);
                throw new Error('Failed to upload audio to cloud storage');
            }

            try {
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

                console.log('[API] Cloud voice record created:', voiceId);
            } catch (firestoreError) {
                console.error('[API] Firestore save failed:', firestoreError);

                // Try to clean up uploaded file on Firestore failure
                if (audioStoragePath) {
                    try {
                        const { deleteFileFromStorage } = await import('@/lib/firebase/storage');
                        await deleteFileFromStorage(audioStoragePath);
                        console.log('[API] Cleaned up uploaded file after Firestore failure');
                    } catch (cleanupError) {
                        console.error('[API] Cleanup failed:', cleanupError);
                    }
                }

                throw new Error('Failed to save voice metadata');
            }
        } else {
            // FREE or PRO without saveAcrossBrowsers: Local-only
            storageType = 'local-only';

            console.log('[API] Using local-only storage');

            // CRITICAL: Still create Firestore metadata (without audioUrl)
            try {
                voiceId = await createVoice(uid, {
                    characterId,
                    text,
                    storageType: 'local-only',
                    isMultiCharacter,
                    characterIds: characterIds ? JSON.parse(characterIds) : undefined,
                    dialogues,
                    duration,
                });

                console.log('[API] Local-only voice record created:', voiceId);
            } catch (firestoreError) {
                console.error('[API] Firestore save failed:', firestoreError);
                throw new Error('Failed to save voice metadata');
            }
        }

        // Always increment voice count (includes both cloud and local-only)
        try {
            await incrementVoiceCount(characterId, uid);
            console.log('[API] Voice count incremented');
        } catch (countError) {
            console.warn('[API] Failed to increment voice count:', countError);
            // Non-critical, continue
        }

        // Prepare response
        const response: any = {
            success: true,
            voiceId,
            isPro,
            storageType,
        };

        // Return audio blob as base64 for local storage
        if (storageType === 'local-only') {
            try {
                response.audioData = await blobToBase64(audioBlob);
                console.log('[API] Audio converted to base64 for local storage');
            } catch (base64Error) {
                console.error('[API] Base64 conversion failed:', base64Error);
                throw new Error('Failed to convert audio for local storage');
            }
        } else {
            // For cloud storage, return the URL for optional local caching
            response.audioUrl = audioUrl;
        }

        console.log('[API] Voice save complete:', { voiceId, storageType });

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('[API] Save voice error:', error);

        const errorMessage = error instanceof Error ? error.message : 'Failed to save voice';
        const errorDetails = error instanceof Error ? error.stack : undefined;

        return new Response(JSON.stringify({
            error: errorMessage,
            details: errorDetails
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

// NEW: Safari-compatible WAV validation
async function validateWAVBlob(blob: Blob): Promise<void> {
    if (blob.size < 44) {
        throw new Error('Audio file too small to be valid WAV');
    }

    try {
        // Read first 44 bytes (WAV header)
        const headerBuffer = await blob.slice(0, 44).arrayBuffer();
        const view = new DataView(headerBuffer);

        // Check RIFF signature
        const riff = String.fromCharCode(
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3)
        );

        if (riff !== 'RIFF') {
            throw new Error(`Invalid RIFF header: expected 'RIFF', got '${riff}'`);
        }

        // Check WAVE signature
        const wave = String.fromCharCode(
            view.getUint8(8),
            view.getUint8(9),
            view.getUint8(10),
            view.getUint8(11)
        );

        if (wave !== 'WAVE') {
            throw new Error(`Invalid WAVE header: expected 'WAVE', got '${wave}'`);
        }

        // Check file size consistency
        const declaredSize = view.getUint32(4, true) + 8;
        const sizeDiff = Math.abs(declaredSize - blob.size);

        if (sizeDiff > 1) {
            console.warn('[API] WAV size mismatch:', {
                declared: declaredSize,
                actual: blob.size,
                difference: sizeDiff
            });
            // Don't throw, just warn - some encoders have slight discrepancies
        }

        // Check for 'fmt ' chunk
        const fmt = String.fromCharCode(
            view.getUint8(12),
            view.getUint8(13),
            view.getUint8(14),
            view.getUint8(15)
        );

        if (fmt !== 'fmt ') {
            throw new Error(`Invalid format chunk: expected 'fmt ', got '${fmt}'`);
        }

        // Check audio format (should be 1 for PCM)
        const audioFormat = view.getUint16(20, true);
        if (audioFormat !== 1) {
            console.warn('[API] Non-PCM audio format:', audioFormat);
            // Don't throw - some valid formats use non-PCM
        }

        console.log('[API] WAV validation passed ✓');
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('Failed to validate WAV file');
    }
}

async function blobToBase64(blob: Blob): Promise<string> {
    try {
        const buffer = Buffer.from(await blob.arrayBuffer());
        const base64 = buffer.toString('base64');

        // Use actual blob type, fallback to audio/wav
        const mimeType = blob.type || 'audio/wav';

        return `data:${mimeType};base64,${base64}`;
    } catch (error) {
        console.error('[API] Base64 conversion error:', error);
        throw new Error('Failed to convert audio to base64');
    }
}