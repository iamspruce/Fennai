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
        console.log('🔒 Protected route accessed:', pathname);

        const sessionCookie = getSessionCookie(request);
        console.log('🍪 Session cookie present:', !!sessionCookie);

        if (!sessionCookie) {
            console.log('❌ No session cookie - redirecting to home');
            return redirect('/?error=auth-required');
        }

        try {
            // Verify session cookie
            const decodedClaims = await verifySessionCookie(sessionCookie);

            if (!decodedClaims) {
                console.log('❌ Invalid session cookie - redirecting to home');
                return redirect('/?error=session-expired');
            }

            console.log('✅ Session verified for user:', decodedClaims.uid);

            // Store user info in locals for use in pages
            locals.user = decodedClaims;
        } catch (error) {
            console.error('❌ Session verification error:', error);
            return redirect('/?error=session-invalid');
        }
    }

    return next();
});