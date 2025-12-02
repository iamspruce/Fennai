import type { APIRoute } from 'astro';
import { clearSessionCookie, getSessionCookie, verifySessionCookie } from '@/lib/firebase/auth';
import { db, storage } from '@/lib/firebase/config';
import {
    doc,
    deleteDoc,
    collection,
    query,
    where,
    getDocs
} from 'firebase/firestore';
import { ref, deleteObject, listAll } from 'firebase/storage';

export const POST: APIRoute = async ({ request }) => {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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
        // Delete all user's characters
        const charactersQuery = query(
            collection(db, 'characters'),
            where('userId', '==', uid)
        );
        const charactersSnapshot = await getDocs(charactersQuery);

        for (const characterDoc of charactersSnapshot.docs) {
            await deleteDoc(characterDoc.ref);
        }

        // Delete all user's voices
        const voicesQuery = query(
            collection(db, 'voices'),
            where('userId', '==', uid)
        );
        const voicesSnapshot = await getDocs(voicesQuery);

        for (const voiceDoc of voicesSnapshot.docs) {
            await deleteDoc(voiceDoc.ref);
        }

        // Delete all user's files from Storage
        try {
            const userStorageRef = ref(storage, `users/${uid}`);
            const fileList = await listAll(userStorageRef);

            for (const fileRef of fileList.items) {
                await deleteObject(fileRef);
            }

            // Delete subdirectories
            for (const folderRef of fileList.prefixes) {
                const subFileList = await listAll(folderRef);
                for (const fileRef of subFileList.items) {
                    await deleteObject(fileRef);
                }
            }
        } catch (storageError) {
            console.error('Error deleting storage files:', storageError);
            // Continue even if storage deletion fails
        }

        // Delete user document
        await deleteDoc(doc(db, 'users', uid));

        // Note: To delete the Firebase Auth user, you'd need Firebase Admin SDK
        // For now, we'll just clear the session
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': clearSessionCookie(),
            },
        });
    } catch (error) {
        console.error('Delete account error:', error);
        return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};