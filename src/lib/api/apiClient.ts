// lib/api/apiClient.ts
import { auth } from "../firebase/config";
import { db } from "../firebase/config";
import { doc, onSnapshot, getDoc, type Unsubscribe } from "firebase/firestore";

const USE_MOCK_API = import.meta.env.PUBLIC_USE_MOCK_VOICE_API === 'true';
const API_BASE_URL = USE_MOCK_API ? '/api' : import.meta.env.PUBLIC_VOICE_CLONE_API_URL;

// ==================== SHARED TYPES ====================

export interface JobStatus {
    jobId: string;
    status: 'queued' | 'processing' | 'retrying' | 'completed' | 'failed';
    audioUrl?: string;
    error?: string;
    expiresAt?: Date;
    duration?: number;
    actualCost?: number;
    reservedCost?: number;
    creditRefund?: number;
    speakerCount?: number;
    totalChunks?: number;
    completedChunks?: number;
    retryCount?: number;
    maxRetries?: number;
    lastError?: string;
    nextRetryAttempt?: number;
    retriesExhausted?: boolean;
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

// ==================== STORAGE FOR INTERRUPTED JOBS ====================

const PENDING_JOBS_KEY = 'fennai_pending_jobs';

interface PendingJob {
    jobId: string;
    characterId: string;
    text: string;
    isMultiCharacter: boolean;
    characterIds?: string[];
    texts?: string[];
    timestamp: number;
    status: 'queued' | 'processing' | 'retrying';
}

function savePendingJob(job: PendingJob): void {
    try {
        const pending = getPendingJobs();
        pending[job.jobId] = job;
        localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(pending));
    } catch (error) {
        console.warn('Failed to save pending job:', error);
    }
}

function removePendingJob(jobId: string): void {
    try {
        const pending = getPendingJobs();
        delete pending[jobId];
        localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(pending));
    } catch (error) {
        console.warn('Failed to remove pending job:', error);
    }
}

export function getPendingJobs(): Record<string, PendingJob> {
    try {
        const stored = localStorage.getItem(PENDING_JOBS_KEY);
        if (!stored) return {};

        const jobs = JSON.parse(stored);
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;

        // Clean up old jobs (>1 hour)
        const filtered: Record<string, PendingJob> = {};
        for (const [jobId, job] of Object.entries(jobs)) {
            if (now - (job as PendingJob).timestamp < ONE_HOUR) {
                filtered[jobId] = job as PendingJob;
            }
        }

        return filtered;
    } catch (error) {
        console.warn('Failed to get pending jobs:', error);
        return {};
    }
}

// ==================== UTILITY FUNCTIONS ====================

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

