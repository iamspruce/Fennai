// types/dubbing.ts
export interface DubbingJob {
    id: string;
    uid: string;
    status: 'uploading' | 'extracting' | 'transcribing' | 'transcribing_done' | 'clustering' | 'translating' |
    'cloning' | 'merging' | 'completed' | 'failed' | 'retrying';
    step: string; // Human-readable status message
    progress: number; // 0-100

    // Retry Info
    retryCount?: number;
    maxRetries?: number;
    lastError?: string;
    retriesExhausted?: boolean;

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
    characterId?: string;
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
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'it', name: 'Italian', flag: '🇮🇹' },
    { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
    { code: 'ru', name: 'Russian', flag: '🇷🇺' },
    { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
    { code: 'ko', name: 'Korean', flag: '🇰🇷' },
    { code: 'zh', name: 'Chinese (Simplified)', flag: '🇨🇳' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', flag: '🇹🇼' },
    { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
    { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
    { code: 'bn', name: 'Bengali', flag: '🇧🇩' },
    { code: 'pa', name: 'Punjabi', flag: '🇮🇳' },
    { code: 'te', name: 'Telugu', flag: '🇮🇳' },
    { code: 'mr', name: 'Marathi', flag: '🇮🇳' },
    { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
    { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
    { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
    { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
    { code: 'th', name: 'Thai', flag: '🇹🇭' },
    { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
    { code: 'pl', name: 'Polish', flag: '🇵🇱' },
    { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
    { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
    { code: 'el', name: 'Greek', flag: '🇬🇷' },
    { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
    { code: 'cs', name: 'Czech', flag: '🇨🇿' },
    { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
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