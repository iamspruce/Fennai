// authService.ts
import { auth } from './config';
import {
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    sendSignInLinkToEmail, // Import this
    isSignInWithEmailLink, // Import this
    signInWithEmailLink,   // Import this
    onAuthStateChanged,
    type User as FirebaseUser,
} from 'firebase/auth';

export class AuthService {
    private static provider = new GoogleAuthProvider();

    // 1. Send the Magic Link
    static async sendMagicLink(email: string): Promise<void> {
        const actionCodeSettings = {
            // The URL to redirect to after clicking the link.
            // MUST be whitelisted in Firebase Console -> Authentication -> Settings -> Authorized Domains
            url: window.location.origin + '/finish-login',
            handleCodeInApp: true,
        };

        await sendSignInLinkToEmail(auth, email, actionCodeSettings);
        // Save email locally to verify against the link later (Firebase requirement)
        window.localStorage.setItem('emailForSignIn', email);
    }

    // 2. Complete the Sign In (Call this on your /finish-login page)
    static async completeMagicLinkLogin(): Promise<any> {
        if (isSignInWithEmailLink(auth, window.location.href)) {
            let email = window.localStorage.getItem('emailForSignIn');

            // If email isn't in storage (user opened link on different device), prompt for it
            if (!email) {
                email = window.prompt('Please provide your email for confirmation');
            }

            if (!email) throw new Error("Email is required to complete sign in");

            const result = await signInWithEmailLink(auth, email, window.location.href);
            window.localStorage.removeItem('emailForSignIn');

            return {
                uid: result.user.uid,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoURL,
            };
        }
        return null;
    }

    // Keep existing Google Auth
    static async signInWithGoogle(): Promise<any> {
        const result = await signInWithPopup(auth, this.provider);
        return {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
        };
    }

    static async signOut(): Promise<void> {
        await firebaseSignOut(auth);
    }

    static getCurrentUser(): FirebaseUser | null {
        return auth.currentUser;
    }

    static onAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void {
        return onAuthStateChanged(auth, callback);
    }

    static async getIdToken(): Promise<string | null> {
        const user = auth.currentUser;
        if (!user) return null;
        return await user.getIdToken();
    }
}