export interface DialogueSegment {
    characterId: string;
    text: string;
}

export interface Voice {
    id: string;
    userId: string;
    characterId: string;
    text: string;
    audioUrl?: string;
    audioStoragePath?: string;
    audioBlob?: Blob;
    storageType: 'cloud' | 'local-only'; // NEW: Critical field
    isMultiCharacter: boolean;
    characterIds?: string[];
    dialogues?: DialogueSegment[];
    duration: number;
    createdAt: Date;
}

export interface VoiceListItem {
    id: string;
    text: string;
    audioUrl?: string;
    audioBlob?: Blob;
    characterId: string;
    characterName: string;
    characterAvatar: string;
    storageType: 'cloud' | 'local-only'; // NEW
    isMultiCharacter: boolean;
    characterIds?: string[];
    dialogues?: DialogueSegment[];
    duration: number;
    createdAt: Date;
}