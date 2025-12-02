export interface User {
    uid: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    credits: number;
    isPro: boolean;
    proExpiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserSession {
    uid: string;
    email: string;
    displayName: string;
}

export type SubscriptionTier = 'free' | 'pro';