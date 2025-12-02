import type { APIRoute } from 'astro';
import { checkProStatus, getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { adminDb } from '@/lib/firebase/firebase-admin';

export const GET: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({
            canClone: false,
            reason: 'Not authenticated'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const decodedClaims = await verifySessionCookie(sessionCookie);

    if (!decodedClaims) {
        return new Response('Invalid session', { status: 401 });
    }

    const uid = decodedClaims.uid;

    try {
        // Check if user is pro
        const isPro = await checkProStatus(uid);

        if (isPro) {
            return new Response(JSON.stringify({
                canClone: true,
                isPro: true,
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Check credits using Admin SDK
        const userDocRef = adminDb.collection('users').doc(uid);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return new Response(JSON.stringify({
                canClone: false,
                reason: 'User not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const credits = userDoc.data()?.credits || 0;

        if (credits < 1) {
            return new Response(JSON.stringify({
                canClone: false,
                reason: 'Insufficient credits. Please buy more credits or upgrade to Pro.'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({
            canClone: true,
            isPro: false,
            credits,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Check credits error:', error);
        return new Response(JSON.stringify({
            canClone: false,
            reason: 'Failed to check credits'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};