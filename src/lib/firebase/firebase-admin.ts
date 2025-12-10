// lib/firebase/firebase-admin.ts
import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import {
    FieldValue,
    getFirestore,
    type Firestore,
} from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";

export const getEnv = (key: string, defaultValue?: string) => {
    if (
        typeof import.meta !== "undefined" &&
        import.meta.env?.[key] !== undefined
    ) {
        return import.meta.env[key];
    }
    return process.env[key] ?? defaultValue;
};


const isDev = process.env.NODE_ENV === "development";
const isEmulator = process.env.PUBLIC_USE_FIREBASE_EMULATORS === "true" && isDev;

// Singleton pattern - only initialize once
let app: App;
let adminDb: Firestore;
let adminAuth: Auth;
let adminStorage: Storage;

function initializeFirebase() {
    // Return existing instance if already initialized
    if (getApps().length > 0) {
        const existingApp = getApps()[0];
        return {
            app: existingApp,
            adminDb: getFirestore(existingApp),
            adminAuth: getAuth(existingApp),
            adminStorage: getStorage(existingApp),
        };
    }

    // Configure emulator settings
    if (isEmulator) {
        process.env.FIRESTORE_EMULATOR_HOST =
            process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8081";
        process.env.FIREBASE_AUTH_EMULATOR_HOST =
            process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
        process.env.FIREBASE_STORAGE_EMULATOR_HOST =
            process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";
        process.env.GOOGLE_APPLICATION_CREDENTIALS = ""; // Not needed for emulators

        const storageBucket = getEnv("PUBLIC_FIREBASE_STORAGE_BUCKET");

        app = initializeApp({
            projectId: getEnv("APP_FIREBASE_PROJECT_ID", "demo-project"),
            storageBucket: storageBucket || undefined,
        });
    } else if (isDev) {
        const projectId = getEnv("APP_FIREBASE_PROJECT_ID");
        const clientEmail = getEnv("APP_FIREBASE_CLIENT_EMAIL");
        const privateKey = getEnv("APP_FIREBASE_PRIVATE_KEY");
        const storageBucket = getEnv("PUBLIC_FIREBASE_STORAGE_BUCKET");

        if (!projectId || !clientEmail || !privateKey) {
            throw new Error(
                "Missing required Firebase Admin credentials for dev (non-emulator) mode. Check environment variables."
            );
        }

        app = initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey: privateKey.replace(/\\n/g, "\n"),
            }),
            storageBucket,
        });
    } else {
        const storageBucket = getEnv("PUBLIC_FIREBASE_STORAGE_BUCKET");

        app = initializeApp({
            storageBucket: storageBucket || undefined,
        });
    }

    // Initialize services
    adminDb = getFirestore(app);
    adminAuth = getAuth(app);
    adminStorage = getStorage(app);

    // Configure Firestore settings for better performance
    if (!isEmulator) {
        adminDb.settings({
            ignoreUndefinedProperties: true,
            preferRest: false,
        });
    }

    return { app, adminDb, adminAuth, adminStorage };
}

// Initialize and export (No changes here)
try {
    const firebase = initializeFirebase();
    app = firebase.app;
    adminDb = firebase.adminDb;
    adminAuth = firebase.adminAuth;
    adminStorage = firebase.adminStorage;
} catch (error) {
    console.error("❌ Failed to initialize Firebase Admin SDK:", error);
    throw error;
}

export { app, adminDb, adminAuth, adminStorage, FieldValue };

