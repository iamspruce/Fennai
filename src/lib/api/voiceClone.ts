// lib/api/voiceClone.ts
import { auth } from "../firebase/config";
import { db } from "../firebase/config";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";

const USE_MOCK_API = import.meta.env.PUBLIC_USE_MOCK_VOICE_API === 'true';
const API_BASE_URL = USE_MOCK_API ? '/api' : import.meta.env.PUBLIC_VOICE_CLONE_API_URL;

export interface CloneVoiceParams {
    characterId: string;
    text: string;
}

export interface MultiCloneVoiceParams {
    characters: Array<{
        characterId: string;
        text: string;
    }>;
}

export interface CloneVoiceResponse {
    audioBlob: Blob;
    duration: number;
}

export interface JobStatus {
    jobId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    error?: string;
    expiresAt?: Date;
}

// Get Firebase ID token for API calls
async function getAuthToken(): Promise<string | null> {
    try {
        const user = auth.currentUser;

        if (!user) {
            throw new Error('No authenticated user');
        }

        // Get fresh ID token
        return await user.getIdToken();
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
}

// Fetch character audio sample
async function fetchCharacterAudio(characterId: string): Promise<File> {
    const response = await fetch(`/api/characters/${characterId}/audio`);

    if (!response.ok) {
        throw new Error(`Failed to fetch audio for character ${characterId}`);
    }

    const audioBlob = await response.blob();
    return new File([audioBlob], 'sample.mp3', { type: 'audio/mpeg' });
}

// Convert audio file to base64
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Listen to job status updates from Firestore
function listenToJobStatus(
    jobId: string,
    onUpdate: (status: JobStatus) => void,
    onError: (error: Error) => void,
    timeout: number = 180000 // 3 minutes default
): Unsubscribe {
    const jobRef = doc(db, "voiceJobs", jobId);

    // Set up timeout
    const timeoutId = setTimeout(() => {
        unsubscribe();
        onError(new Error('Generation timed out after 3 minutes'));
    }, timeout);

    const unsubscribe = onSnapshot(
        jobRef,
        (docSnap) => {
            if (!docSnap.exists()) {
                console.warn(`Job ${jobId} not found in Firestore`);
                return;
            }

            const data = docSnap.data();
            const status: JobStatus = {
                jobId,
                status: data.status,
                audioUrl: data.audioUrl,
                error: data.error,
                expiresAt: data.expiresAt?.toDate(),
            };

            onUpdate(status);

            // Clean up if terminal state reached
            if (status.status === 'completed' || status.status === 'failed') {
                clearTimeout(timeoutId);
                unsubscribe();
            }
        },
        (error) => {
            clearTimeout(timeoutId);
            console.error('Firestore snapshot error:', error);
            onError(new Error('Connection lost to job status'));
        }
    );

    // Return unsubscribe function that also clears timeout
    return () => {
        clearTimeout(timeoutId);
        unsubscribe();
    };
}

// Download audio from signed URL
async function downloadAudioFromUrl(url: string): Promise<Blob> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
    }

    return await response.blob();
}

// Clone single voice (new async flow)
export async function cloneSingleVoice(
    params: CloneVoiceParams,
    onStatusUpdate?: (status: JobStatus) => void
): Promise<CloneVoiceResponse> {
    if (USE_MOCK_API) {
        return cloneSingleVoiceMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    // Fetch the character's audio sample
    const audioFile = await fetchCharacterAudio(params.characterId);

    // Convert audio file to base64
    const voiceBase64 = await fileToBase64(audioFile);

    // Call the proxy function to queue the job
    const response = await fetch(`${API_BASE_URL}/voice_clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: params.text,
            voice_samples: [voiceBase64],
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Voice cloning failed' }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const result = await response.json();
    const jobId = result.job_id;

    if (!jobId) {
        throw new Error('No job ID returned from server');
    }

    // Listen to job status and wait for completion
    return new Promise((resolve, reject) => {
        const unsubscribe = listenToJobStatus(
            jobId,
            async (status) => {
                // Call optional status update callback
                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = await getAudioDuration(audioBlob);
                        resolve({ audioBlob, duration });
                    } catch (err) {
                        reject(err);
                    }
                } else if (status.status === 'failed') {
                    reject(new Error(status.error || 'Voice generation failed'));
                }
            },
            (error) => {
                reject(error);
            }
        );
    });
}

// Clone multi-character voice (new async flow)
export async function cloneMultiVoice(
    params: MultiCloneVoiceParams,
    onStatusUpdate?: (status: JobStatus) => void
): Promise<CloneVoiceResponse> {
    if (USE_MOCK_API) {
        return cloneMultiVoiceMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    // Fetch all character audio samples in parallel
    const audioFiles = await Promise.all(
        params.characters.map(char => fetchCharacterAudio(char.characterId))
    );

    // Convert all audio files to base64
    const voiceSamples = await Promise.all(
        audioFiles.map(file => fileToBase64(file))
    );

    // Format text with speaker labels
    const text = params.characters
        .map((char, index) => `Speaker ${index + 1}: ${char.text}`)
        .join('\n');

    // Call the proxy function to queue the job
    const response = await fetch(`${API_BASE_URL}/voice_clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: text,
            voice_samples: voiceSamples,
            character_texts: params.characters.map(c => c.text),
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Voice cloning failed' }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const result = await response.json();
    const jobId = result.job_id;

    if (!jobId) {
        throw new Error('No job ID returned from server');
    }

    // Listen to job status and wait for completion
    return new Promise((resolve, reject) => {
        const unsubscribe = listenToJobStatus(
            jobId,
            async (status) => {
                // Call optional status update callback
                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = await getAudioDuration(audioBlob);
                        resolve({ audioBlob, duration });
                    } catch (err) {
                        reject(err);
                    }
                } else if (status.status === 'failed') {
                    reject(new Error(status.error || 'Voice generation failed'));
                }
            },
            (error) => {
                reject(error);
            }
        );
    });
}

// Get audio duration
async function getAudioDuration(blob: Blob): Promise<number> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        const url = URL.createObjectURL(blob);

        audio.addEventListener('loadedmetadata', () => {
            URL.revokeObjectURL(url);
            resolve(audio.duration);
        });

        audio.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load audio'));
        });

        audio.src = url;
    });
}

// Check if user has credits or is pro
export async function checkUserCanClone(): Promise<{ canClone: boolean; reason?: string }> {
    try {
        const response = await fetch('/api/voices/check-credits');
        const data = await response.json();
        return data;
    } catch (error) {
        return { canClone: false, reason: 'Failed to check credits' };
    }
}

// ==================== MOCK IMPLEMENTATIONS ====================

async function cloneSingleVoiceMock(params: CloneVoiceParams): Promise<CloneVoiceResponse> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const mockBlob = new Blob([buffer.getChannelData(0)], { type: 'audio/wav' });
    return { audioBlob: mockBlob, duration: 1.0 };
}

async function cloneMultiVoiceMock(params: MultiCloneVoiceParams): Promise<CloneVoiceResponse> {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const mockBlob = new Blob([buffer.getChannelData(0)], { type: 'audio/wav' });
    return { audioBlob: mockBlob, duration: 2.0 };
}