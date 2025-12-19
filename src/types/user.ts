export interface User {
    uid: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    credits: number;
    pendingCredits: number;
    isPro: boolean;
    proExpiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
    // Counts for profile display
    characterCount?: number;
    voiceCount?: number;
    dubbedVideoCount?: number;
}

export interface UserSession {
    uid: string;
    email: string;
    displayName: string;
}

export type SubscriptionTier = 'free' | 'pro';