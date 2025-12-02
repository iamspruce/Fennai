import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
    authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo-project.firebaseapp.com',
    projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || 'demo-project',
    storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo-project.appspot.com',
    messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '123456789',
    appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || '1:123456789:web:abcdef',
};

const USE_EMULATORS = import.meta.env.PUBLIC_USE_FIREBASE_EMULATORS === 'true';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;

// Track if emulators are already connected
let emulatorsConnected = false;

// Initialize Firebase only if not already initialized
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApps()[0];
}

// Initialize services
auth = getAuth(app);
db = getFirestore(app);
storage = getStorage(app);

// Connect to emulators if in development
if (USE_EMULATORS && !emulatorsConnected) {
    try {
        // Use localhost for both browser and server
        const authHost = typeof window !== 'undefined'
            ? 'http://127.0.0.1:9099'
            : 'http://127.0.0.1:9099';

        connectAuthEmulator(auth, authHost, { disableWarnings: true });
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
        connectStorageEmulator(storage, '127.0.0.1', 9199);

        emulatorsConnected = true;
        console.log('🔥 Connected to Firebase Emulators');
    } catch (error: any) {
        // Ignore "already connected" errors
        if (!error.message?.includes('already')) {
            console.error('Emulator connection error:', error);
        }
    }
}

export { app, auth, db, storage };