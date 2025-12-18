// src/islands/VoicesList.tsx
import { useState, useEffect } from 'react';
import VoiceCard from '@/components/character/VoiceCard';
import DubbingVideoCard from '@/components/dubbing/DubbingVideoCard';
import { getVoiceFromIndexedDB } from '@/lib/db/indexdb';
import VoicesHeader from './VoicesHeader';
import { db } from '@/lib/firebase/config';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import type { QuerySnapshot, DocumentData } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';

interface VoicesListProps {
    cloudVoices: any[];
    localOnlyIds: string[];
    mainCharacter: any;
    allCharacters: any[];
    userId: string; // User's UID for filtering dubbing jobs
}

type MediaItem = {
    id: string;
    type: 'voice' | 'dubbing';
    createdAt: Date;
    data: any;
};

export default function VoicesList({
    cloudVoices,
    localOnlyIds,
    mainCharacter,
    allCharacters,
    userId
}: VoicesListProps) {
    const [availableLocalVoices, setAvailableLocalVoices] = useState<any[]>([]);
    const [dubbingJobs, setDubbingJobs] = useState<DubbingJob[]>([]);
    const [isCheckingLocal, setIsCheckingLocal] = useState(true);
    const [isLoadingDubbing, setIsLoadingDubbing] = useState(true);

    useEffect(() => {
        const checkLocalVoices = async () => {
            if (localOnlyIds.length === 0) {
                setIsCheckingLocal(false);
                return;
            }

            try {
                // Check which local-only voices actually exist in IndexedDB
                const available = [];

                for (const voiceId of localOnlyIds) {
                    try {
                        const record = await getVoiceFromIndexedDB(voiceId);

                        if (record?.audioBlob) {
                            available.push({
                                id: record.id,
                                characterId: record.characterId,
                                text: record.text,
                                storageType: 'local-only',
                                isMultiCharacter: record.isMultiCharacter,
                                characterIds: record.characterIds,
                                dialogues: record.dialogues,
                                duration: record.duration,
                                createdAt: new Date(record.createdAt),
                            });
                        }
                    } catch (err) {
                        // Voice doesn't exist locally, skip it
                    }
                }

                setAvailableLocalVoices(available);
            } catch (err) {
                console.error('[VoicesList] Error checking local voices:', err);
            } finally {
                setIsCheckingLocal(false);
            }
        };

        checkLocalVoices();
    }, [localOnlyIds]);

    // Listen to dubbing jobs for this user in real-time
    useEffect(() => {
        const dubbingQuery = query(
            collection(db, 'dubbingJobs'),
            where('uid', '==', userId),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const unsubscribe = onSnapshot(dubbingQuery,
            (snapshot: QuerySnapshot<DocumentData>) => {
                const jobs: DubbingJob[] = [];
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    jobs.push({
                        ...data,
                        id: doc.id,
                        createdAt: data.createdAt?.toDate() || new Date(),
                        updatedAt: data.updatedAt?.toDate() || new Date(),
                    } as DubbingJob);
                });
                setDubbingJobs(jobs);
                setIsLoadingDubbing(false);
            },
            (err: Error) => {
                console.error('[VoicesList] Error listening to dubbing jobs:', err);
                setIsLoadingDubbing(false);
            }
        );

        return () => unsubscribe();
    }, [userId]);

    const handleActionDubbing = async (jobId: string, action: string) => {
        if (action === 'retry') {
            const job = dubbingJobs.find(j => j.id === jobId);
            if (!job) return;

            try {
                // Determine which step to retry based on status/error
                // For now, let's just trigger the proxy again if it was a start failure
                // or open the settings modal if it's awaiting user input
                window.dispatchEvent(new CustomEvent('open-dub-settings', {
                    detail: { jobId }
                }));
            } catch (err) {
                console.error('Failed to retry dubbing:', err);
            }
        }
    };

    // Combine voices and dubbing jobs, sorted by creation date
    const allMediaItems: MediaItem[] = [
        ...cloudVoices.map(voice => ({
            id: voice.id,
            type: 'voice' as const,
            createdAt: voice.createdAt instanceof Date ? voice.createdAt : new Date(voice.createdAt),
            data: voice
        })),
        ...availableLocalVoices.map(voice => ({
            id: voice.id,
            type: 'voice' as const,
            createdAt: voice.createdAt instanceof Date ? voice.createdAt : new Date(voice.createdAt),
            data: voice
        })),
        ...dubbingJobs.map(job => ({
            id: job.id,
            type: 'dubbing' as const,
            createdAt: job.createdAt instanceof Date ? job.createdAt : new Date(job.createdAt),
            data: job
        }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const handlePlayDubbing = (jobId: string) => {
        window.dispatchEvent(
            new CustomEvent('open-dub-review', {
                detail: { jobId }
            })
        );
    };

    const handleDeleteDubbing = async (jobId: string) => {
        try {
            // Call API to delete dubbing job
            await fetch(`/api/dubbing/${jobId}`, { method: 'DELETE' });

            // Remove from local state
            setDubbingJobs(prev => prev.filter(job => job.id !== jobId));
        } catch (err) {
            console.error('[VoicesList] Error deleting dubbing job:', err);
            alert('Failed to delete dubbed media');
        }
    };

    if (isCheckingLocal || isLoadingDubbing) {
        return (
            <div className="voices-loading">
                <div className="spinner" />
                <p>Loading your media...</p>
                <style>{`
                    .voices-loading {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: var(--space-m);
                        padding: var(--space-xl) var(--space-m);
                        color: var(--mauve-11);
                    }
                    .voices-loading .spinner {
                        width: 40px;
                        height: 40px;
                        border: 4px solid var(--mauve-6);
                        border-top: 4px solid var(--orange-9);
                        border-radius: 50%;
                        animation: spinVoices 1s linear infinite;
                    }
                    @keyframes spinVoices {
                        to { transform: rotate(360deg); }
                    }
                    .voices-loading p {
                        margin: 0;
                        font-size: 0.95rem;
                    }
                `}</style>
            </div>
        );
    }

    if (allMediaItems.length === 0) {
        return (
            <div className="no-voices">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.3, marginBottom: '16px' }}>
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                </svg>
                <p>No voices or dubbed media yet. Generate your first one below!</p>
                <style>{`
                    .no-voices {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        padding: var(--space-xl) var(--space-m);
                        color: var(--mauve-11);
                    }
                    .no-voices p {
                        margin: 0;
                        font-size: 0.95rem;
                    }
                `}</style>
            </div>
        );
    }

    return (
        <>
            <VoicesHeader
                totalVoices={cloudVoices.length + availableLocalVoices.length}
                totalDubbing={dubbingJobs.length}
            />
            <div className="voices-list">
                {allMediaItems.map((item) => (
                    item.type === 'voice' ? (
                        <VoiceCard
                            key={item.id}
                            voice={item.data}
                            mainCharacter={mainCharacter}
                            allCharacters={allCharacters}
                        />
                    ) : (
                        <DubbingVideoCard
                            key={item.id}
                            job={item.data}
                            onPlay={handlePlayDubbing}
                            onDelete={handleDeleteDubbing}
                            onAction={handleActionDubbing}
                        />
                    )
                ))}
            </div>
            <style>{`
                .voices-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: var(--space-m);
                    padding: 0 var(--space-xs);
                }
                .voices-header h2 {
                    margin: 0;
                    font-size: 1.25rem;
                    font-weight: 600;
                    color: var(--mauve-12);
                }
                .voices-breakdown {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    font-size: 0.85rem;
                    color: var(--mauve-11);
                }
                .breakdown-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .breakdown-item.cloud {
                    color: var(--blue-11);
                }
                .breakdown-item.local {
                    color: var(--mauve-11);
                }
                .breakdown-divider {
                    color: var(--mauve-8);
                }
                .voices-list {
                    display: grid;
                    gap: var(--space-m);
                }
                @media (max-width: 768px) {
                    .voices-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: var(--space-xs);
                    }
                }
            `}</style>
        </>
    );
}