import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
    getFirestore,
    initializeFirestore,
    connectFirestoreEmulator,
    type Firestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from 'firebase/firestore';
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

// Force fresh initialization in development by clearing IndexedDB
if (typeof window !== 'undefined' && USE_EMULATORS) {
    // Clear Firestore cache in development to ensure clean state
    indexedDB.deleteDatabase('firestore/fennai/[DEFAULT]');
    indexedDB.deleteDatabase('firebaseLocalStorageDb');
    console.log('🧹 Cleared Firestore cache for fresh dev initialization');
}

// Initialize Firebase only if not already initialized
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    console.log('🔥 Firebase app initialized');
} else {
    app = getApps()[0];
    console.log('♻️ Using existing Firebase app');
}

// Initialize Auth
auth = getAuth(app);

// Initialize Firestore with resilient settings
// Use initializeFirestore instead of getFirestore for custom config
try {
    // CRITICAL: Force long polling by using a custom settings object
    const settings: any = {
        experimentalAutoDetectLongPolling: true,
    };

    // Add cache settings only in browser (not SSR)
    if (typeof window !== 'undefined' && !USE_EMULATORS) {
        try {
            settings.localCache = persistentLocalCache({
                tabManager: persistentMultipleTabManager()
            });
        } catch (cacheError) {
            console.warn('⚠️ Could not enable persistent cache:', cacheError);
        }
    }

    db = initializeFirestore(app, settings);

    console.log('✅ Firestore initialized with FORCED long polling');
    console.log('📋 Settings applied:', {
        forceLongPolling: true,
        autoDetect: true,
        hasCache: !!settings.localCache
    });
} catch (error: any) {
    // If already initialized, get the existing instance
    if (error.message?.includes('already been called') || error.message?.includes('already')) {
        db = getFirestore(app);
        console.error('❌ Firestore was already initialized - long polling NOT active!');
        console.error('💡 You MUST clear browser cache and hard refresh (Cmd+Shift+R)');
        console.error('💡 Or close all tabs of this site and reopen');
    } else {
        console.error('❌ Failed to initialize Firestore:', error);
        throw error;
    }
}

// Initialize Storage
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
        console.log('🔧 Connected to Firebase Emulators');
    } catch (error: any) {
        // Ignore "already connected" errors
        if (!error.message?.includes('already')) {
            console.error('Emulator connection error:', error);
        }
    }
}

// Optional: Monitor Firestore connection state (only in browser)
if (typeof window !== 'undefined') {
    // Cleanup Firebase before page unload to prevent CORS errors
    const cleanup = async () => {
        try {
            // Delete all Firebase apps before unload
            const apps = getApps();
            await Promise.all(apps.map(app => deleteApp(app)));
            console.log('🧹 Firebase apps cleaned up before unload');
        } catch (error) {
            console.warn('Failed to cleanup Firebase:', error);
        }
    };

    window.addEventListener('beforeunload', cleanup);

    // Also monitor sync state
    import('firebase/firestore').then(({ onSnapshotsInSync }) => {
        onSnapshotsInSync(db, () => {
            console.log('🔄 Firestore synced');
        });
    }).catch(() => {
        // Silently ignore if this feature isn't available
    });
}

export { app, auth, db, storage };