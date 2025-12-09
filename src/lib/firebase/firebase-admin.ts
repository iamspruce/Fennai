// lib/firebase/firebase-admin.ts

import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const getEnv = (key: string) => {
    // Check both import.meta.env and process.env
    if (typeof import.meta !== 'undefined' && import.meta.env?.[key]) {
        return import.meta.env[key];
    }
    return process.env[key];
};

const isEmulator = getEnv('PUBLIC_USE_FIREBASE_EMULATORS') === 'true';
const projectId = getEnv('APP_FIREBASE_PROJECT_ID');
const storageBucket = getEnv('APP_FIREBASE_STORAGE_BUCKET');
const privateKey = getEnv('APP_FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
const clientEmail = getEnv('APP_FIREBASE_CLIENT_EMAIL');

if (!getApps().length) {
    try {
        if (isEmulator) {
            // Emulator mode
            process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
            process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

            initializeApp({
                projectId: projectId || 'demo-project',
            });
            console.log('Firebase Admin → using emulators');
        } else {
            // Production mode
            // Check if we have explicit credentials or use 

            if (!privateKey || !clientEmail || !projectId) {
                // If service account JSON is provided as string, parse it
                initializeApp({
                    credential: cert({
                        projectId,
                        clientEmail,
                        privateKey,
                    } as any),
                    projectId,
                    storageBucket
                });
                console.log('Firebase Admin → production mode (service account)');
            } else {
                // Use application default credentials (works in Cloud Functions/Cloud Run)
                initializeApp({
                    credential: applicationDefault(),
                    projectId: projectId || 'fennai',
                    storageBucket: storageBucket || 'fennai.firebasestorage.app',
                });
                console.log('Firebase Admin → production mode (application default)');
            }
        }
    } catch (error) {
        console.error('Firebase Admin initialization error:', error);
        // Re-throw to make the error visible
        throw error;
    }
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminStorage = getStorage();