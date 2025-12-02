const USE_MOCK_API = import.meta.env.PUBLIC_USE_MOCK_VOICE_API === 'true';
const API_BASE_URL = USE_MOCK_API ? '/api' : import.meta.env.VOICE_CLONE_API_URL;
const API_KEY = import.meta.env.VOICE_CLONE_API_KEY;

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

// Get auth token for API calls
async function getAuthToken(): Promise<string | null> {
    try {
        const response = await fetch('/api/auth/token');
        const data = await response.json();
        return data.sessionCookie;
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
}

// Clone single voice
export async function cloneSingleVoice(params: CloneVoiceParams): Promise<CloneVoiceResponse> {
    const token = await getAuthToken();

    if (!token) {
        throw new Error('Not authenticated');
    }

    const formData = new FormData();
    formData.append('character_id', params.characterId);
    formData.append('text', params.text);
    formData.append('audio', params.audioFile);

    const response = await fetch(`${API_BASE_URL}/mock-voice-clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Key': API_KEY,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Voice cloning failed' }));
        throw new Error(error.message || 'Voice cloning failed');
    }

    const audioBlob = await response.blob();

    // Get duration from audio
    const duration = await getAudioDuration(audioBlob);

    return {
        audioBlob,
        duration,
    };
}

// Clone multi-character voice
export async function cloneMultiVoice(params: MultiCloneVoiceParams): Promise<CloneVoiceResponse> {
    const token = await getAuthToken();

    if (!token) {
        throw new Error('Not authenticated');
    }

    const formData = new FormData();

    params.characters.forEach((char, index) => {
        formData.append(`character_${index}_id`, char.characterId);
        formData.append(`character_${index}_text`, char.text);
        formData.append(`character_${index}_audio`, char.audioFile);
    });

    const response = await fetch(`${API_BASE_URL}/multi-voice-clone`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Key': API_KEY,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Voice cloning failed' }));
        throw new Error(error.message || 'Voice cloning failed');
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