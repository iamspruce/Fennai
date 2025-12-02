// lib/firebase/firebase-admin.ts
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;
let adminStorage: Storage;

const USE_EMULATORS = import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const PROJECT_ID = import.meta.env.APP_FIREBASE_PROJECT_ID || 'demo-project';
const STORAGE_BUCKET = import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;

function initializeFirebaseAdmin() {
    if (getApps().length > 0) {
        adminApp = getApps()[0];
    } else {
        if (USE_EMULATORS) {
            // For emulators, use minimal config
            console.log('🔥 Initializing Firebase Admin for EMULATORS');

            adminApp = initializeApp({
                projectId: PROJECT_ID,
                storageBucket: STORAGE_BUCKET,
            });

            // Set emulator environment variables BEFORE getting services
            process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
            process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
            process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

            console.log('✅ Firebase Admin connected to emulators');
            console.log('   - Firestore: 127.0.0.1:8080');
            console.log('   - Auth: 127.0.0.1:9099');
            console.log('   - Storage: 127.0.0.1:9199');
        } else {
            // For production, use service account
            console.log('🔥 Initializing Firebase Admin for PRODUCTION');

            const serviceAccount = import.meta.env.APP_FIREBASE_PRIVATE_KEY;

            if (!serviceAccount) {
                throw new Error('APP_FIREBASE_PRIVATE_KEY environment variable is required for production');
            }

            try {
                const credentials = JSON.parse(serviceAccount);

                adminApp = initializeApp({
                    credential: cert(credentials),
                    projectId: credentials.project_id,
                    storageBucket: credentials.storage_bucket || `${credentials.project_id}.appspot.com`,
                });

                console.log('✅ Firebase Admin initialized with service account');
                console.log(`   - Project: ${credentials.project_id}`);
                console.log(`   - Storage Bucket: ${credentials.storage_bucket || `${credentials.project_id}.appspot.com`}`);
            } catch (error) {
                console.error('Failed to parse service account:', error);
                throw new Error('Invalid APP_FIREBASE_PRIVATE_KEY format');
            }
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