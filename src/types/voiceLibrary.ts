// src/types/voiceLibrary.ts

export interface LibraryVoice {
    id: string;
    name: string;
    description: string;
    language: string;
    languageCode: string;
    accent?: string;
    gender: 'male' | 'female' | 'neutral';
    age: 'young' | 'adult' | 'senior';
    emotion?: 'neutral' | 'happy' | 'sad' | 'energetic' | 'calm';
    isPro: boolean;
    audioUrl: string;
    audioStoragePath: string;
    duration: number;
    createdAt: Date;
    tags?: string[];
}

export interface VoiceFilter {
    language?: string;
    accent?: string;
    gender?: string;
    age?: string;
    emotion?: string;
    price?: 'free' | 'pro';
}

export const FILTER_CATEGORIES = {
    language: ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese', 'Arabic', 'Hindi'],
    accent: ['American', 'British', 'Australian', 'Indian', 'Spanish', 'French', 'German', 'Japanese'],
    gender: ['Male', 'Female', 'Neutral'],
    age: ['Young', 'Adult', 'Senior'],
    emotion: ['Neutral', 'Happy', 'Sad', 'Energetic', 'Calm'],
    price: ['Free', 'Pro']
} as const;

export const LANGUAGE_FLAGS: Record<string, string> = {
    'en': '🇺🇸',
    'es': '🇪🇸',
    'fr': '🇫🇷',
    'de': '🇩🇪',
    'it': '🇮🇹',
    'pt': '🇵🇹',
    'ru': '🇷🇺',
    'ja': '🇯🇵',
    'ko': '🇰🇷',
    'zh': '🇨🇳',
    'zh-TW': '🇹🇼',
    'ar': '🇸🇦',
    'hi': '🇮🇳',
    'bn': '🇧🇩',
    'pa': '🇮🇳',
    'te': '🇮🇳',
    'mr': '🇮🇳',
    'ta': '🇮🇳',
    'tr': '🇹🇷',
    'vi': '🇻🇳',
    'id': '🇮🇩',
    'th': '🇹🇭',
    'nl': '🇳🇱',
    'pl': '🇵🇱',
    'uk': '🇺🇦',
    'ro': '🇷🇴',
    'el': '🇬🇷',
    'sv': '🇸🇪',
    'cs': '🇨🇿',
    'hu': '🇭🇺',
};