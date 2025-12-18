// types/dubbing.ts
export interface DubbingJob {
    id: string;
    uid: string;
    status: 'uploading' | 'transcribing' | 'transcribing_done' | 'clustering' | 'translating' |
    'cloning' | 'merging' | 'completed' | 'failed';
    step: string; // Human-readable status message
    progress: number; // 0-100

    // Media info
    mediaType: 'audio' | 'video';
    fileName?: string; // Original file name
    originalMediaUrl: string;
    originalMediaPath: string;
    audioUrl?: string; // Extracted audio if video
    audioPath?: string;
    duration: number;
    fileSize: number;

    // Transcription
    transcript?: TranscriptSegment[];
    detectedLanguage?: string;
    detectedLanguageCode?: string;
    otherLanguages?: string[];

    // Speaker clustering
    speakers?: SpeakerInfo[];
    speakerVoiceSamples?: Record<string, string>; // speaker_id -> GCS URL

    // User settings
    targetLanguage?: string;
    targetLanguageCode?: string;
    translateAll?: boolean; // true = translate entire audio
    segmentFilters?: SegmentFilter[]; // for selective translation
    voiceMapping?: Record<string, VoiceMapEntry>; // speaker_id -> character or 'original'
    scriptEdited?: boolean;

    // Voice cloning progress
    totalChunks?: number;
    completedChunks?: number;
    clonedAudioChunks?: ClonedChunk[];

    // Output
    clonedAudioUrl?: string;
    clonedAudioPath?: string;
    finalMediaUrl?: string;
    finalMediaPath?: string;

    // Costs & Credits
    cost: number;

    error?: string;
    errorDetails?: string;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date; // 24hr expiry for temp files
}

export interface TranscriptSegment {
    speakerId: string; // e.g., "speaker_1"
    text: string;
    translatedText?: string;
    startTime: number; // seconds
    endTime: number; // seconds
    confidence: number;
}

export interface SpeakerInfo {
    id: string; // e.g., "speaker_1"
    voiceSampleUrl: string; // 15-second sample in GCS
    voiceSamplePath: string;
    totalDuration: number; // total speaking time in seconds
    segmentCount: number; // number of segments this speaker has
}

export interface VoiceMapEntry {
    type: 'character' | 'original';
    characterId?: string;
    characterName?: string;
    characterAvatar?: string;
}

export interface SegmentFilter {
    type: 'speaker' | 'timerange';
    speakerId?: string; // for speaker filter
    startTime?: number; // for timerange filter
    endTime?: number; // for timerange filter
}

export interface ClonedChunk {
    chunkId: number;
    speakers: string[]; // up to 4 speaker IDs
    audioUrl?: string;
    audioPath?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
}

// Upload limits per tier
export interface UploadLimits {
    maxDurationSeconds: number;
    maxFileSizeMB: number;
    maxCharacters: number;
}

export const UPLOAD_LIMITS: Record<'free' | 'pro' | 'enterprise', UploadLimits> = {
    free: {
        maxDurationSeconds: 120, // 2 minutes
        maxFileSizeMB: 100,
        maxCharacters: 4
    },
    pro: {
        maxDurationSeconds: 1800, // 30 minutes
        maxFileSizeMB: 2048, // 2GB
        maxCharacters: 12
    },
    enterprise: {
        maxDurationSeconds: Infinity,
        maxFileSizeMB: Infinity,
        maxCharacters: Infinity
    }
};

// Supported languages (major world languages)
export const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'zh-TW', name: 'Chinese (Traditional)' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'bn', name: 'Bengali' },
    { code: 'pa', name: 'Punjabi' },
    { code: 'te', name: 'Telugu' },
    { code: 'mr', name: 'Marathi' },
    { code: 'ta', name: 'Tamil' },
    { code: 'tr', name: 'Turkish' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
    { code: 'th', name: 'Thai' },
    { code: 'nl', name: 'Dutch' },
    { code: 'pl', name: 'Polish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'ro', name: 'Romanian' },
    { code: 'el', name: 'Greek' },
    { code: 'sv', name: 'Swedish' },
    { code: 'cs', name: 'Czech' },
    { code: 'hu', name: 'Hungarian' },
];

// Helper to calculate dubbing cost
export function calculateDubbingCost(
    durationSeconds: number,
    hasTranslation: boolean = false,
    isVideo: boolean = false
): number {
    const baseCredits = Math.ceil(durationSeconds / 10); // 1 credit per 10 seconds
    const translationMultiplier = hasTranslation ? 1.5 : 1.0;
    const videoMultiplier = isVideo ? 1.2 : 1.0;

    return Math.max(1, Math.ceil(baseCredits * translationMultiplier * videoMultiplier));
}