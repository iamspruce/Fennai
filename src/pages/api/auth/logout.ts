// pages/api/auth/logout.ts
import type { APIRoute } from 'astro';
import { clearSessionCookie, getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { adminAuth } from '@/lib/firebase/firebase-admin';

export const POST: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);

    if (sessionCookie) {
        try {
            // Verify and revoke the session
            const decodedClaims = await verifySessionCookie(sessionCookie);
            if (decodedClaims) {
                await adminAuth.revokeRefreshTokens(decodedClaims.uid);
            }
        } catch (error) {
            console.error('Error revoking session:', error);
        }
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearSessionCookie(),
        },
    });
};

export const GET: APIRoute = async ({ request, redirect }) => {
    const sessionCookie = getSessionCookie(request);

    if (sessionCookie) {
        try {
            const decodedClaims = await verifySessionCookie(sessionCookie);
            if (decodedClaims) {
                await adminAuth.revokeRefreshTokens(decodedClaims.uid);
            }
        } catch (error) {
            console.error('Error revoking session:', error);
        }
    }

    return new Response(null, {
        status: 302,
        headers: {
            'Location': '/',
            'Set-Cookie': clearSessionCookie(),
        },
    });
};