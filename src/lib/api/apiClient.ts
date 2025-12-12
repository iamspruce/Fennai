// lib/api/apiClient.ts
import { auth } from "../firebase/config";
import { db } from "../firebase/config";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";

const USE_MOCK_API = import.meta.env.PUBLIC_USE_MOCK_VOICE_API === 'true';
const API_BASE_URL = USE_MOCK_API ? '/api' : import.meta.env.PUBLIC_VOICE_CLONE_API_URL;

// ==================== SHARED TYPES ====================

export interface JobStatus {
    jobId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    error?: string;
    expiresAt?: Date;
    // Enhanced fields
    duration?: number;
    actualCost?: number;
    reservedCost?: number;
    creditRefund?: number;
    speakerCount?: number;
    totalChunks?: number;
    completedChunks?: number;
}

// ==================== VOICE CLONING TYPES ====================

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

// ==================== SCRIPT GENERATION TYPES ====================

export interface GenerateScriptParams {
    mode: 'single' | 'dialogue';
    template: string;
    context: string;
    characters: Array<{
        id: string;
        name: string;
    }>;
    tone: string;
    length: string;
}

export interface GenerateScriptResponse {
    script: string;
    generationId: string;
    requestId: string;
}

// ==================== DUBBING TYPES ====================

export interface TranscribeDubbingParams {
    mediaData: string; // base64
    mediaType: 'audio' | 'video';
    fileName: string;
    duration: number;
    fileSizeMB: number;
    detectedLanguage: string;
    detectedLanguageCode: string;
    otherLanguages?: string[];
}

export interface TranscribeDubbingResponse {
    jobId: string;
    status: string;
}

export interface TranslateDubbingParams {
    jobId: string;
    targetLanguage: string;
    segmentIndices?: number[]; // Optional: only translate specific segments
}

export interface TranslateDubbingResponse {
    jobId: string;
    status: string;
}

export interface CloneDubbingParams {
    jobId: string;
}

export interface CloneDubbingResponse {
    jobId: string;
    status: string;
}

export interface UpdateDubbingScriptParams {
    jobId: string;
    updatedTranscript: Array<{
        startTime: number;
        endTime: number;
        text: string;
        speakerId: string;
    }>;
}

export interface UpdateDubbingScriptResponse {
    success: boolean;
    jobId: string;
}

// ==================== UTILITY FUNCTIONS ====================

// Get Firebase ID token for API calls
async function getAuthToken(): Promise<string | null> {
    try {
        const user = auth.currentUser;

        if (!user) {
            throw new Error('No authenticated user');
        }

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
    timeout: number = 300000 // 5 minutes default
): Unsubscribe {
    const jobRef = doc(db, "voiceJobs", jobId);

    const timeoutId = setTimeout(() => {
        unsubscribe();
        onError(new Error('Generation timed out'));
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
                duration: data.duration,
                actualCost: data.actualCost,
                reservedCost: data.reservedCost,
                creditRefund: data.creditRefund,
                speakerCount: data.speakerCount,
                totalChunks: data.totalChunks,
                completedChunks: data.completedChunks,
            };

            onUpdate(status);

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

// ==================== SCRIPT GENERATION ====================

/**
 * Generate an AI script using Gemini
 */
export async function generateScript(
    params: GenerateScriptParams
): Promise<GenerateScriptResponse> {
    if (USE_MOCK_API) {
        return generateScriptMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/generate_script`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({
            error: 'Script generation failed'
        }));
        throw new Error(error.error || `HTTP ${response.status}: Script generation failed`);
    }

    const result = await response.json();

    if (!result.script) {
        throw new Error('No script returned from API');
    }

    return {
        script: result.script,
        generationId: result.generationId,
        requestId: result.requestId,
    };
}

// ==================== VOICE CLONING ====================

/**
 * Clone a single character's voice
 */
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

    const audioFile = await fetchCharacterAudio(params.characterId);
    const voiceBase64 = await fileToBase64(audioFile);

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

    return new Promise((resolve, reject) => {
        const unsubscribe = listenToJobStatus(
            jobId,
            async (status) => {
                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = status.duration || await getAudioDuration(audioBlob);
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

/**
 * Clone multiple character voices (dialogue)
 */
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

    return new Promise((resolve, reject) => {
        const unsubscribe = listenToJobStatus(
            jobId,
            async (status) => {
                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = status.duration || await getAudioDuration(audioBlob);
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

// ==================== DUBBING API ====================

/**
 * Upload and transcribe media for dubbing
 */
export async function transcribeDubbing(
    params: TranscribeDubbingParams
): Promise<TranscribeDubbingResponse> {
    if (USE_MOCK_API) {
        return transcribeDubbingMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/dub/transcribe`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({
            error: 'Transcription failed'
        }));
        throw new Error(error.error || 'Transcription failed');
    }

    const result = await response.json();

    return {
        jobId: result.job_id,
        status: result.status,
    };
}

/**
 * Translate dubbing segments
 */
export async function translateDubbing(
    params: TranslateDubbingParams
): Promise<TranslateDubbingResponse> {
    if (USE_MOCK_API) {
        return translateDubbingMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/dub/translate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({
            error: 'Translation failed'
        }));
        throw new Error(error.error || 'Translation failed');
    }

    const result = await response.json();

    return {
        jobId: result.job_id || params.jobId,
        status: result.status,
    };
}

/**
 * Start voice cloning for dubbing job
 */
export async function cloneDubbing(
    params: CloneDubbingParams
): Promise<CloneDubbingResponse> {
    if (USE_MOCK_API) {
        return cloneDubbingMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE_URL}/dub/clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({
            error: 'Voice cloning failed'
        }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const result = await response.json();

    return {
        jobId: result.job_id || params.jobId,
        status: result.status,
    };
}



// ==================== MOCK IMPLEMENTATIONS ====================

async function generateScriptMock(params: GenerateScriptParams): Promise<GenerateScriptResponse> {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mockScripts = {
        single: `This is a mock script for ${params.characters[0]?.name || 'the character'}. 
            In a real implementation, this would be an AI-generated script based on your prompt.
            The tone is ${params.tone.toLowerCase()} and the length is ${params.length.toLowerCase()}.`,
        dialogue: params.characters.map((char, idx) =>
            `${char.name}: This is line ${idx + 1} in the mock dialogue.`
        ).join('\n\n')
    };

    return {
        script: mockScripts[params.mode],
        generationId: `mock_${Date.now()}`,
        requestId: `req_${Date.now()}`,
    };
}

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

async function transcribeDubbingMock(params: TranscribeDubbingParams): Promise<TranscribeDubbingResponse> {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return {
        jobId: `dub_mock_${Date.now()}`,
        status: 'transcribing',
    };
}

async function translateDubbingMock(params: TranslateDubbingParams): Promise<TranslateDubbingResponse> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return {
        jobId: params.jobId,
        status: 'translating',
    };
}

async function cloneDubbingMock(params: CloneDubbingParams): Promise<CloneDubbingResponse> {
    await new Promise(resolve => setTimeout(resolve, 2500));
    return {
        jobId: params.jobId,
        status: 'cloning',
    };
}

async function updateDubbingScriptMock(params: UpdateDubbingScriptParams): Promise<UpdateDubbingScriptResponse> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
        success: true,
        jobId: params.jobId,
    };
}