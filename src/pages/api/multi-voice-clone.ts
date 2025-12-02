import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

// Mock multi-character voice cloning
export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();

        // Extract all character data
        const characters: Array<{
            id: string;
            text: string;
            audio: File;
        }> = [];

        let index = 0;
        while (formData.has(`character_${index}_id`)) {
            characters.push({
                id: formData.get(`character_${index}_id`) as string,
                text: formData.get(`character_${index}_text`) as string,
                audio: formData.get(`character_${index}_audio`) as File,
            });
            index++;
        }

        if (characters.length === 0) {
            return new Response(JSON.stringify({ error: 'No characters provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        console.log(`Processing multi-character voice cloning for ${characters.length} characters`);

        // Simulate longer processing time for multiple characters (3-7 seconds)
        const delay = 3000 + Math.random() * 4000;
        await new Promise(resolve => setTimeout(resolve, delay));

        // For mock purposes, we'll concatenate the sample audio multiple times
        // In a real implementation, you'd generate separate audio for each character
        const audioPath = path.join(process.cwd(), 'public', 'sample-output.wav');
        const audioBuffer = await fs.readFile(audioPath);

        // Calculate total duration for all character dialogues
        const totalDuration = characters.reduce((sum, char) => {
            return sum + calculateDuration(char.text);
        }, 0);

        // Add small pauses between characters (0.5 seconds each)
        const pauseDuration = (characters.length - 1) * 0.5;
        const finalDuration = totalDuration + pauseDuration;

        console.log(`Mock multi-character generation complete. Total duration: ${finalDuration}s`);

        return new Response(audioBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'audio/wav',
                'X-Duration': finalDuration.toString(),
                'X-Character-Count': characters.length.toString(),
            },
        });
    } catch (error) {
        console.error('Mock multi-voice clone error:', error);
        return new Response(JSON.stringify({ error: 'Multi-character voice cloning failed' }), {
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