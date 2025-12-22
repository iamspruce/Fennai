import { useState, useEffect, useMemo } from 'react';
import VoiceCard from '@/components/character/VoiceCard';
import DubbingVideoCard from '@/components/dubbing/DubbingVideoCard';
import { getVoiceFromIndexedDB, getAllDubbingMedia, deleteDubbingMedia } from '@/lib/db/indexdb';
import MediaHeader from './MediaHeader';
import type { DubbingJob } from '@/types/dubbing';
import ResumeJobModal from '@/islands/dub/ResumeJobModal';

interface MediaListProps {
    cloudVoices: any[];
    localOnlyIds: string[];
    cloudDubbingJobs: DubbingJob[];
    localOnlyDubbingIds: string[];
    mainCharacter: any;
    allCharacters: any[];
    userId: string;
    isPro?: boolean;
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
    cloudDubbingJobs,
    localOnlyDubbingIds,
    mainCharacter,
    allCharacters,
    userId,
    isPro
}: MediaListProps) {
    const [availableLocalVoices, setAvailableLocalVoices] = useState<any[]>([]);
    const [localDubbingJobs, setLocalDubbingJobs] = useState<any[]>([]);
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

                // 2. Load Local Dubbing Jobs for sync filtering and offline persistence
                const localDubRecords = await getAllDubbingMedia();
                setLocalDubbingJobs(localDubRecords);

                setIsLoading(false);
            } catch (err) {
                console.error('[MediaList] Load error:', err);
                setIsLoading(false);
            }
        };

        const handleLocalUpdate = async () => {
            const localDubRecords = await getAllDubbingMedia();
            setLocalDubbingJobs(localDubRecords);
        };

        if (userId) {
            loadData();
        }

        window.addEventListener('local-media-updated', handleLocalUpdate);
        window.addEventListener('media-updated', handleLocalUpdate); // Standardized event

        return () => {
            window.removeEventListener('local-media-updated', handleLocalUpdate);
            window.removeEventListener('media-updated', handleLocalUpdate);
        };
    }, [userId, localOnlyIds]);

    // Check for active job to resume (using cloudDubbingJobs prop for status check)
    useEffect(() => {
        const checkResumeJob = async () => {
            const activeJobStr = localStorage.getItem('activeJob');
            if (!activeJobStr) return;

            try {
                const activeJob = JSON.parse(activeJobStr);

                // If it's a dubbing job, we can check its status in our passed props
                if (activeJob.type === 'dubbing') {
                    const jobData = cloudDubbingJobs.find(j => j.id === activeJob.jobId);

                    if (jobData) {
                        const status = jobData.status;
                        if (status !== 'completed' && status !== 'failed') {
                            window.dispatchEvent(new CustomEvent('open-resume-job-modal', {
                                detail: {
                                    ...activeJob,
                                    status: status,
                                    fileName: jobData.fileName || activeJob.fileName
                                }
                            }));
                        } else {
                            localStorage.removeItem('activeJob');
                        }
                    } else {
                        // Job not in our latest list, might be quite old or from another character
                        // We could keep it in localStorage just in case, or verify via API
                    }
                }
            } catch (err) {
                console.error('[MediaList] Error checking resume job:', err);
            }
        };

        checkResumeJob();
    }, [cloudDubbingJobs]);

    // Filter and merge dubbing jobs
    const combinedDubbingJobs = useMemo(() => {
        const cloudJobs = cloudDubbingJobs.filter(job => {
            // Only show completed or failed jobs in the list
            if (!['completed', 'failed'].includes(job.status)) return false;
            if (!mainCharacter) return true;

            // Must belong to this character
            if (job.characterId !== mainCharacter.id) return false;

            // Sync logic:
            // - If sync is enabled (saveAcrossBrowsers = true), show all cloud jobs for this character
            // - If sync is disabled, only show jobs that also exist locally on this device
            const isSyncEnabled = mainCharacter.saveAcrossBrowsers === true;
            if (isSyncEnabled) return true;

            // Sync is off - only show if we have a local copy
            const isLocal = localDubbingJobs.some(lj => lj.id === job.id);
            return isLocal;
        }).map(job => ({ ...job, storageType: 'cloud' }));

        // Find local jobs items by ID list
        const localOnlyJobs = localDubbingJobs
            .filter(lj => {
                if (mainCharacter && lj.characterId !== mainCharacter.id) return false;

                // Must be in our localOnlyDubbingIds list OR not in cloudDubbingJobs
                return localOnlyDubbingIds.includes(lj.id) || !cloudDubbingJobs.some(cj => cj.id === lj.id);
            })
            .map(lj => {
                const date = new Date(lj.createdAt);
                const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                let status = lj.status;
                const hasResult = lj.resultVideoData || lj.resultAudioData;
                if (hasResult) status = 'completed';
                else if (!status) status = 'failed';

                return {
                    id: lj.id,
                    uid: userId,
                    status: status,
                    mediaType: lj.mediaType,
                    fileName: lj.fileName || `Local ${lj.mediaType === 'video' ? 'Video' : 'Audio'} (${dateStr})`,
                    createdAt: date,
                    characterId: lj.characterId,
                    originalMediaUrl: '',
                    finalMediaUrl: '',
                    storageType: 'local-only',
                } as any;
            });

        return [...cloudJobs, ...localOnlyJobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }, [cloudDubbingJobs, localDubbingJobs, localOnlyDubbingIds, mainCharacter, userId]);

    const allMediaItems: MediaItem[] = [
        ...cloudVoices.map(v => ({ id: v.id, type: 'voice' as const, createdAt: new Date(v.createdAt), data: v })),
        ...availableLocalVoices.map(v => ({ id: v.id, type: 'voice' as const, createdAt: v.createdAt, data: v })),
        ...combinedDubbingJobs.map(j => ({ id: j.id, type: 'dubbing' as const, createdAt: j.createdAt, data: j }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const handlePlayDubbing = (jobId: string) => {
        const job = combinedDubbingJobs.find(j => j.id === jobId);
        if (!job) return;

        if (job.status === 'completed' || job.status === 'failed') {
            // Both completed and failed jobs go to review
            window.dispatchEvent(new CustomEvent('open-dub-review', {
                detail: {
                    jobId,
                    mainCharacter: mainCharacter,
                    fileName: job.fileName
                }
            }));
        } else {
            // All other states (processing, transcribing, etc.) handled by ResumeJobModal
            // Ensure fileName is explicitly passed to avoid "Untitled"
            window.dispatchEvent(new CustomEvent('open-resume-job-modal', {
                detail: {
                    jobId,
                    type: 'dubbing',
                    fileName: job.fileName || 'Dubbed Video',
                    status: job.status
                }
            }));
        }
    };

    const handleDeleteDubbing = async (jobId: string) => {
        const job = combinedDubbingJobs.find(j => j.id === jobId);
        if (!job) return;

        window.dispatchEvent(new CustomEvent('open-delete-modal', {
            detail: {
                id: jobId,
                title: 'Delete Dubbed Media',
                description: 'This will permanently remove the dubbed media.',
                itemLabel: 'Delete',
                itemText: job.fileName || 'Untitled',
                onConfirm: async () => {
                    try {
                        // 1. Attempt Cloud Delete
                        await fetch(`/api/dubbing/${jobId}`, { method: 'DELETE' });
                    } catch (e) {
                        console.log('[MediaList] Cloud delete skipped/failed (likely already gone)');
                    }

                    // 2. Always Local Delete
                    await deleteDubbingMedia(jobId);

                    // 3. Reload to update all views (following the pattern for voices)
                    window.location.reload();
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
        // Use isPro from props and saveAcrossBrowsers from character
        const userIsPro = isPro || false;
        const saveAcrossBrowsers = mainCharacter?.saveAcrossBrowsers === true;

        return (
            <div className="no-media">
                <div className="empty-state-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        <circle cx="9" cy="16" r="1" fill="currentColor" />
                        <circle cx="15" cy="16" r="1" fill="currentColor" />
                    </svg>
                </div>
                <h3>No media found on this device</h3>
                {!userIsPro ? (
                    <p className="empty-state-description">
                        Your media is stored locally on each device. If you created voices or dubs on another device (like your Mac or iPhone), they won't appear here.
                        <br /><br />
                        <strong>Want to access your media everywhere?</strong> Upgrade to <a href="/pricing" className="pro-link">Fennai Pro</a> to save your voices and dubs across all your devices!
                    </p>
                ) : !saveAcrossBrowsers ? (
                    <p className="empty-state-description">
                        Your media is stored locally on each device. If you created voices or dubs on another device, they won't appear here.
                        <br /><br />
                        <strong>You're a Pro user!</strong> Enable "Save across browsers" when creating or editing this character to sync media across all your devices.
                    </p>
                ) : (
                    <p className="empty-state-description">
                        No voices or dubbed videos yet for this character. Create some media to get started!
                    </p>
                )}
                <style>{`
                    .no-media { 
                        padding: 3rem 2rem; 
                        text-align: center; 
                        color: var(--mauve-11);
                        max-width: 600px;
                        margin: 2rem auto;
                    }
                    .empty-state-icon {
                        color: var(--mauve-8);
                        margin-bottom: 1.5rem;
                        display: flex;
                        justify-content: center;
                    }
                    .no-media h3 {
                        font-size: var(--step-0);
                        font-weight: 600;
                        color: var(--mauve-12);
                        margin-bottom: 1rem;
                    }
                    .empty-state-description {
                        font-size: var(--step--1);
                        line-height: 1.6;
                        color: var(--mauve-11);
                    }
                    .pro-link {
                        color: var(--orange-10);
                        font-weight: 600;
                        text-decoration: underline;
                        transition: color 0.2s;
                    }
                    .pro-link:hover {
                        color: var(--orange-11);
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className="media-container">
            <MediaHeader
                totalVoices={cloudVoices.length + availableLocalVoices.length + (combinedDubbingJobs.filter(j => (j as any).mediaType === 'audio').length)}
                totalDubbing={combinedDubbingJobs.filter(j => (j as any).mediaType === 'video').length}
            />
            <div className="media-list">
                {allMediaItems.map((item) => (
                    <div
                        key={item.id}
                        className="media-item"
                        data-type={item.type}
                        data-is-multi={item.type === 'voice' ? item.data.isMultiCharacter : undefined}
                    >
                        {item.type === 'voice' ? (
                            <VoiceCard voice={item.data} mainCharacter={mainCharacter} allCharacters={allCharacters} />
                        ) : (
                            <DubbingVideoCard
                                job={item.data}
                                mainCharacter={mainCharacter}
                                onPlay={handlePlayDubbing}
                                onDelete={handleDeleteDubbing}
                            />
                        )}
                    </div>
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