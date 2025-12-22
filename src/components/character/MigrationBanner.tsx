// src/components/character/MigrationBanner.tsx
import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { getVoiceFromIndexedDB, getStorageQuota, getAllDubbingMedia, type VoiceRecord, type DubbingMediaRecord } from '@/lib/db/indexdb';

interface MigrationBannerProps {
    characterId: string;
    isPro: boolean;
    saveAcrossBrowsers: boolean;
}

type BannerState =
    | 'hidden'
    | 'loading'
    | 'network-error'
    // PRO STATES
    | 'pro-sync-needed'        // Local voices/dubs need uploading
    | 'pro-sync-in-progress'   // Currently syncing (NEW)
    | 'pro-remote-available'   // Voices/dubs exist in cloud but not locally
    | 'pro-cloud-disabled'     // Has local media but cloud feature is off
    | 'pro-partial-sync'       // Some media synced, some failed (NEW)
    | 'pro-sync-complete'      // Just finished syncing! (NEW - disappears after 3s)
    // FREE STATES
    | 'free-risk-data-loss'    // Has local media, will lose if cache clears
    | 'free-storage-critical'  // Browser is almost full
    | 'free-unique-remote'     // Has media in cloud/other device, not here
    | 'free-mixed-remote'      // Has local voices AND remote voices
    | 'free-first-time';       // No media yet, first time user (NEW)

interface RemoteData {
    localOnlyIds: string[];
    count: number;
    cloudVoiceCount: number;
    localOnlyDubIds: string[];
    localOnlyDubCount: number;
    cloudDubCount: number;
    totalVoicesInCloud: number;
    totalDubsInCloud: number;
}

