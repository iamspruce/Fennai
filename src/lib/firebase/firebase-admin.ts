// lib/firebase/firebase-admin.ts

import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const getEnv = (key: string) => import.meta.env?.[key] ?? process.env[key];

const isEmulator = getEnv('PUBLIC_USE_FIREBASE_EMULATORS') === 'true';
const projectId = getEnv('APP_FIREBASE_PROJECT_ID');
const storageBucket = getEnv('APP_FIREBASE_STORAGE_BUCKET');

if (!getApps().length) {
    if (isEmulator) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

        initializeApp({
            projectId: projectId || 'demo-project',
        });
        console.log('Firebase Admin → using emulators');
    } else {
        console.info({ projectId, storageBucket }, applicationDefault())
        initializeApp({
            credential: applicationDefault(),
            projectId,
            storageBucket
        });
        console.log('Firebase Admin → production mode');
    }
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
export const adminStorage = getStorage();