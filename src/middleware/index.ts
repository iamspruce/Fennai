// src/middleware/index.ts
import { defineMiddleware } from 'astro:middleware';
import { getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';

// Protected routes that require authentication
const protectedRoutes = ['/profile', '/create', '/character', '/dashboard'];

export const onRequest = defineMiddleware(async ({ request, redirect, url, locals }, next) => {
    const pathname = url.pathname;

    // Check if route is protected
    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));

    if (isProtectedRoute) {

        const sessionCookie = getSessionCookie(request);

        if (!sessionCookie) {
            return redirect('/?error=auth-required');
        }

        try {
            // Verify session cookie
            const decodedClaims = await verifySessionCookie(sessionCookie);

            if (!decodedClaims) {
                return redirect('/?error=session-expired');
            }

            // Store user info in locals for use in pages
            locals.user = decodedClaims;
        } catch (error) {
            console.error('❌ Session verification error:', error);
            return redirect('/?error=session-invalid');
        }
    }

    return next();
});