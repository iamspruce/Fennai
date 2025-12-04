// lib/firebase/firebase-admin.ts
import { initializeApp, cert, getApps, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;
let adminStorage: Storage;

// Helper to safely access env vars in Vite/SvelteKit/Astro
const getEnv = (key: string) => (import.meta.env ? import.meta.env[key] : process.env[key]);

const USE_EMULATORS = getEnv('PUBLIC_USE_FIREBASE_EMULATORS') === 'true';
const PROJECT_ID = getEnv('APP_FIREBASE_PROJECT_ID') || getEnv('PUBLIC_FIREBASE_PROJECT_ID');
const STORAGE_BUCKET = getEnv('PUBLIC_FIREBASE_STORAGE_BUCKET') || `${PROJECT_ID}.appspot.com`;
const SERVICE_ACCOUNT_RAW = getEnv('APP_FIREBASE_PRIVATE_KEY');

function initializeFirebaseAdmin() {
    if (getApps().length > 0) {
        adminApp = getApps()[0];
    } else {
        if (USE_EMULATORS) {
            // --- EMULATOR CONFIG ---
            console.log('🔥 Initializing Firebase Admin for EMULATORS');

            // Set emulator environment variables BEFORE initialization
            process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
            process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
            process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

            adminApp = initializeApp({
                projectId: PROJECT_ID || 'demo-project',
                storageBucket: STORAGE_BUCKET,
            });

            console.log('✅ Firebase Admin connected to emulators');
        } else {
            // --- PRODUCTION CONFIG ---
            console.log('🔥 Initializing Firebase Admin for PRODUCTION');

            if (!SERVICE_ACCOUNT_RAW) {
                throw new Error('APP_FIREBASE_PRIVATE_KEY is missing.');
            }

            let serviceAccount: ServiceAccount;

            try {
                // 1. Try parsing as a full JSON object (common in local .env files)
                serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);
            } catch (e) {
                // 2. If JSON parse fails, assume it might be just the PEM string or malformed JSON
                // Many hosting providers escape newlines as \\n. We must fix this.
                const privateKey = SERVICE_ACCOUNT_RAW.replace(/\\n/g, '\n');

                const clientEmail = getEnv('APP_FIREBASE_CLIENT_EMAIL');

                if (!clientEmail || !privateKey.includes('BEGIN PRIVATE KEY')) {
                    throw new Error('Failed to parse Service Account. Ensure APP_FIREBASE_PRIVATE_KEY is a valid JSON object OR the raw private key string with APP_FIREBASE_CLIENT_EMAIL set.');
                }

                serviceAccount = {
                    projectId: PROJECT_ID,
                    clientEmail: clientEmail,
                    privateKey: privateKey,
                };
            }

            adminApp = initializeApp({
                credential: cert(serviceAccount),
                projectId: serviceAccount.projectId || PROJECT_ID,
                storageBucket: STORAGE_BUCKET,
            });

            console.log('✅ Firebase Admin initialized');
        }
    }

    adminAuth = getAuth(adminApp);
    adminDb = getFirestore(adminApp);
    adminStorage = getStorage(adminApp);

    return { adminApp, adminAuth, adminDb, adminStorage };
}

// Initialize on import
const {
    adminApp: app,
    adminAuth: auth,
    adminDb: db,
    adminStorage: storage
} = initializeFirebaseAdmin();

export {
    app as adminApp,
    auth as adminAuth,
    db as adminDb,
    storage as adminStorage
};