// Validation utilities - FIXED VERSION

export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function isValidCharacterName(name: string): boolean {
    return name.length >= 2 && name.length <= 50;
}

export function isValidAudioFile(file: File): boolean {
    // Check if file exists
    if (!file || !(file instanceof File)) {
        console.error('Invalid file object:', file);
        return false;
    }

    // Check file size
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size === 0) {
        console.error('Audio file is empty');
        return false;
    }
    if (file.size > maxSize) {
        console.error('Audio file too large:', file.size);
        return false;
    }

    // Comprehensive list of valid audio MIME types
    // WAV files can be: audio/wav, audio/wave, audio/x-wav, audio/vnd.wave
    const validTypes = [
        'audio/mpeg',       // MP3
        'audio/mp3',        // MP3 (non-standard but sometimes used)
        'audio/wav',        // WAV
        'audio/wave',       // WAV alternative
        'audio/x-wav',      // WAV alternative
        'audio/vnd.wave',   // WAV alternative
        'audio/ogg',        // OGG
        'audio/webm',       // WebM
        'audio/mp4',        // M4A/MP4
        'audio/x-m4a',      // M4A alternative
        'audio/aac',        // AAC
        'audio/flac',       // FLAC
        'audio/x-flac',     // FLAC alternative
    ];

    // Check MIME type - be permissive
    const isValidType = validTypes.includes(file.type) || file.type.startsWith('audio/');

    if (!isValidType) {
        console.error('Invalid audio MIME type:', file.type);
        return false;
    }

    // Also check file extension as a safety check
    const validExtensions = ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.aac', '.flac'];
    const fileName = file.name.toLowerCase();
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

    if (!hasValidExtension) {
        console.error('Invalid audio file extension:', file.name);
        return false;
    }

    return true;
}

export function isValidImageFile(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    return validTypes.includes(file.type) && file.size <= maxSize;
}

export function truncateText(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

export function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export function validateCharacterInput(data: {
    name: string;
    audioFile?: File;
}): ValidationResult {
    const errors: string[] = [];

    if (!isValidCharacterName(data.name)) {
        errors.push('Character name must be between 2 and 50 characters');
    }

    if (data.audioFile && !isValidAudioFile(data.audioFile)) {
        errors.push('Audio file must be MP3, WAV, OGG, or WebM and under 10MB');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}