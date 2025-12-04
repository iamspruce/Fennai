import { auth } from './config';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    type User as FirebaseUser,
} from 'firebase/auth';

export class AuthService {
    private static provider = new GoogleAuthProvider();

    // Sign in with email and password - returns the user object
    static async signInWithEmail(email: string, password: string): Promise<any> {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
        };
    }

    // Sign up with email and password - returns the user object
    static async signUpWithEmail(email: string, password: string): Promise<any> {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
        };
    }

    // Sign in with Google - returns the user object
    static async signInWithGoogle(): Promise<any> {
        const result = await signInWithPopup(auth, this.provider);
        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
        };
    }

    // Sign out
    static async signOut(): Promise<void> {
        await firebaseSignOut(auth);
    }

    static async sendPasswordResetEmail(email: string): Promise<void> {
        await sendPasswordResetEmail(auth, email);
    }

    // Get current user
    static getCurrentUser(): FirebaseUser | null {
        return auth.currentUser;
    }

    // Listen to auth state changes
    static onAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void {
        return onAuthStateChanged(auth, callback);
    }

    // Get ID token
    static async getIdToken(): Promise<string | null> {
        const user = auth.currentUser;
        if (!user) return null;
        return await user.getIdToken();
    }
}