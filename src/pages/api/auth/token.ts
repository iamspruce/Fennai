import type { APIRoute } from 'astro';
import { getSessionCookie } from '@/lib/firebase/auth';

export const GET: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ sessionCookie }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};