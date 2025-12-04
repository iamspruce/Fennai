import { auth } from "../firebase/config";

const USE_MOCK_API = import.meta.env.PUBLIC_USE_MOCK_VOICE_API === 'true';
const API_BASE_URL = USE_MOCK_API ? '/api' : import.meta.env.PUBLIC_VOICE_CLONE_API_URL;

export interface CloneVoiceParams {
    characterId: string;
    text: string;
    audioFile: File;
}

export interface MultiCloneVoiceParams {
    characters: Array<{
        characterId: string;
        text: string;
        audioFile: File;
    }>;
}

export interface CloneVoiceResponse {
    audioBlob: Blob;
    duration: number;
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

// Convert audio file to base64
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1]; // Remove data:audio/...;base64, prefix
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Clone single voice using the new API
export async function cloneSingleVoice(params: CloneVoiceParams): Promise<CloneVoiceResponse> {
    if (USE_MOCK_API) {
        return cloneSingleVoiceMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    // Convert audio file to base64
    const voiceBase64 = await fileToBase64(params.audioFile);

    // Call the Firebase proxy function
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

    const audioBlob = await response.blob();
    const duration = await getAudioDuration(audioBlob);

    return {
        audioBlob,
        duration,
    };
}

// Clone multi-character voice using the new API
export async function cloneMultiVoice(params: MultiCloneVoiceParams): Promise<CloneVoiceResponse> {
    if (USE_MOCK_API) {
        return cloneMultiVoiceMock(params);
    }

    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    // Convert all audio files to base64
    const voiceSamples = await Promise.all(
        params.characters.map(char => fileToBase64(char.audioFile))
    );

    // Format text with speaker labels
    const text = params.characters
        .map((char, index) => `Speaker ${index + 1}: ${char.text}`)
        .join('\n');

    // Call the Firebase proxy function
    const response = await fetch(`${API_BASE_URL}/voice_clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: text,
            voice_samples: voiceSamples,
            character_texts: params.characters.map(c => c.text), // For credit calculation
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Voice cloning failed' }));
        throw new Error(error.error || 'Voice cloning failed');
    }

    const audioBlob = await response.blob();
    const duration = await getAudioDuration(audioBlob);

    return {
        audioBlob,
        duration,
    };
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
// These are fallbacks for development/testing

async function cloneSingleVoiceMock(params: CloneVoiceParams): Promise<CloneVoiceResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create a mock audio blob (1 second of silence)
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const mockBlob = new Blob([buffer.getChannelData(0)], { type: 'audio/wav' });

    return {
        audioBlob: mockBlob,
        duration: 1.0,
    };
}

async function cloneMultiVoiceMock(params: MultiCloneVoiceParams): Promise<CloneVoiceResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create a mock audio blob (2 seconds of silence)
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
    const mockBlob = new Blob([buffer.getChannelData(0)], { type: 'audio/wav' });

    return {
        audioBlob: mockBlob,
        duration: 2.0,
    };
}