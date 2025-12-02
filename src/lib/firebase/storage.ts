// lib/firebase/storage.ts
import { storage } from './config';
import { adminStorage } from './firebase-admin';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { sanitizeFilename } from '../utils/validation';

// Get admin storage bucket instance
const bucket = adminStorage.bucket();

const USE_EMULATORS = import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const PROJECT_ID = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || 'demo-project';
const STORAGE_BUCKET = import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;

// ============================================================================
// SERVER-SIDE FUNCTIONS (Use Admin SDK)
// ============================================================================

/**
 * Helper to get a URL compatible with both Production and Emulators
 * from an Admin SDK File object.
 * - Emulators: Constructs the emulator URL directly (no auth needed)
 * - Production: Uses the standard public Google Storage URL
 */
async function getAdminFileUrl(fileRef: any, path: string): Promise<string> {
    if (USE_EMULATORS) {
        // For emulators, construct the URL directly without signing
        // Format: http://127.0.0.1:9199/v0/b/{bucket}/o/{encodedPath}?alt=media
        const encodedPath = encodeURIComponent(path);
        return `http://127.0.0.1:9199/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media`;
    }

    // Production: Standard public URL
    return `https://storage.googleapis.com/${STORAGE_BUCKET}/${path}`;
}

export async function uploadCharacterAudio(
    userId: string,
    characterId: string,
    file: File
): Promise<{ url: string; path: string }> {
    const filename = sanitizeFilename(file.name);
    const path = `users/${userId}/characters/${characterId}/sample_${Date.now()}_${filename}`;

    // Convert File to Buffer for Admin SDK
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = bucket.file(path);

    // Upload file
    await fileRef.save(buffer, {
        metadata: {
            contentType: file.type,
        },
    });

    // Make file publicly readable for production (no-op in emulator)
    if (!USE_EMULATORS) {
        await fileRef.makePublic();
    }

    // Get the correct URL based on environment
    const url = await getAdminFileUrl(fileRef, path);

    return { url, path };
}

export async function uploadVoiceAudio(
    userId: string,
    characterId: string,
    file: Blob,
    filename: string = 'voice.mp3'
): Promise<{ url: string; path: string }> {
    const sanitized = sanitizeFilename(filename);
    const path = `users/${userId}/voices/${characterId}/voice_${Date.now()}_${sanitized}`;

    // Convert Blob to Buffer for Admin SDK
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRef = bucket.file(path);

    // Upload file
    await fileRef.save(buffer, {
        metadata: {
            contentType: file.type,
        },
    });

    // Make file publicly readable for production (no-op in emulator)
    if (!USE_EMULATORS) {
        await fileRef.makePublic();
    }

    // Get the correct URL based on environment
    const url = await getAdminFileUrl(fileRef, path);

    return { url, path };
}

export async function deleteFileFromStorage(path: string): Promise<void> {
    const fileRef = bucket.file(path);
    await fileRef.delete();
}

/**
 * Delete voice audio from Firebase Storage
 */
export async function deleteVoiceAudio(storagePath: string): Promise<void> {
    try {
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
    } catch (error: any) {
        // If file doesn't exist (already deleted), don't throw error
        if (error.code === 'storage/object-not-found') {
            console.warn('Audio file already deleted:', storagePath);
            return;
        }
        throw error;
    }
}

/**
 * Delete character audio (sample) from Firebase Storage
 */
export async function deleteCharacterAudio(storagePath: string): Promise<void> {
    try {
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
    } catch (error: any) {
        if (error.code === 'storage/object-not-found') {
            console.warn('Character audio already deleted:', storagePath);
            return;
        }
        throw error;
    }
}

// ============================================================================
// CLIENT-SIDE FUNCTIONS (Use Client SDK)
// These work automatically with Emulators if ./config is set up correctly
// ============================================================================

export async function uploadCharacterAudioClient(
    userId: string,
    characterId: string,
    file: File
): Promise<{ url: string; path: string }> {
    const filename = sanitizeFilename(file.name);
    const path = `users/${userId}/characters/${characterId}/sample_${Date.now()}_${filename}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file);

    // Client SDK handles emulator/production URLs automatically
    const url = await getDownloadURL(storageRef);

    return { url, path };
}

export async function uploadVoiceAudioClient(
    userId: string,
    characterId: string,
    file: Blob,
    filename: string = 'voice.mp3'
): Promise<{ url: string; path: string }> {
    const sanitized = sanitizeFilename(filename);
    const path = `users/${userId}/voices/${characterId}/voice_${Date.now()}_${sanitized}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file);

    // Client SDK handles emulator/production URLs automatically
    const url = await getDownloadURL(storageRef);

    return { url, path };
}

export async function deleteFileFromStorageClient(path: string): Promise<void> {
    const storageRef = ref(storage, path);
    await deleteObject(storageRef);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Convert blob to File if needed
export function blobToFile(blob: Blob, filename: string): File {
    return new File([blob], filename, { type: blob.type });
}

// Generate signed URL (for private files - only works in production)
export async function getSignedUrl(path: string, expiresInMinutes: number = 60): Promise<string> {
    if (USE_EMULATORS) {
        // In emulator mode, return the public URL directly (no signing needed)
        const encodedPath = encodeURIComponent(path);
        return `http://127.0.0.1:9199/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media`;
    }

    // Production: Generate actual signed URL
    const fileRef = bucket.file(path);
    const [url] = await fileRef.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
    });

    return url;
}