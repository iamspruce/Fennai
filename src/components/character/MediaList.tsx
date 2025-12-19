// src/components/character/MediaList.tsx
import { useState, useEffect } from 'react';
import VoiceCard from '@/components/character/VoiceCard';
import DubbingVideoCard from '@/components/dubbing/DubbingVideoCard';
import { getVoiceFromIndexedDB } from '@/lib/db/indexdb';
import MediaHeader from './MediaHeader';
import { db } from '@/lib/firebase/config';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';
import ResumeJobModal from '@/islands/dub/ResumeJobModal';

interface MediaListProps {
    cloudVoices: any[];
    localOnlyIds: string[];
    mainCharacter: any;
    allCharacters: any[];
    userId: string;
}

type MediaItem = {
    id: string;
    type: 'voice' | 'dubbing';
    createdAt: Date;
    data: any;
};

export default function MediaList({
    cloudVoices,
    localOnlyIds,
    mainCharacter,
    allCharacters,
    userId
}: MediaListProps) {
    const [availableLocalVoices, setAvailableLocalVoices] = useState<any[]>([]);
    const [dubbingJobs, setDubbingJobs] = useState<DubbingJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                // 1. Load Local Voices
                const local = [];
                for (const id of localOnlyIds) {
                    const record = await getVoiceFromIndexedDB(id);
                    if (record?.audioBlob) {
                        local.push({
                            ...record,
                            storageType: 'local-only',
                            createdAt: new Date(record.createdAt),
                        });
                    }
                }
                setAvailableLocalVoices(local);

                // 2. Load Completed Dubbing Jobs (One-time fetch)
                const q = query(
                    collection(db, 'dubbingJobs'),
                    where('uid', '==', userId),
                    where('status', '==', 'completed'),
                    orderBy('createdAt', 'desc')
                );
                const snapshot = await getDocs(q);
                const jobs = snapshot.docs.map(doc => ({
                    ...doc.data(),
                    id: doc.id,
                    createdAt: doc.data().createdAt?.toDate() || new Date(),
                })) as DubbingJob[];
                setDubbingJobs(jobs);

            } catch (err) {
                console.error('[MediaList] Load error:', err);
            } finally {
                setIsLoading(false);
            }
        };

        if (userId) loadData();
    }, [userId, localOnlyIds]);

    // Check for active job to resume
    useEffect(() => {
        const checkResumeJob = async () => {
            const activeJobStr = localStorage.getItem('activeJob');
            if (!activeJobStr) return;

            try {
                const activeJob = JSON.parse(activeJobStr);

                // Verify job still exists and is not completed/failed
                const collectionName = activeJob.type === 'dubbing' ? 'dubbingJobs' : 'voiceJobs';
                const jobRef = doc(db, collectionName, activeJob.jobId);
                const jobSnap = await getDoc(jobRef);

                if (jobSnap.exists()) {
                    const status = jobSnap.data().status;
                    if (!['completed', 'failed'].includes(status)) {
                        // Found an actual active job, ask to resume
                        window.dispatchEvent(new CustomEvent('open-resume-job-modal', {
                            detail: activeJob
                        }));
                    } else {
                        // Job is done or failed, clean up
                        localStorage.removeItem('activeJob');
                    }
                } else {
                    // Job doesn't exist anymore, clean up
                    localStorage.removeItem('activeJob');
                }
            } catch (err) {
                console.error('[MediaList] Error checking resume job:', err);
            }
        };

        checkResumeJob();
    }, []);

    const allMediaItems: MediaItem[] = [
        ...cloudVoices.map(v => ({ id: v.id, type: 'voice' as const, createdAt: new Date(v.createdAt), data: v })),
        ...availableLocalVoices.map(v => ({ id: v.id, type: 'voice' as const, createdAt: v.createdAt, data: v })),
        ...dubbingJobs.map(j => ({ id: j.id, type: 'dubbing' as const, createdAt: j.createdAt, data: j }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const handlePlayDubbing = (jobId: string) => {
        window.dispatchEvent(new CustomEvent('open-dub-review', { detail: { jobId } }));
    };

    const handleDeleteDubbing = async (jobId: string) => {
        const job = dubbingJobs.find(j => j.id === jobId);
        if (!job) return;

        window.dispatchEvent(new CustomEvent('open-delete-modal', {
            detail: {
                id: jobId,
                title: 'Delete Dubbed Media',
                description: 'This will permanently remove the dubbed media.',
                itemLabel: 'Delete',
                itemText: job.fileName || 'Untitled',
                onConfirm: async () => {
                    await fetch(`/api/dubbing/${jobId}`, { method: 'DELETE' });
                    setDubbingJobs(prev => prev.filter(j => j.id !== jobId));
                }
            }
        }));
    };

    if (isLoading) {
        return (
            <div className="media-loading">
                <div className="spinner" />
                <p>Loading media...</p>
                <style>{`
                    .media-loading { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem; color: var(--mauve-11); }
                    .media-loading .spinner { width: 32px; height: 32px; border: 3px solid var(--mauve-6); border-top-color: var(--orange-9); border-radius: 50%; animation: spin 1s linear infinite; }
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    if (allMediaItems.length === 0) {
        return <div className="no-media"><p>No media yet.</p></div>;
    }

    return (
        <div className="media-container">
            <MediaHeader
                totalVoices={cloudVoices.length + availableLocalVoices.length}
                totalDubbing={dubbingJobs.length}
            />
            <div className="media-list">
                {allMediaItems.map((item) => (
                    item.type === 'voice' ? (
                        <VoiceCard key={item.id} voice={item.data} mainCharacter={mainCharacter} allCharacters={allCharacters} />
                    ) : (
                        <DubbingVideoCard key={item.id} job={item.data} onPlay={handlePlayDubbing} onDelete={handleDeleteDubbing} />
                    )
                ))}
            </div>
            <ResumeJobModal />
            <style>{`
                .media-list { display: grid; gap: var(--space-m); }
                .no-media { padding: 3rem; text-align: center; color: var(--mauve-11); }
            `}</style>
        </div>
    );
}