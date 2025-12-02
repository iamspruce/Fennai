// Validation utilities

export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function isValidCharacterName(name: string): boolean {
    return name.length >= 2 && name.length <= 50;
}

export function isValidAudioFile(file: File): boolean {
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/webm'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    return validTypes.includes(file.type) && file.size <= maxSize;
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
        errors.push('Audio file must be MP3, WAV, or OGG and under 10MB');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}