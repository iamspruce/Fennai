export interface Character {
    id: string;
    userId: string;
    name: string;
    avatarUrl: string;
    sampleAudioUrl: string;
    sampleAudioStoragePath: string;
    voiceCount: number;
    createdAt: Date;
    updatedAt: Date;
    saveAcrossBrowsers?: boolean;
}

export interface CreateCharacterInput {
    name: string;
    avatarUrl: string;
    sampleAudioFile: File;
    saveAcrossBrowsers?: boolean;
}

export interface UpdateCharacterInput {
    name?: string;
    avatarUrl?: string;
}