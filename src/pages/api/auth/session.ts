// pages/api/auth/session.ts
import type { APIRoute } from 'astro';
import { adminAuth } from '@/lib/firebase/firebase-admin';
import { createSessionCookieHeader, createOrUpdateUserDocument } from '@/lib/firebase/auth';

const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        console.log('📥 Session request received:', { hasIdToken: !!body.idToken });

        const { idToken } = body;

        if (!idToken) {
            console.error('❌ No ID token provided');
            return new Response(JSON.stringify({ error: 'ID token required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log('🔍 Verifying ID token...');

        // Verify the ID token first
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        console.log('✅ Token verified for user:', decodedToken.uid);

        console.log('🍪 Creating session cookie...');

        // Create session cookie with the ID token
        const sessionCookie = await adminAuth.createSessionCookie(idToken, {
            expiresIn: SESSION_COOKIE_MAX_AGE * 1000, // Convert to milliseconds
        });

        console.log('✅ Session cookie created');

        console.log('💾 Creating/updating user document...');

        // Create or update user document in Firestore
        await createOrUpdateUserDocument(decodedToken.uid, {
            email: decodedToken.email,
            displayName: decodedToken.name,
            photoURL: decodedToken.picture,
        });

        console.log('✅ User document updated');

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': createSessionCookieHeader(sessionCookie),
            },
        });
    } catch (error: any) {
        console.error('❌ Session creation error:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            stack: error.stack,
        });

        return new Response(JSON.stringify({
            error: 'Failed to create session',
            details: error.message,
            code: error.code,
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};