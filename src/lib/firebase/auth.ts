// lib/firebase/auth.ts
import type { AstroGlobal } from 'astro';
import { adminAuth, adminDb } from './firebase-admin';
import type { User } from '../../types/user';

const SESSION_COOKIE_NAME = '__session';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days (Firebase limit)

// Get session cookie from request
export function getSessionCookie(request: Request): string | null {
    const cookies = request.headers.get('cookie');
    if (!cookies) return null;

    const cookieMatch = cookies.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    return cookieMatch ? cookieMatch[1] : null;
}

// Create session cookie options
export function createSessionCookieHeader(sessionCookie: string): string {
    const isProduction = import.meta.env.PROD;
    const secure = isProduction ? 'Secure;' : '';

    return `${SESSION_COOKIE_NAME}=${sessionCookie}; Path=/; HttpOnly; ${secure} SameSite=Strict; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

// Clear session cookie
export function clearSessionCookie(): string {
    const isProduction = import.meta.env.PROD;
    const secure = isProduction ? 'Secure;' : '';

    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${secure} SameSite=Strict; Max-Age=0`;
}

// Verify session cookie and get user
export async function verifySessionCookie(sessionCookie: string): Promise<{
    uid: string;
    email: string | undefined;
    emailVerified: boolean;
} | null> {
    try {
        const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true);
        return {
            uid: decodedClaims.uid,
            email: decodedClaims.email,
            emailVerified: decodedClaims.email_verified || false,
        };
    } catch (error) {
        console.error('Error verifying session cookie:', error);
        return null;
    }
}

// Get current user from Astro context
export async function getCurrentUser(Astro: AstroGlobal): Promise<User | null> {
    const sessionCookie = getSessionCookie(Astro.request);
    if (!sessionCookie) return null;

    try {
        const decodedClaims = await verifySessionCookie(sessionCookie);
        if (!decodedClaims) return null;

        // Get user data from Firestore
        const userDoc = await adminDb.collection('users').doc(decodedClaims.uid).get();

        if (!userDoc.exists) return null;

        const data = userDoc.data()!;
        return {
            uid: userDoc.id,
            email: data.email,
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
            credits: data.credits,
            pendingCredits: data.pendingCredits,
            isPro: data.isPro,
            proExpiresAt: data.proExpiresAt?.toDate(),
            characterCount: data.characterCount || 0,
            voiceCount: data.voiceCount || 0,
            dubbedVideoCount: data.dubbedVideoCount || 0,
            createdAt: data.createdAt.toDate(),
            updatedAt: data.updatedAt.toDate(),
        };
    } catch (error) {
        console.error('Error getting current user:', error);
        return null;
    }
}

// Create or update user in Firestore after authentication
export async function createOrUpdateUserDocument(uid: string, data: {
    email: string | null | undefined;
    displayName?: string | null;
    photoURL?: string | null;
}): Promise<void> {
    const userRef = adminDb.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        // Create new user document
        await userRef.set({
            email: data.email,
            displayName: data.displayName || data.email?.split('@')[0] || 'User',
            avatarUrl: data.photoURL || null,
            credits: 10, // Starting credits
            pendingCredits: 0,
            isPro: false,
            characterCount: 0,
            voiceCount: 0,
            dubbedVideoCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    } else {
        // Update last login
        await userRef.update({
            updatedAt: new Date(),
        });
    }
}

// Check if user is pro
export async function checkProStatus(userId: string): Promise<boolean> {
    const userDoc = await adminDb.collection('users').doc(userId).get();
    if (!userDoc.exists) return false;

    const data = userDoc.data()!;
    if (!data.isPro) return false;

    // Check if pro subscription is still valid
    if (data.proExpiresAt) {
        const expiresAt = data.proExpiresAt.toDate();
        return expiresAt > new Date();
    }

    return true;
}

// Deduct credits
export async function deductCredits(userId: string, amount: number = 1): Promise<boolean> {
    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) return false;

    const currentCredits = userDoc.data()!.credits || 0;

    if (currentCredits < amount) {
        return false; // Not enough credits
    }

    await userRef.update({
        credits: currentCredits - amount,
        updatedAt: new Date(),
    });

    return true;
}