import { db } from './config';
import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    Timestamp,
} from 'firebase/firestore';
import type { Character } from '@/types/character';
import type { DialogueSegment, Voice } from '@/types/voice';
import type { LibraryVoice } from '@/types/voiceLibrary';

// Performance monitoring utility
class FirestoreMonitor {
    private static logPerformance(operation: string, startTime: number, metadata?: Record<string, any>) {
        const duration = Date.now() - startTime;
        if (duration > 1000) {
            console.warn(`[Firestore] Slow operation: ${operation} took ${duration}ms`, metadata);
        }
    }

    private static logError(operation: string, error: any, context?: Record<string, any>) {
        console.error(`[Firestore Error] ${operation}:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            context,
            stack: error.stack,
        });
    }

    static async track<T>(
        operation: string,
        fn: () => Promise<T>,
        context?: Record<string, any>
    ): Promise<T> {
        const startTime = Date.now();
        try {
            const result = await fn();
            this.logPerformance(operation, startTime, context);
            return result;
        } catch (error: any) {
            this.logError(operation, error, context);
            throw new FirestoreError(operation, error, context);
        }
    }
}

// Custom error class
class FirestoreError extends Error {
    constructor(
        public operation: string,
        public originalError: any,
        public context?: Record<string, any>
    ) {
        super(`Firestore operation '${operation}' failed: ${originalError.message}`);
        this.name = 'FirestoreError';

        if (originalError.code) {
            (this as any).code = originalError.code;
        }
    }

    isPermissionDenied(): boolean {
        return (this.originalError as any)?.code === 'permission-denied';
    }

    isNotFound(): boolean {
        return (this.originalError as any)?.code === 'not-found';
    }

    isUnavailable(): boolean {
        return (this.originalError as any)?.code === 'unavailable';
    }
}

// ============================================================================
// CHARACTERS
// ============================================================================

// CREATE (Client SDK - runs in browser/API routes)
export async function createCharacter(
    userId: string,
    data: {
        name: string;
        avatarUrl: string;
        sampleAudioUrl: string;
        sampleAudioStoragePath: string;
        saveAcrossBrowsers: boolean;
    }
): Promise<string> {
    return FirestoreMonitor.track(
        'createCharacter',
        async () => {
            const now = Timestamp.now();

            const docRef = await addDoc(collection(db, 'characters'), {
                userId,
                name: data.name,
                avatarUrl: data.avatarUrl,
                sampleAudioUrl: data.sampleAudioUrl,
                sampleAudioStoragePath: data.sampleAudioStoragePath,
                saveAcrossBrowsers: data.saveAcrossBrowsers,
                characterCount: 0,
                voiceCount: 0,
                dubbedVideoCount: 0,
                createdAt: now,
                updatedAt: now,
            });

            // Increment characterCount for user
            await incrementUserCount(userId, 'characterCount', 1);

            return docRef.id;
        },
        { userId, characterName: data.name }
    );
}

// GET ONE (Admin SDK - runs server-side)
export async function getCharacter(characterId: string, userId: string): Promise<Character | null> {
    return FirestoreMonitor.track(
        'getCharacter',
        async () => {
            const docRef = adminDb.collection('characters').doc(characterId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                return null;
            }

            const data = docSnap.data()!;

            // Security check
            if (data.userId !== userId) {
                throw new Error('Permission denied: Character does not belong to user');
            }

            return {
                id: docSnap.id,
                userId: data.userId,
                name: data.name,
                avatarUrl: data.avatarUrl,
                sampleAudioUrl: data.sampleAudioUrl,
                sampleAudioStoragePath: data.sampleAudioStoragePath,
                voiceCount: data.voiceCount || 0,
                dubbedVideoCount: data.dubbedVideoCount || 0,
                saveAcrossBrowsers: data.saveAcrossBrowsers || false,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            };
        },
        { characterId, userId }
    );
}

// GET MANY (Admin SDK - runs server-side)
export async function getCharacters(
    userId: string,
    options?: {
        limit?: number;
        searchQuery?: string;
    }
): Promise<{ characters: Character[] }> {
    return FirestoreMonitor.track(
        'getCharacters',
        async () => {
            let query = adminDb.collection('characters')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc');

            if (options?.limit) {
                query = query.limit(options.limit);
            }

            const snapshot = await query.get();

            let characters = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    userId: data.userId,
                    name: data.name,
                    avatarUrl: data.avatarUrl,
                    sampleAudioUrl: data.sampleAudioUrl,
                    sampleAudioStoragePath: data.sampleAudioStoragePath,
                    voiceCount: data.voiceCount || 0,
                    dubbedVideoCount: data.dubbedVideoCount || 0,
                    createdAt: data.createdAt?.toDate() || new Date(),
                    updatedAt: data.updatedAt?.toDate() || new Date(),
                };
            });

            // Client-side search filtering
            if (options?.searchQuery) {
                const search = options.searchQuery.toLowerCase();
                characters = characters.filter(char =>
                    char.name.toLowerCase().includes(search)
                );
            }

            return { characters };
        },
        { userId, limit: options?.limit, hasSearch: !!options?.searchQuery }
    );
}

// UPDATE (Client SDK - runs in browser/API routes)
export async function updateCharacter(
    characterId: string,
    userId: string,
    data: Partial<Omit<Character, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
    return FirestoreMonitor.track(
        'updateCharacter',
        async () => {
            // Verify ownership first using client SDK
            const docRef = doc(db, 'characters', characterId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                throw new Error('Character not found');
            }

            const existing = docSnap.data();
            if (existing.userId !== userId) {
                throw new Error('Permission denied: Character does not belong to user');
            }

            await updateDoc(docRef, {
                ...data,
                updatedAt: Timestamp.now(),
            });
        },
        { characterId, userId, updatedFields: Object.keys(data) }
    );
}

// DELETE (Admin SDK - runs server-side)
export async function deleteCharacter(characterId: string, userId: string): Promise<void> {
    return FirestoreMonitor.track(
        'deleteCharacter',
        async () => {
            const docRef = adminDb.collection('characters').doc(characterId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Character not found');
            }

            const data = docSnap.data()!;
            if (data.userId !== userId) {
                throw new Error('Permission denied: Character does not belong to user');
            }

            await docRef.delete();

            // Decrement characterCount for user
            await incrementUserCount(userId, 'characterCount', -1);
        },
        { characterId, userId }
    );
}

/**
 * INCREMENT/DECREMENT voice count (Admin SDK - runs server-side)
 * @param amount - Positive to increment, negative to decrement
 */
export async function incrementVoiceCount(
    characterId: string,
    userId: string,
    amount: number = 1
): Promise<void> {
    return FirestoreMonitor.track(
        'incrementVoiceCount',
        async () => {
            const charRef = adminDb.collection('characters').doc(characterId);
            const userRef = adminDb.collection('users').doc(userId);

            const batch = adminDb.batch();

            // Increment in character
            batch.update(charRef, {
                voiceCount: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Increment in user
            batch.update(userRef, {
                voiceCount: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp(),
            });

            await batch.commit();
        },
        { characterId, userId, amount }
    );
}

/**
 * INCREMENT/DECREMENT dubbed video count for user and character
 */
export async function incrementDubbedCount(
    userId: string,
    characterId?: string,
    amount: number = 1
): Promise<void> {
    return FirestoreMonitor.track(
        'incrementDubbedCount',
        async () => {
            const userRef = adminDb.collection('users').doc(userId);
            const batch = adminDb.batch();

            batch.update(userRef, {
                dubbedVideoCount: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp(),
            });

            if (characterId) {
                const charRef = adminDb.collection('characters').doc(characterId);
                batch.update(charRef, {
                    dubbedVideoCount: FieldValue.increment(amount),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            await batch.commit();
        },
        { userId, characterId, amount }
    );
}

/**
 * INCREMENT/DECREMENT general user counts (characterCount, etc)
 */
export async function incrementUserCount(
    userId: string,
    field: 'characterCount' | 'voiceCount' | 'dubbedVideoCount',
    amount: number = 1
): Promise<void> {
    return FirestoreMonitor.track(
        'incrementUserCount',
        async () => {
            const userRef = adminDb.collection('users').doc(userId);
            await userRef.update({
                [field]: FieldValue.increment(amount),
                updatedAt: FieldValue.serverTimestamp(),
            });
        },
        { userId, field, amount }
    );
}


// ============================================================================
// VOICES
// ============================================================================


/**
 * GET ONE VOICE (Admin SDK - runs server-side)
 */
export async function getVoice(voiceId: string, userId: string): Promise<Voice | null> {
    return FirestoreMonitor.track(
        'getVoice',
        async () => {
            const docRef = adminDb.collection('voices').doc(voiceId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                return null;
            }

            const data = docSnap.data()!;

            // Security check
            if (data.userId !== userId) {
                throw new Error('Permission denied: Voice does not belong to user');
            }

            return {
                id: docSnap.id,
                userId: data.userId,
                characterId: data.characterId,
                text: data.text,
                audioUrl: data.audioUrl,
                audioStoragePath: data.audioStoragePath,
                storageType: data.storageType || 'local-only',
                isMultiCharacter: data.isMultiCharacter || false,
                characterIds: data.characterIds,
                duration: data.duration || 0,
                createdAt: data.createdAt?.toDate() || new Date(),
            };
        },
        { voiceId, userId }
    );
}

export async function createVoice(
    userId: string,
    data: {
        characterId: string;
        text: string;
        audioUrl?: string;
        audioStoragePath?: string;
        storageType: 'cloud' | 'local-only'; // NEW
        isMultiCharacter: boolean;
        characterIds?: string[];
        dialogues?: DialogueSegment[];
        duration: number;
    }
): Promise<string> {
    return FirestoreMonitor.track(
        'createVoice',
        async () => {
            const voiceData: any = {
                userId,
                characterId: data.characterId,
                text: data.text,
                storageType: data.storageType, // NEW
                isMultiCharacter: data.isMultiCharacter,
                duration: data.duration,
                createdAt: FieldValue.serverTimestamp(),
            };

            if (data.audioUrl) {
                voiceData.audioUrl = data.audioUrl;
            }

            if (data.audioStoragePath) {
                voiceData.audioStoragePath = data.audioStoragePath;
            }

            if (data.characterIds) {
                voiceData.characterIds = data.characterIds;
            }

            if (data.dialogues) {
                voiceData.dialogues = data.dialogues;
            }

            const docRef = await adminDb.collection('voices').add(voiceData);

            return docRef.id;
        },
        { userId, characterId: data.characterId, storageType: data.storageType }
    );
}

export async function getVoices(
    characterId: string,
    userId: string,
    options?: {
        limit?: number;
        storageType?: 'cloud' | 'local-only' | 'all';
    }
): Promise<{ voices: Voice[] }> {
    return FirestoreMonitor.track(
        'getVoices',
        async () => {
            let query = adminDb.collection('voices')
                .where('userId', '==', userId)
                .where('characterId', '==', characterId);

            // OPTIMIZATION: Only filter by storageType if it's NOT 'all'
            // This allows us to use the simpler index without storageType
            if (options?.storageType && options.storageType !== 'all') {
                query = query.where('storageType', '==', options.storageType);
            }

            // Always add orderBy after where clauses
            query = query.orderBy('createdAt', 'desc');

            if (options?.limit) {
                query = query.limit(options.limit);
            }

            const snapshot = await query.get();

            const voices = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    userId: data.userId,
                    characterId: data.characterId,
                    text: data.text,
                    audioUrl: data.audioUrl,
                    audioStoragePath: data.audioStoragePath,
                    storageType: data.storageType || 'local-only',
                    isMultiCharacter: data.isMultiCharacter || false,
                    characterIds: data.characterIds,
                    dialogues: data.dialogues,
                    duration: data.duration || 0,
                    createdAt: data.createdAt?.toDate() || new Date(),
                };
            });

            return { voices };
        },
        { characterId, userId, limit: options?.limit, storageType: options?.storageType }
    );
}

// NEW: Get count of local-only voices for migration banner
export async function getLocalOnlyVoiceCount(
    characterId: string,
    userId: string
): Promise<number> {
    return FirestoreMonitor.track(
        'getLocalOnlyVoiceCount',
        async () => {
            const snapshot = await adminDb.collection('voices')
                .where('userId', '==', userId)
                .where('characterId', '==', characterId)
                .where('storageType', '==', 'local-only')
                .count()
                .get();

            return snapshot.data().count;
        },
        { characterId, userId }
    );
}

// NEW: Update voice storage type (for migration)
export async function updateVoiceStorageType(
    voiceId: string,
    userId: string,
    audioUrl: string,
    audioStoragePath: string
): Promise<void> {
    return FirestoreMonitor.track(
        'updateVoiceStorageType',
        async () => {
            const docRef = adminDb.collection('voices').doc(voiceId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Voice not found');
            }

            const data = docSnap.data()!;
            if (data.userId !== userId) {
                throw new Error('Permission denied: Voice does not belong to user');
            }

            await docRef.update({
                storageType: 'cloud',
                audioUrl,
                audioStoragePath,
                updatedAt: FieldValue.serverTimestamp(),
            });
        },
        { voiceId, userId }
    );
}

// DELETE (Admin SDK - runs server-side)
export async function deleteVoice(voiceId: string, userId: string): Promise<void> {
    return FirestoreMonitor.track(
        'deleteVoice',
        async () => {
            const docRef = adminDb.collection('voices').doc(voiceId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Voice not found');
            }

            const data = docSnap.data()!;
            if (data.userId !== userId) {
                throw new Error('Permission denied: Voice does not belong to user');
            }

            await docRef.delete();
        },
        { voiceId, userId }
    );
}

/**
 * CREATE Voice Library Entry(Admin only - for manual uploads)
 */

export async function createVoiceLibraryEntry(data: {
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
    tags?: string[];
}): Promise<string> {
    return FirestoreMonitor.track(
        'createVoiceLibraryEntry',
        async () => {
            const docRef = await adminDb.collection('voiceLibrary').add({
                ...data,
                createdAt: FieldValue.serverTimestamp(),
            });

            return docRef.id;
        },
        { name: data.name }
    );
}

/**
 * GET Voice Library Entries (with filters)
 */
export async function getVoiceLibrary(filters?: {
    language?: string;
    gender?: string;
    isPro?: boolean;
    limit?: number;
}): Promise<{ voices: LibraryVoice[] }> {
    return FirestoreMonitor.track(
        'getVoiceLibrary',
        async () => {
            let query = adminDb.collection('voiceLibrary')
                .orderBy('createdAt', 'desc');

            if (filters?.language) {
                query = query.where('languageCode', '==', filters.language);
            }
            if (filters?.gender) {
                query = query.where('gender', '==', filters.gender);
            }
            if (filters?.isPro !== undefined) {
                query = query.where('isPro', '==', filters.isPro);
            }
            if (filters?.limit) {
                query = query.limit(filters.limit);
            }

            const snapshot = await query.get();

            const voices = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.name,
                    description: data.description,
                    language: data.language,
                    languageCode: data.languageCode,
                    accent: data.accent,
                    gender: data.gender,
                    age: data.age,
                    emotion: data.emotion,
                    isPro: data.isPro || false,
                    audioUrl: data.audioUrl,
                    audioStoragePath: data.audioStoragePath,
                    duration: data.duration || 0,
                    createdAt: data.createdAt?.toDate() || new Date(),
                    tags: data.tags || [],
                };
            });

            return { voices };
        },
        filters
    );
}

/**
 * DELETE Voice Library Entry (Admin only)
 */
export async function deleteVoiceLibraryEntry(voiceId: string): Promise<void> {
    return FirestoreMonitor.track(
        'deleteVoiceLibraryEntry',
        async () => {
            const docRef = adminDb.collection('voiceLibrary').doc(voiceId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Voice not found');
            }

            await docRef.delete();
        },
        { voiceId }
    );
}

/**
 * UPDATE Voice Library Entry (Admin only)
 */
export async function updateVoiceLibraryEntry(
    voiceId: string,
    data: Partial<Omit<LibraryVoice, 'id' | 'createdAt'>>
): Promise<void> {
    return FirestoreMonitor.track(
        'updateVoiceLibraryEntry',
        async () => {
            const docRef = adminDb.collection('voiceLibrary').doc(voiceId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Voice not found');
            }

            await docRef.update({
                ...data,
                updatedAt: FieldValue.serverTimestamp(),
            });
        },
        { voiceId }
    );
}

// ============================================================================
// DUBBING JOBS
// ============================================================================

export async function getDubbingJob(jobId: string, userId: string): Promise<any | null> {
    return FirestoreMonitor.track(
        'getDubbingJob',
        async () => {
            const docRef = adminDb.collection('dubbingJobs').doc(jobId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                return null;
            }

            const data = docSnap.data()!;

            // Security check
            if (data.uid !== userId) {
                throw new Error('Permission denied: Dubbing job does not belong to user');
            }

            return {
                id: docSnap.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            };
        },
        { jobId, userId }
    );
}

export async function deleteDubbingJob(jobId: string, userId: string): Promise<void> {
    return FirestoreMonitor.track(
        'deleteDubbingJob',
        async () => {
            const docRef = adminDb.collection('dubbingJobs').doc(jobId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Dubbing job not found');
            }

            const data = docSnap.data()!;
            if (data.uid !== userId) {
                throw new Error('Permission denied: Dubbing job does not belong to user');
            }

            await docRef.delete();

            // Decrement dubbed video count
            await incrementDubbedCount(userId, data.characterId, -1);
        },
        { jobId, userId }
    );
}


// UPDATE (Admin SDK - runs server-side)
export async function updateDubbingJob(
    jobId: string,
    userId: string,
    data: Partial<any>
): Promise<void> {
    return FirestoreMonitor.track(
        'updateDubbingJob',
        async () => {
            const docRef = adminDb.collection('dubbingJobs').doc(jobId);
            const docSnap = await docRef.get();

            if (!docSnap.exists) {
                throw new Error('Dubbing job not found');
            }

            const existingData = docSnap.data()!;
            if (existingData.uid !== userId) {
                throw new Error('Permission denied: Dubbing job does not belong to user');
            }

            await docRef.update({
                ...data,
                updatedAt: FieldValue.serverTimestamp(),
            });
        },
        { jobId, userId }
    );
}

// Export the error class
export { FirestoreError };