export default function MigrationBanner({ characterId, isPro, saveAcrossBrowsers }: MigrationBannerProps) {
    // Data State
    const [localVoicesToSync, setLocalVoicesToSync] = useState<VoiceRecord[]>([]);
    const [localDubbingToSync, setLocalDubbingToSync] = useState<DubbingMediaRecord[]>([]);
    const [remoteData, setRemoteData] = useState<RemoteData | null>(null);
    const [totalLocalCount, setTotalLocalCount] = useState(0);

    // UI State
    const [currentState, setCurrentState] = useState<BannerState>('loading');
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [syncedCount, setSyncedCount] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // Fun messages for syncing progress
    const getSyncMessage = (progress: number, syncedCount: number, type: 'voice' | 'dub' | 'mixed') => {
        if (progress < 20) return "🚀 Preparing for liftoff...";
        if (progress < 40) return "☁️ Beaming to the cloud...";
        if (progress < 60) return "✨ Sprinkling some magic dust...";
        if (progress < 80) return "🎬 Almost there, director!";
        if (progress < 99) return "🎉 Final touches...";
        return "🎊 Boom! All done!";
    };

    // Determine State
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
            // A. Check Local Storage & Quota
            const quota = await getStorageQuota();
            const { getAllVoices, getAllDubbingMedia } = await import('@/lib/db/indexdb');

            const allLocal = await getAllVoices();
            const validLocalVoices = allLocal.filter(v =>
                v.characterId === characterId && (v.audioData || v.audioBlob)
            );

            const allDubbing = await getAllDubbingMedia();
            const validLocalDubbing = allDubbing.filter(d =>
                d.characterId === characterId && (d.audioData || d.videoData || d.resultAudioData || d.resultVideoData)
            );

            setTotalLocalCount(validLocalVoices.length + validLocalDubbing.length);

            // B. Check Remote Status (Enhanced API)
            let fetchedRemoteData: RemoteData = {
                localOnlyIds: [],
                count: 0,
                cloudVoiceCount: 0,
                localOnlyDubIds: [],
                localOnlyDubCount: 0,
                cloudDubCount: 0,
                totalVoicesInCloud: 0,
                totalDubsInCloud: 0
            };

            try {
                const res = await fetch(`/api/voices/check-migration?characterId=${characterId}`);
                if (res.ok) {
                    fetchedRemoteData = await res.json();
                }
            } catch (err) {
                console.warn('Network check failed, assuming offline');
                setCurrentState('network-error');
                return;
            }

            setRemoteData(fetchedRemoteData);

            // C. Cross-Reference for Sync (Pro Users)
            const voicesToSync: VoiceRecord[] = [];
            const dubsToSync: DubbingMediaRecord[] = [];

            if (isPro && saveAcrossBrowsers) {
                // Find voices that need syncing (local but not in cloud)
                for (const voice of validLocalVoices) {
                    if (fetchedRemoteData.localOnlyIds.includes(voice.id) || !voice.isInCloudStorage) {
                        voicesToSync.push(voice);
                    }
                }

                // Find dubs that need syncing
                for (const dub of validLocalDubbing) {
                    if (fetchedRemoteData.localOnlyDubIds.includes(dub.id)) {
                        dubsToSync.push(dub);
                    }
                }

                setLocalVoicesToSync(voicesToSync);
                setLocalDubbingToSync(dubsToSync);
            }

            // D. DECISION MATRIX (Priority Order)

            // Priority 0: Storage Panic (applies to everyone)
            if (quota.percentUsed > 90) {
                setCurrentState('free-storage-critical');
                return;
            }

            // Priority 1: Pro User Workflows
            if (isPro) {
                // Cloud is disabled but has local media
                if (!saveAcrossBrowsers && (validLocalVoices.length > 0 || validLocalDubbing.length > 0)) {
                    setCurrentState('pro-cloud-disabled');
                    return;
                }

                // Has media to sync
                if (saveAcrossBrowsers && (voicesToSync.length > 0 || dubsToSync.length > 0)) {
                    setCurrentState('pro-sync-needed');
                    return;
                }

                // Remote has more than local (media available to download)
                const totalRemote = fetchedRemoteData.totalVoicesInCloud + fetchedRemoteData.totalDubsInCloud;
                const totalLocal = validLocalVoices.length + validLocalDubbing.length;
                if (saveAcrossBrowsers && totalRemote > totalLocal) {
                    setCurrentState('pro-remote-available');
                    return;
                }

                setCurrentState('hidden');
                return;
            }

            // Priority 2: Free User Workflows
            const totalRemoteMedia = fetchedRemoteData.cloudVoiceCount + fetchedRemoteData.cloudDubCount;
            const totalLocalMedia = validLocalVoices.length + validLocalDubbing.length;

            // Has more remote than local (media on other devices)
            if (totalRemoteMedia > totalLocalMedia) {
                if (totalLocalMedia === 0) {
                    setCurrentState('free-unique-remote');
                } else {
                    setCurrentState('free-mixed-remote');
                }
                return;
            }

            // Has local media at risk
            if (totalLocalMedia > 0) {
                setCurrentState('free-risk-data-loss');
                return;
            }

            // Storage warning (lower threshold for free users)
            if (quota.percentUsed > 70) {
                setCurrentState('free-storage-critical');
                return;
            }

            setCurrentState('hidden');

        } catch (err) {
            console.error('Banner logic failed:', err);
            setCurrentState('hidden');
        }
    }, [characterId, isPro, saveAcrossBrowsers]);

    useEffect(() => {
        determineState();
    }, [determineState]);

    // Sync Action
    const handleSync = async () => {
        setIsProcessing(true);
        setCurrentState('pro-sync-in-progress');
        setProgress(0);
        setSyncedCount(0);
        setFailedCount(0);
        setError(null);

        let successCount = 0;
        let failures = 0;
        const totalVoices = localVoicesToSync.length;
        const totalDubs = localDubbingToSync.length;
        const total = totalVoices + totalDubs;

        try {
            // 1. Sync Voices
            for (let i = 0; i < totalVoices; i++) {
                const voice = localVoicesToSync[i];
                try {
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

                    if (res.ok) {
                        successCount++;
                        setSyncedCount(successCount);
                    } else {
                        failures++;
                        setFailedCount(failures);
                    }
                } catch (e) {
                    failures++;
                    setFailedCount(failures);
                }
                setProgress(Math.round(((successCount + failures) / total) * 100));
            }

            // 2. Sync Dubs
            for (let i = 0; i < totalDubs; i++) {
                const dub = localDubbingToSync[i];
                try {
                    let blob: Blob | null = null;
                    let type: 'video' | 'audio' = 'video';

                    if (dub.resultVideoData) {
                        blob = new Blob([dub.resultVideoData], { type: dub.resultVideoType || 'video/mp4' });
                        type = 'video';
                    } else if (dub.resultAudioData) {
                        blob = new Blob([dub.resultAudioData], { type: dub.resultAudioType || 'audio/wav' });
                        type = 'audio';
                    } else if (dub.videoData) {
                        blob = new Blob([dub.videoData], { type: dub.videoType || 'video/mp4' });
                        type = 'video';
                    } else if (dub.audioData) {
                        blob = new Blob([dub.audioData], { type: dub.audioType || 'audio/wav' });
                        type = 'audio';
                    }

                    if (!blob) {
                        failures++;
                        setFailedCount(failures);
                        continue;
                    }

                    const formData = new FormData();
                    formData.append('jobId', dub.id);
                    formData.append('characterId', characterId);
                    formData.append('mediaType', type);
                    if (type === 'video') formData.append('videoBlob', blob);
                    else formData.append('audioBlob', blob);

                    const res = await fetch('/api/dubbing/migrate-upload', {
                        method: 'POST',
                        body: formData,
                    });

                    if (res.ok) {
                        successCount++;
                        setSyncedCount(successCount);
                    } else {
                        failures++;
                        setFailedCount(failures);
                    }
                } catch (e) {
                    failures++;
                    setFailedCount(failures);
                }
                setProgress(Math.round(((successCount + failures) / total) * 100));
            }

            // Final state determination
            if (failures > 0 && successCount > 0) {
                setCurrentState('pro-partial-sync');
                setError(`Synced ${successCount} of ${total} items. ${failures} couldn't make it. 😅`);
            } else if (failures > 0) {
                setError(`Oops! ${failures} items couldn't sync. Maybe try again later? 🤔`);
                setCurrentState('pro-sync-needed');
            } else {
                setCurrentState('pro-sync-complete');
                // Auto-hide success message after 3 seconds
                setTimeout(() => {
                    setCurrentState('hidden');
                }, 3000);
            }

            setIsProcessing(false);

        } catch (err) {
            setError(`Something went sideways! 😬 ${successCount}/${total} synced. Try again?`);
            setCurrentState('pro-sync-needed');
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
            setError('Couldn\'t enable cloud mode. The clouds are being shy today! ☁️');
            setIsProcessing(false);
        }
    };

    const handleDismiss = () => {
        localStorage.setItem(`migration_dismissed_${characterId}`, Date.now().toString());
        setCurrentState('hidden');
    };

    const handleRetry = () => {
        setError(null);
        setFailedCount(0);
        setSyncedCount(0);
        setProgress(0);
        handleSync();
    };

    // Render Logic
    const isVisible = currentState !== 'hidden' && currentState !== 'loading';
    if (!isVisible) return null;

    // Content Generator - FUN & FRIENDLY TONE 🎉
    const renderContent = () => {
        const totalToSync = localVoicesToSync.length + localDubbingToSync.length;
        const voiceWord = localVoicesToSync.length === 1 ? 'voice' : 'voices';
        const dubWord = localDubbingToSync.length === 1 ? 'dub' : 'dubs';

        switch (currentState) {
            case 'pro-sync-needed':
                return {
                    icon: 'lucide:cloud-upload',
                    color: 'var(--blue-9)',
                    title: '🎒 Pack your bags, media!',
                    desc: totalToSync > 1
                        ? `You've got ${localVoicesToSync.length > 0 ? `${localVoicesToSync.length} ${voiceWord}` : ''}${localVoicesToSync.length > 0 && localDubbingToSync.length > 0 ? ' and ' : ''}${localDubbingToSync.length > 0 ? `${localDubbingToSync.length} ${dubWord}` : ''} ready for their cloud vacation! Sync them now so they're always with you.`
                        : `One lonely piece of media is waiting to join the cloud party!`,
                    action: <button className="btn btn-primary" onClick={handleSync} disabled={isProcessing}>
                        <Icon icon="lucide:upload-cloud" width={16} />
                        Send to Cloud ☁️
                    </button>
                };

            case 'pro-sync-in-progress':
                return {
                    icon: 'lucide:loader-2',
                    color: 'var(--blue-9)',
                    title: getSyncMessage(progress, syncedCount, 'mixed'),
                    desc: `Syncing... ${progress}% (${syncedCount} of ${localVoicesToSync.length + localDubbingToSync.length} done)`,
                    action: <div className="sync-progress-wrapper">
                        <div className="progress-bar">
                            <div className="fill animated" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                };

            case 'pro-sync-complete':
                return {
                    icon: 'lucide:check-circle-2',
                    color: 'var(--green-9)',
                    title: '🎊 Cloud party complete!',
                    desc: `All your media made it to the cloud! They'll be waiting for you on any device.`,
                    action: <button className="btn btn-ghost" onClick={handleDismiss}>
                        <Icon icon="lucide:check" width={16} /> Sweet!
                    </button>
                };

            case 'pro-partial-sync':
                return {
                    icon: 'lucide:cloud-off',
                    color: 'var(--yellow-9)',
                    title: '🤷 Partial success!',
                    desc: `${syncedCount} items made it, but ${failedCount} got shy. Try syncing those again?`,
                    action: <button className="btn btn-primary" onClick={handleRetry}>
                        <Icon icon="lucide:refresh-cw" width={16} /> Try Again
                    </button>
                };

            case 'pro-cloud-disabled':
                return {
                    icon: 'lucide:ghost',
                    color: 'var(--purple-9)',
                    title: '👻 Ghost Mode Active',
                    desc: `Your ${totalLocalCount} creation${totalLocalCount === 1 ? '' : 's'} ${totalLocalCount === 1 ? 'is' : 'are'} haunting this device only. Enable cloud mode to let them travel between your devices!`,
                    action: <button className="btn btn-primary" onClick={handleEnableCloud} disabled={isProcessing}>
                        <Icon icon="lucide:cloud" width={16} />
                        {isProcessing ? 'Summoning clouds...' : 'Enable Cloud Mode'}
                    </button>
                };

            case 'pro-remote-available':
                const remoteCount = remoteData ? remoteData.totalVoicesInCloud + remoteData.totalDubsInCloud : 0;
                return {
                    icon: 'lucide:cloud-download',
                    color: 'var(--teal-9)',
                    title: '📦 Incoming delivery!',
                    desc: `We found ${remoteCount} item${remoteCount === 1 ? '' : 's'} chilling in your cloud that ${remoteCount === 1 ? "hasn't" : "haven't"} arrived here yet. They should pop up any moment!`,
                    action: <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                        <Icon icon="lucide:refresh-cw" width={16} /> Refresh
                    </button>
                };

            case 'free-risk-data-loss':
                return {
                    icon: 'lucide:shield-alert',
                    color: 'var(--orange-9)',
                    title: '🛡️ Your creations need armor!',
                    desc: `You've got ${totalLocalCount} creation${totalLocalCount === 1 ? '' : 's'} (voices & dubs) living dangerously on this device only. If you clear browser data, poof! They're gone. Go Pro to keep them safe forever.`,
                    action: <a href="/pricing" className="btn btn-primary">
                        <Icon icon="lucide:cloud" width={16} /> Protect My Work
                    </a>
                };

            case 'free-storage-critical':
                return {
                    icon: 'lucide:hard-drive',
                    color: 'var(--red-9)',
                    title: '💾 Storage SOS!',
                    desc: `Your browser's storage is getting cramped (like a tiny studio apartment). Upgrade to Pro for unlimited cloud space and room to breathe!`,
                    action: <a href="/pricing" className="btn btn-primary">
                        <Icon icon="lucide:home" width={16} /> Get More Space
                    </a>
                };

            case 'free-unique-remote':
                const remoteOnlyCount = remoteData ? remoteData.cloudVoiceCount + remoteData.cloudDubCount : 0;
                return {
                    icon: 'lucide:smartphone',
                    color: 'var(--cyan-9)',
                    title: '📱 We found your stuff!',
                    desc: `${remoteOnlyCount} creation${remoteOnlyCount === 1 ? '' : 's'} from another device ${remoteOnlyCount === 1 ? 'is' : 'are'} waiting for you in the cloud. Upgrade to Pro to bring them here!`,
                    action: <a href="/pricing" className="btn btn-primary">
                        <Icon icon="lucide:link" width={16} /> Connect Devices
                    </a>
                };

            case 'free-mixed-remote':
                return {
                    icon: 'lucide:puzzle',
                    color: 'var(--violet-9)',
                    title: '🧩 Your collection is scattered!',
                    desc: `You've got media here AND on other devices. Upgrade to Pro to bring the whole gang together!`,
                    action: <a href="/pricing" className="btn btn-primary">
                        <Icon icon="lucide:users" width={16} /> Unite Everything
                    </a>
                };

            case 'network-error':
                return {
                    icon: 'lucide:wifi-off',
                    color: 'var(--mauve-9)',
                    title: '📡 Connection hiccup',
                    desc: `Couldn't reach the cloud. Check your internet and try again!`,
                    action: <button className="btn btn-ghost" onClick={() => determineState()}>
                        <Icon icon="lucide:refresh-cw" width={16} /> Retry
                    </button>
                };

            default:
                return null;
        }
    };

    const content = renderContent();
    if (!content) return null;

    return (
        <div className={`migration-banner ${currentState === 'pro-sync-complete' ? 'success' : ''}`}>
            <div className="banner-icon" style={{ background: content.color }}>
                <Icon
                    icon={content.icon}
                    width={24}
                    height={24}
                    className={currentState === 'pro-sync-in-progress' ? 'spinning' : ''}
                />
            </div>

            <div className="banner-content">
                <h3>{content.title}</h3>
                <p>{content.desc}</p>

                {error && <div className="banner-error">{error}</div>}
            </div>

            <div className="banner-actions">
                {content.action}
                {currentState !== 'pro-sync-in-progress' && currentState !== 'pro-sync-complete' && (
                    <button className="btn btn-ghost btn-dismiss" onClick={handleDismiss} aria-label="Dismiss">
                        <Icon icon="lucide:x" width={20} />
                    </button>
                )}
            </div>
            <style>{bannerStyles}</style>
        </div>
    );
}