function listenToJobStatus(
    jobId: string,
    onUpdate: (status: JobStatus) => void,
    onError: (error: Error) => void,
    timeout: number = 300000
): Unsubscribe {
    const jobRef = doc(db, "voiceJobs", jobId);
    let unsubscribed = false;
    let snapshotUnsubscribe: Unsubscribe | null = null;
    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    let listenerFailed = false;
    let lastStatus: string | null = null;

    const timeoutId = setTimeout(() => {
        cleanup();
        onError(new Error('Generation timed out after 5 minutes'));
    }, timeout);

    const cleanup = () => {
        unsubscribed = true;
        if (snapshotUnsubscribe) {
            try {
                snapshotUnsubscribe();
            } catch (e) {
                console.warn('Error unsubscribing from snapshot:', e);
            }
        }
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }
        clearTimeout(timeoutId);
    };

    const processJobData = (data: any) => {
        if (!data || unsubscribed) return;

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
            retryCount: data.retryCount,
            maxRetries: data.maxRetries,
            lastError: data.lastError,
            nextRetryAttempt: data.nextRetryAttempt,
            retriesExhausted: data.retriesExhausted,
        };

        // Only call onUpdate if status actually changed
        if (lastStatus !== status.status) {
            lastStatus = status.status;
            onUpdate(status);
        } else {
            // Still call for progress updates
            onUpdate(status);
        }

        // Clean up if job is terminal
        if (status.status === 'completed' || status.status === 'failed') {
            cleanup();
        }
    };

    const startPolling = () => {
        if (pollingInterval || unsubscribed) return;

        console.log(`🔁 Starting polling for job ${jobId}`);

        pollingInterval = setInterval(async () => {
            if (unsubscribed) return;

            try {
                const docSnap = await getDoc(jobRef);

                if (!docSnap.exists()) {
                    console.warn(`Job ${jobId} not found during polling`);
                    return;
                }

                processJobData(docSnap.data());
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 2000);
    };

    // Try real-time listener first
    try {
        snapshotUnsubscribe = onSnapshot(
            jobRef,
            (docSnap) => {
                if (unsubscribed) return;

                if (!docSnap.exists()) {
                    console.warn(`Job ${jobId} not found in Firestore`);
                    return;
                }

                processJobData(docSnap.data());
            },
            (error) => {
                if (!listenerFailed && !unsubscribed) {
                    listenerFailed = true;
                    console.warn('⚠️ Firestore listener failed, switching to polling:', error.message);
                    startPolling();
                }
            }
        );

        console.log(`✅ Real-time listener established for job ${jobId}`);
    } catch (error) {
        console.warn('⚠️ Failed to set up Firestore listener, using polling:', error);
        startPolling();
    }

    return cleanup;
}

async function downloadAudioFromUrl(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
    }
    return await response.blob();
}

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

    console.log('🚀 Token:', token);
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

    console.log('📄 Full API Response:', JSON.stringify(result, null, 2));

    if (!result.data?.script) {
        throw new Error('No script returned from API');
    }

    return {
        script: result.data.script,
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

    const response = await fetch(`${API_BASE_URL}/voice_clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: params.text,
            character_ids: [params.characterId],
        }),
    });

    console.log(response);

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Voice cloning failed' }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const result = await response.json();
    const jobId = result.data?.jobId;

    if (!jobId) {
        throw new Error('No job ID returned from server');
    }

    // Save as pending job
    savePendingJob({
        jobId,
        characterId: params.characterId,
        text: params.text,
        isMultiCharacter: false,
        timestamp: Date.now(),
        status: 'queued'
    });

    return new Promise((resolve, reject) => {
        const unsubscribe = listenToJobStatus(
            jobId,
            async (status) => {
                // Update pending job status
                if (status.status !== 'completed' && status.status !== 'failed') {
                    savePendingJob({
                        jobId,
                        characterId: params.characterId,
                        text: params.text,
                        isMultiCharacter: false,
                        timestamp: Date.now(),
                        status: status.status as any
                    });
                }

                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    removePendingJob(jobId);
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = status.duration || await getAudioDuration(audioBlob);
                        resolve({ audioBlob, duration });
                    } catch (err) {
                        reject(err);
                    }
                } else if (status.status === 'failed') {
                    removePendingJob(jobId);
                    reject(new Error(status.error || 'Voice generation failed'));
                }
            },
            (error) => {
                removePendingJob(jobId);
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

    const characterIds = params.characters.map(char => char.characterId);
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
            character_ids: characterIds,
            character_texts: params.characters.map(c => c.text),
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Voice cloning failed' }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const result = await response.json();
    const jobId = result.data?.jobId;

    if (!jobId) {
        throw new Error('No job ID returned from server');
    }

    // Save as pending job
    savePendingJob({
        jobId,
        characterId: characterIds[0],
        text: text,
        isMultiCharacter: true,
        characterIds,
        texts: params.characters.map(c => c.text),
        timestamp: Date.now(),
        status: 'queued'
    });

    return new Promise((resolve, reject) => {
        listenToJobStatus(
            jobId,
            async (status) => {
                // Update pending job status
                if (status.status !== 'completed' && status.status !== 'failed') {
                    savePendingJob({
                        jobId,
                        characterId: characterIds[0],
                        text: text,
                        isMultiCharacter: true,
                        characterIds,
                        texts: params.characters.map(c => c.text),
                        timestamp: Date.now(),
                        status: status.status as any
                    });
                }

                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    removePendingJob(jobId);
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = status.duration || await getAudioDuration(audioBlob);
                        resolve({ audioBlob, duration });
                    } catch (err) {
                        reject(err);
                    }
                } else if (status.status === 'failed') {
                    removePendingJob(jobId);
                    reject(new Error(status.error || 'Voice generation failed'));
                }
            },
            (error) => {
                removePendingJob(jobId);
                reject(error);
            }
        );
    });
}

// ==================== RESUME INTERRUPTED JOB ====================

export async function resumeJob(
    jobId: string,
    onStatusUpdate?: (status: JobStatus) => void
): Promise<CloneVoiceResponse> {
    return new Promise((resolve, reject) => {
        listenToJobStatus(
            jobId,
            async (status) => {
                if (onStatusUpdate) {
                    onStatusUpdate(status);
                }

                if (status.status === 'completed' && status.audioUrl) {
                    removePendingJob(jobId);
                    try {
                        const audioBlob = await downloadAudioFromUrl(status.audioUrl);
                        const duration = status.duration || await getAudioDuration(audioBlob);
                        resolve({ audioBlob, duration });
                    } catch (err) {
                        reject(err);
                    }
                } else if (status.status === 'failed') {
                    removePendingJob(jobId);
                    reject(new Error(status.error || 'Voice generation failed'));
                }
            },
            (error) => {
                removePendingJob(jobId);
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