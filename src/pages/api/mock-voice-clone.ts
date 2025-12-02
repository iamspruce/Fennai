import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

// This endpoint mocks the voice cloning API response
// It returns a sample WAV file from the public directory

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const text = formData.get('text') as string;
        const characterId = formData.get('character_id') as string;

        if (!text) {
            return new Response(JSON.stringify({ error: 'Text is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Simulate API processing time (2-5 seconds)
        const delay = 2000 + Math.random() * 3000;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Read the sample audio file from the public directory
        const audioPath = path.join(process.cwd(), 'public', 'sample-output.wav');
        const audioBuffer = await fs.readFile(audioPath);

        // Calculate a mock duration based on text length
        const duration = calculateDuration(text);

        return new Response(audioBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'audio/wav',
                'X-Duration': duration.toString(),
            },
        });
    } catch (error) {
        console.error('Mock voice clone error:', error);
        return new Response(JSON.stringify({ error: 'Voice cloning failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

// Calculate estimated duration based on text length
// Roughly 150 words per minute average speaking rate
function calculateDuration(text: string): number {
    const charsPerWord = 5;
    const wordsPerMinute = 150;
    const words = text.length / charsPerWord;
    const minutes = words / wordsPerMinute;
    const seconds = minutes * 60;

    // Minimum 1 second, maximum based on text
    return Math.max(1, Math.min(seconds, 30));
}