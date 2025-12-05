// lib/firebase/firebase-admin.ts

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const getEnv = (key: string) => import.meta.env?.[key] ?? process.env[key];

const isEmulator = getEnv('PUBLIC_USE_FIREBASE_EMULATORS') === 'true';
const projectId = getEnv('APP_FIREBASE_PROJECT_ID');
const storageBucket = getEnv('APP_FIREBASE_STORAGE_BUCKET');
const privateKey = getEnv('APP_FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
const clientEmail = getEnv('APP_FIREBASE_CLIENT_EMAIL');

if (!getApps().length) {
    if (isEmulator) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

        initializeApp({
            projectId: projectId || 'demo-project',
        });
        console.log('Firebase Admin → using emulators');
    } else {
        // PRODUCTION — fail fast and loud if credentials are missing
        if (!privateKey || !clientEmail || !projectId) {
            throw new Error(
                `Missing Firebase Admin credentials.\n` +
                `APP_FIREBASE_PROJECT_ID=${projectId}\n` +
                `APP_FIREBASE_CLIENT_EMAIL=${clientEmail ? 'set' : 'MISSING'}\n` +
                `APP_FIREBASE_PRIVATE_KEY=${privateKey ? 'set' : 'MISSING'}\n` +
                `Check your .env file and Astro server environment.`
            );
        }

        initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey,
            } as any),
            projectId,
            storageBucket
        });
        console.log('Firebase Admin → production mode');
    }
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminStorage = getStorage();