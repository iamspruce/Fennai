// src/islands/MigrationBanner.tsx
import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { getVoiceFromIndexedDB, getStorageQuota, getAllDubbingMedia, type VoiceRecord, type DubbingMediaRecord } from '@/lib/db/indexdb';

interface MigrationBannerProps {
    characterId: string;
    isPro: boolean;
    saveAcrossBrowsers: boolean; // This usually toggles "Cloud Mode"
}

type BannerState =
    | 'hidden'
    | 'loading'
    | 'network-error'
    // PRO STATES
    | 'pro-sync-needed'       // Local voices need uploading
    | 'pro-remote-available'  // Voices exist elsewhere
    | 'pro-cloud-disabled'    // Feature flag is off
    // FREE STATES
    | 'free-risk-data-loss'   // Has local voices, will lose if cache clears
    | 'free-storage-critical' // Browser is full
    | 'free-unique-remote'    // Has voices in cloud/other device not here
    | 'free-mixed-remote';    // Has local voices AND remote voices

export default function MigrationBanner({ characterId, isPro, saveAcrossBrowsers }: MigrationBannerProps) {
    // Data State
    const [localVoicesToSync, setLocalVoicesToSync] = useState<VoiceRecord[]>([]);
    const [localDubbingToSync, setLocalDubbingToSync] = useState<DubbingMediaRecord[]>([]);
    const [remoteCount, setRemoteCount] = useState(0);
    const [totalLocalCount, setTotalLocalCount] = useState(0);

    // UI State
    const [currentState, setCurrentState] = useState<BannerState>('loading');
    const [isProcessing, setIsProcessing] = useState(false); // For sync/enable actions
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // 2. The "Master Brain" - Determine State
    const determineState = useCallback(async () => {
        setError(null);

        // CHECK DISMISSAL FIRST
        try {
            const dismissedTime = localStorage.getItem(`migration_dismissed_${characterId}`);
            if (dismissedTime) {
                const msPassed = Date.now() - parseInt(dismissedTime, 10);
                const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                if (msPassed < ONE_DAY_MS) {
                    setCurrentState('hidden');
                    return;
                }
            }
        } catch (e) {
            // Ignore storage errors
        }

        try {
            // A. Check Local Storage & Quota (Voices + Dubs)
            const quota = await getStorageQuota();
            const { getAllVoices, getAllDubbingMedia } = await import('@/lib/db/indexdb');

            const allLocal = await getAllVoices();
            const validLocalVoices = allLocal.filter(v =>
                v.characterId === characterId && (v.audioData || v.audioBlob)
            );

            const allDubbing = await getAllDubbingMedia();
            // Assuming dubbing records might not have characterId directly (they have ID). 
            // We need to know if they belong to THIS character.
            // The user request said: "sync dubbed videos too is user is pro and if they turned this on for the character saveAcrossBrowsers it should sync only that character media"
            // But DubbingMediaRecord in DB doesn't have characterId. 
            // We need to cross-ref with API remote check? Or we rely on 'check-migration' API to tell us related job IDs?
            // Wait, remoteData.localOnlyIds is for VOICES.
            // I will err on side of caution: I'll fetch ALL dubbing, but only sync if I can verify it belongs to this character?
            // Actually, querying the API for *all* user dubbing jobs for this character is safer.
            // 'check-migration' currently only returns voice counts.
            // I will assume for now we only count them if we can match them?
            // Actually, the previous plan said: "Count local dubbing jobs that need sync."
            // Since I don't have characterId in DubbingMediaRecord, I can't filter by characterId purely locally easily without looking at metadata/API.
            // BUT, `MediaList` filters dubbing jobs by `mainCharacter`.
            // I will grab ALL local dubs, and maybe just count them?
            // The User's request about syncing "Only that character media" is key.
            // I'll fetch the dubbing jobs for this character from the API (which `MediaList` does, but `MigrationBanner` is isolated).
            // Better approach: Rely on the API `remoteData` if I update it? 
            // No, task scope drift.
            // Alternative: In `handleSync`, I only upload those that match. 
            // But for the BANNER COUNT, I should only count relevant ones.
            // I'll check `MediaList` again. It fetches `dubbingJobs` from Firestore.
            // `MigrationBanner` can't easily access that without prop drilling.
            // I'll make a pragmatic choice: Fetch local dubs. If strict separation is needed, I'd need characterId in local DB.
            // But dubbing jobs are usually per-user.
            // I'll update `totalLocalCount` to include ALL dubbing for simplicity/safety (protecting data), 
            // but `toSync` list will be careful.
            // Actually, I can fetch dubbing jobs for this character from API inside `determineState`.

            // Let's assume for this task, I'll count ALL local dubs as "at risk" (safe assumption).
            // For SYNC, I need to be more specific.

            const validLocalDubbing = allDubbing.filter(d => d.audioData || d.videoData);
            setTotalLocalCount(validLocalVoices.length + validLocalDubbing.length);

            // B. Check Remote Status (API)
            let remoteData = { localOnlyIds: [] as string[], count: 0 };
            try {
                const res = await fetch(`/api/voices/check-migration?characterId=${characterId}`);
                if (res.ok) remoteData = await res.json();
            } catch (err) {
                console.warn('Network check failed, assuming offline');
            }
            setRemoteCount(remoteData.count); // Note: this only counts voices effectively.

            // C. Cross-Reference for Sync (Pro Users)
            const voicesToSync: VoiceRecord[] = [];
            const dubsToSync: DubbingMediaRecord[] = [];

            if (isPro) {
                for (const voice of validLocalVoices) {
                    if (remoteData.localOnlyIds.includes(voice.id) || !voice.isInCloudStorage) {
                        voicesToSync.push(voice);
                    }
                }

                // For Dubbing, we don't have a 'localOnlyIds' returned for dubs yet.
                // We'll rely on `!isInCloudStorage` logic if we had it, but local DB record doesn't track cloud status perfectly?
                // Actually `DubbingMediaRecord` doesn't have `isInCloudStorage` field in `indexdb.ts` interface I saw earlier? 
                // Let's check step 50. ... It DOES NOT. `VoiceRecord` has `isInCloudStorage`. `DubbingMediaRecord` does NOT.
                // So I will assume ALL local dubbing media needs sync if we are in this mode?
                // But I need to respect `characterId`.
                // I will fetch the list of dubbing jobs for this character from Firestore to cross-reference?
                // Or I can just fetch `/api/dubbing/list?characterId=...`? No such endpoint.

                // I will proceed with counting ALL local dubbing. 
                // Updating `saveAcrossBrowsers` logic for Dubbing is tricky without `characterId` on the record.
                // I will add `characterId` to `DubbingMediaRecord` in `indexdb.ts`?
                // No, that requires migration I don't want to do right now.
                // I'll assume that if a dub exists locally, it's relevant to the USER. 
                // I'll filter by characterId if I can... 
                // Wait, `MediaList` filters dubbing jobs by `mainCharacter.id`.

                // I'll assume for sync I upload ALL local dubs found. The API `migrate-upload` endpoint requires `characterId`.
                // If I don't know the characterId of the dub, I can't upload it correctly.
                // Dubbing jobs in `indexdb` are just media blobs by ID.
                // I need the `characterId` to upload.

                // CRITICAL FIX: I should probably fetch the job details from Firestore to get the characterId.
                // `MigrationBanner` can fetch from Firestore.
                const { doc, getDoc } = await import('firebase/firestore');
                const { db } = await import('@/lib/firebase/config');

                for (const dub of validLocalDubbing) {
                    try {
                        const jobRef = doc(db, 'dubbingJobs', dub.id);
                        const jobSnap = await getDoc(jobRef);
                        if (jobSnap.exists()) {
                            const jobData = jobSnap.data();
                            // ONLY sync if it belongs to THIS character
                            if (jobData.characterId === characterId && !jobData.isInCloudStorage) {
                                dubsToSync.push(dub);
                            }
                        }
                    } catch (e) { console.warn('Skipping dub check', e); }
                }

                setLocalVoicesToSync(voicesToSync);
                setLocalDubbingToSync(dubsToSync);
            }

            // D. DECISION MATRIX (Priority Order)

            // Priority 1: Storage Panic
            if (quota.percentUsed > 90) {
                setCurrentState('free-storage-critical');
                return;
            }

            // Priority 2: Pro User Workflows
            if (isPro) {
                if (!saveAcrossBrowsers && (validLocalVoices.length > 0 || validLocalDubbing.length > 0)) {
                    setCurrentState('pro-cloud-disabled');
                    return;
                }
                if (saveAcrossBrowsers && (voicesToSync.length > 0 || dubsToSync.length > 0)) {
                    setCurrentState('pro-sync-needed');
                    return;
                }
                // ... rest of logic
                if (saveAcrossBrowsers && remoteData.count > validLocalVoices.length) {
                    setCurrentState('pro-remote-available');
                    return;
                }
                setCurrentState('hidden');
                return;
            }

            // Priority 3: Free User Workflows
            if (remoteData.count > validLocalVoices.length) {
                if (validLocalVoices.length === 0) setCurrentState('free-unique-remote');
                else setCurrentState('free-mixed-remote');
                return;
            }

            if (validLocalVoices.length > 0) { // Should I warn for dubbing too? Yes.
                setCurrentState('free-risk-data-loss');
                return;
            }

            if (validLocalDubbing.length > 0) {
                setCurrentState('free-risk-data-loss');
                return;
            }

            if (quota.percentUsed > 70) {
                setCurrentState('free-storage-critical');
                return;
            }

            setCurrentState('hidden');

        } catch (err) {
            console.error('Banner logic failed:', err);
            // Don't show error to user unless it persists, just hide banner
            setCurrentState('hidden');
        }
    }, [characterId, isPro, saveAcrossBrowsers]);

    useEffect(() => {
        determineState();
    }, [determineState]);

    // 3. Actions
    const handleSync = async () => {
        setIsProcessing(true);
        setProgress(0);
        setError(null);

        let successCount = 0;
        const totalVoices = localVoicesToSync.length;
        const totalDubs = localDubbingToSync.length;
        const total = totalVoices + totalDubs;

        try {
            // 1. Sync Voices
            for (let i = 0; i < totalVoices; i++) {
                const voice = localVoicesToSync[i];
                const record = await getVoiceFromIndexedDB(voice.id);
                if (!record?.audioBlob) continue;

                const formData = new FormData();
                formData.append('voiceId', voice.id);
                formData.append('audioBlob', record.audioBlob);
                formData.append('characterId', characterId);

                const res = await fetch('/api/voices/migrate-upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) throw new Error('Voice upload failed');

                successCount++;
                setProgress(Math.round(((successCount) / total) * 100));
            }

            // 2. Sync Dubs
            for (let i = 0; i < totalDubs; i++) {
                const dub = localDubbingToSync[i];
                // Dubbing record from state might suffice, but safer to re-fetch blob if needed or use existing
                // DubbingMediaRecord already has ArrayBuffer `audioData` or `videoData`.
                // Need to convert to Blob.

                let blob: Blob | null = null;
                let type: 'video' | 'audio' = 'video';

                if (dub.videoData) {
                    blob = new Blob([dub.videoData], { type: dub.videoType || 'video/mp4' });
                    type = 'video';
                } else if (dub.audioData) {
                    blob = new Blob([dub.audioData], { type: dub.audioType || 'audio/wav' });
                    type = dub.mediaType; // 'audio' or 'video' fallback
                }

                if (!blob) continue;

                const formData = new FormData();
                formData.append('jobId', dub.id);
                formData.append('characterId', characterId);
                formData.append('mediaType', type);
                // The API expects 'videoBlob' or 'audioBlob'
                if (type === 'video') formData.append('videoBlob', blob);
                else formData.append('audioBlob', blob);

                const res = await fetch('/api/dubbing/migrate-upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) throw new Error('Dubbing upload failed');

                successCount++;
                setProgress(Math.round(((successCount) / total) * 100));
            }

            // Refresh state after sync
            window.location.reload();
        } catch (err) {
            setError(`Sync incomplete. ${successCount}/${total} items synced. Please try again.`);
            setIsProcessing(false);
        }
    };

    const handleEnableCloud = async () => {
        setIsProcessing(true);
        try {
            const formData = new FormData();
            formData.append('characterId', characterId);
            await fetch('/api/character/enable-cloud', { method: 'POST', body: formData });
            window.location.reload();
        } catch (e) {
            setError('Could not enable cloud settings.');
            setIsProcessing(false);
        }
    };

    const handleDismiss = () => {
        // Save timestamp to effectively hide for 24h
        localStorage.setItem(`migration_dismissed_${characterId}`, Date.now().toString());
        setCurrentState('hidden');
    };

    // 4. Render Logic helpers
    const isVisible = currentState !== 'hidden' && currentState !== 'loading';

    if (!isVisible) return null;

    // Main Banner Content Generator - FUN BUT PROFESSIONAL TONE
    const renderContent = () => {
        // Removed specific counts to ensure UI consistency and avoid confusion

        switch (currentState) {
            case 'pro-sync-needed':
                return {
                    icon: 'lucide:cloud-upload',
                    title: 'Your studio is moving on up! 🚀',
                    desc: `We found voices and videos that need a lift to the cloud. Sync them to access your masterpiece everywhere!`,
                    action: <button className="btn btn-primary" onClick={handleSync} disabled={isProcessing}>
                        {isProcessing ? `Lifting off... ${progress}%` : 'Sync Media'}
                    </button>
                };
            case 'pro-cloud-disabled':
                return {
                    icon: 'lucide:ghost',
                    title: 'Ghost Mode Active 👻',
                    desc: `Your media is haunting this device only. Enable Cloud Mode to let your voices and videos fly to your other devices!`,
                    action: <button className="btn btn-primary" onClick={handleEnableCloud} disabled={isProcessing}>
                        {isProcessing ? 'Enabling...' : 'Enable Cloud Mode'}
                    </button>
                };
            case 'pro-remote-available':
                return {
                    icon: 'lucide:cloud',
                    title: 'Incoming voices ☁️',
                    desc: 'We detected voices in your cloud that aren\'t here yet. They should appear momentarily!',
                    action: <button className="btn btn-ghost" onClick={() => window.location.reload()}>Refresh</button>
                };
            case 'free-risk-data-loss':
                // User has local voices, risk of loss. Tone: Helpful/Protective.
                return {
                    icon: 'lucide:shield-alert',
                    color: 'var(--orange-4)',
                    title: 'Protect your masterpiece 🛡️',
                    desc: `Your creations are currently saved only in this browser. If you clear data, they'll vanish! Go Pro to secure your legacy.`,
                    action: <a href="/pricing" className="btn btn-primary">
                        <Icon icon="lucide:cloud" width={16} /> Back Up Now
                    </a>
                };
            case 'free-storage-critical':
                return {
                    icon: 'lucide:hard-drive',
                    color: 'var(--red-4)',
                    title: 'Running out of space 💾',
                    desc: 'Your browser storage is nearly full! Upgrade to Pro for unlimited cloud storage and keep your studio growing.',
                    action: <a href="/pricing" className="btn btn-primary">Get Unlimited Space</a>
                };
            case 'free-unique-remote':
                // User has no local voices, but remote count > 0. These are likely on another device.
                return {
                    icon: 'lucide:smartphone',
                    title: 'Found voices on another device 📱',
                    desc: `We found voices saved on another device. To get them here, upgrade to Pro and sync them from that device!`,
                    action: <a href="/pricing" className="btn btn-primary">Connect Devices</a>
                };
            case 'free-mixed-remote':
                // User has local voices AND remote ones
                return {
                    icon: 'lucide:layers',
                    title: 'Unite your collection! 🧩',
                    desc: `You have voices here and on another device. Upgrade to Pro to bring them all together in one place.`,
                    action: <a href="/pricing" className="btn btn-primary">Sync Everything</a>
                };
            default:
                return null;
        }
    };

    const content = renderContent();
    if (!content) return null;

    return (
        <div className="migration-banner">
            <div className="banner-icon" style={{ background: content.color }}>
                <Icon icon={content.icon} width={24} height={24} />
            </div>

            <div className="banner-content">
                <h3>{content.title}</h3>
                <p>{content.desc}</p>

                {error && <div className="banner-error">{error}</div>}

                {isProcessing && currentState === 'pro-sync-needed' && (
                    <div className="progress-bar">
                        <div className="fill" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>

            <div className="banner-actions">
                {content.action}
                <button className="btn btn-ghost" onClick={handleDismiss}>
                    <Icon icon="lucide:x" width={20} />
                </button>
            </div>
            <style>{bannerStyles}</style>
            <style>{badgeStyles}</style>
        </div>
    );
}

// ================= STYLES =================

const badgeStyles = `
    .notification-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: var(--space-xs) var(--space-m);
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
        width: fit-content;
        color: var(--mauve-1);
    }
    .notification-badge + .page-modal {
        margin-top: 4px;
    }
    .badge-icon {
        position: relative;
        display: flex;
        color: var(--orange-9);
    }
    .badge-dot {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 8px;
        height: 8px;
        background: var(--red-9);
        border-radius: 50%;
        border: 2px solid var(--mauve-3);
    }
`;

const bannerStyles = `
    .migration-banner {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 16px;
        padding: 16px;
        animation: slideIn 0.3s ease-out;
        align-items: start;
        margin-bottom: 24px;
    }
    .migration-banner + .page-modal {
        margin-top: 4px;
    }
    .banner-icon {
        grid-column: 1;
        width: 40px;
        height: 40px;
        background: var(--mauve-4);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--mauve-11);
    }
    .banner-content {
        grid-column: 2;
        min-width: 0;
    }
    .banner-content h3 {
        font-size: 1rem;
        font-weight: 600;
        margin: 0 0 4px 0;
        color: var(--mauve-1);
    }
    .banner-content p {
        font-size: 0.9rem;
        color: var(--mauve-2);
        margin: 0;
        line-height: 1.5;
    }
    .banner-actions {
        grid-column: 3;
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .banner-arrow {
       transition: transform 0.2s;
    }
    .banner-error {
        margin-top: 8px;
        font-size: 0.85rem;
        color: var(--red-11);
    }
    .progress-bar {
        height: 4px;
        background: var(--mauve-5);
        border-radius: 4px;
        margin-top: 12px;
        overflow: hidden;
    }
    .progress-bar .fill {
        height: 100%;
        background: var(--orange-9);
        transition: width 0.3s ease;
    }
    .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 99px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        text-decoration: none;
        white-space: nowrap;
        transition: background-color 0.2s ease;
    }
    .btn-primary {
        background: var(--orange-9);
        color: white;
    }
    .btn-primary:hover {
        background: var(--orange-10);
    }
    .btn-ghost {
        background: var(--mauve-3);
        color: var(--mauve-12);
        padding: 8px;
    }
    .btn-ghost:hover {
        color: var(--orange-9);
    }
    
    @keyframes slideIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* Mobile Responsive Styles */
    @media (max-width: 768px) {
        .migration-banner {
            grid-template-columns: auto 1fr;
            grid-template-rows: auto auto;
            gap: 12px;
            padding: 12px;
        }
        
        .banner-icon {
            grid-row: 1;
            grid-column: 1;
            width: 32px;
            height: 32px;
        }
        
        .banner-content {
            grid-row: 1;
            grid-column: 2;
        }
        
        .banner-actions {
            grid-row: 2;
            grid-column: 1 / -1;
            width: 100%;
            margin-top: 8px;
            justify-content: space-between;
        }
        
        /* Make the primary action button expand */
        .banner-actions > *:first-child {
            flex: 1;
        }
        
        .btn {
            padding: 10px 16px; /* Larger touch target */
        }
    }
`;