// ================= STYLES =================
const bannerStyles = `
    .migration-banner {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 16px;
        padding: 16px;
        animation: slideIn 0.3s ease-out;
        align-items: start;

    }

    .banner-icon {
        width: 44px;
        height: 44px;
        background: var(--mauve-4);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        flex-shrink: 0;
    }

    .banner-icon .spinning {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .banner-content {
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
        color: var(--mauve-3);
        margin: 0;
        line-height: 1.5;
    }

    .banner-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-shrink: 0;
    }

    .banner-error {
        margin-top: 8px;
        font-size: 0.85rem;
        color: var(--red-11);
        background: var(--red-3);
        padding: 8px 12px;
        border-radius: var(--radius-m);
    }

    .sync-progress-wrapper {
        width: 100%;
        min-width: 120px;
    }

    .progress-bar {
        height: 6px;
        background: var(--mauve-5);
        border-radius: 4px;
        overflow: hidden;
        margin-top: 4px;
    }

    .progress-bar .fill {
        height: 100%;
        background: linear-gradient(90deg, var(--blue-9), var(--cyan-9));
        transition: width 0.3s ease;
        border-radius: 4px;
    }

    .progress-bar .fill.animated {
        animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
        0% { opacity: 0.8; }
        50% { opacity: 1; }
        100% { opacity: 0.8; }
    }

    .btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 18px;
        border-radius: 99px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        text-decoration: none;
        white-space: nowrap;
        transition: all 0.2s ease;
    }

    .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-primary {
        background: linear-gradient(135deg, var(--orange-9), var(--orange-10));
        color: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, var(--orange-10), var(--orange-11));
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .btn-ghost {
        background: var(--mauve-4);
        color: var(--mauve-12);
        padding: 10px;
    }

    .btn-ghost:hover {
        background: var(--mauve-5);
        color: var(--orange-9);
    }

    .btn-dismiss {
        padding: 8px;
    }

    @keyframes slideIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* Mobile Responsive */
    @media (max-width: 768px) {
        .migration-banner {
            grid-template-columns: auto 1fr;
            grid-template-rows: auto auto;
            gap: 12px;
            padding: 14px;
        }
        
        .banner-icon {
            grid-row: 1;
            grid-column: 1;
            width: 36px;
            height: 36px;
        }
        
        .banner-content {
            grid-row: 1;
            grid-column: 2;
        }
        
        .banner-actions {
            grid-row: 2;
            grid-column: 1 / -1;
            width: 100%;
            margin-top: 4px;
            justify-content: space-between;
        }
        
        .banner-actions > *:first-child {
            flex: 1;
        }
        
        .btn {
            padding: 12px 16px;
        }

        .banner-content h3 {
            font-size: 0.95rem;
        }

        .banner-content p {
            font-size: 0.85rem;
        }
    }
`;