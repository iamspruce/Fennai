// src/pages/api/voices/library.ts
import type { APIRoute } from 'astro';
import { adminDb } from '@/lib/firebase/firebase-admin';

export const GET: APIRoute = async ({ request }) => {
    try {
        const url = new URL(request.url);
        const language = url.searchParams.get('language');
        const gender = url.searchParams.get('gender');
        const isPro = url.searchParams.get('isPro');

        let query = adminDb.collection('voiceLibrary')
            .orderBy('createdAt', 'desc');

        // Apply filters if provided
        if (language) {
            query = query.where('languageCode', '==', language);
        }
        if (gender) {
            query = query.where('gender', '==', gender);
        }
        if (isPro !== null) {
            query = query.where('isPro', '==', isPro === 'true');
        }

        const snapshot = await query.get();

        const voices = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                description: data.description,
                language: data.language,
                languageCode: data.languageCode,
                accent: data.accent,
                gender: data.gender,
                age: data.age,
                emotion: data.emotion,
                isPro: data.isPro || false,
                audioUrl: data.audioUrl,
                audioStoragePath: data.audioStoragePath,
                duration: data.duration || 0,
                createdAt: data.createdAt?.toDate() || new Date(),
                tags: data.tags || [],
            };
        });

        return new Response(JSON.stringify({ voices }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Voice library fetch error:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch voice library' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};