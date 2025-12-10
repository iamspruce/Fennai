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

// Only initialize if not already initialized
if (!getApps().length) {
    try {
        if (isEmulator) {
            // Emulator mode
            process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
            process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

            initializeApp({
                projectId: projectId || 'demo-project',
                storageBucket: storageBucket || 'fennai.firebasestorage.app',
            });
            console.log('Firebase Admin → using emulators');
        } else {
            // Production mode
            // Use service account credentials if explicitly provided, otherwise use application default

            if (privateKey && clientEmail && projectId) {
                // Explicit service account credentials are provided
                console.log('Firebase Admin → initializing with service account credentials');
                initializeApp({
                    credential: cert({
                        projectId,
                        clientEmail,
                        privateKey,
                    }),
                    projectId,
                    storageBucket
                });
                console.log('Firebase Admin → production mode (service account)');
            } else {
                // Use application default credentials (automatic in Cloud Functions/Cloud Run)
                console.log('Firebase Admin → initializing with application default credentials');
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
        console.error('Environment check:', {
            isEmulator,
            hasProjectId: !!projectId,
            hasStorageBucket: !!storageBucket,
            hasPrivateKey: !!privateKey,
            hasClientEmail: !!clientEmail,
            nodeEnv: process.env.NODE_ENV,
        });
        // Re-throw to make the error visible
        throw error;
    }
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminStorage = getStorage();