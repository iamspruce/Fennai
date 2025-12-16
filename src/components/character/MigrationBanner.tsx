// src/islands/MigrationBanner.tsx
import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { getVoiceFromIndexedDB, getStorageQuota, type VoiceRecord } from '@/lib/db/indexdb';

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
            // A. Check Local Storage & Quota
            const quota = await getStorageQuota();
            const { getAllVoices } = await import('@/lib/db/indexdb');
            const allLocal = await getAllVoices();
            const charVoices = allLocal.filter(v => v.characterId === characterId);

            // Filter strictly for voices that have actual audio data
            const validLocalVoices = charVoices.filter(v => v.audioData || v.audioBlob);
            setTotalLocalCount(validLocalVoices.length);

            // B. Check Remote Status (API)
            let remoteData = { localOnlyIds: [] as string[], count: 0 };
            try {
                const res = await fetch(`/api/voices/check-migration?characterId=${characterId}`);
                if (res.ok) remoteData = await res.json();
            } catch (err) {
                console.warn('Network check failed, assuming offline');
                // Don't block UI, just degrade functionality
            }
            setRemoteCount(remoteData.count);

            // C. Cross-Reference for Sync (Pro Users)
            const toSync: VoiceRecord[] = [];
            if (isPro) {
                for (const voice of validLocalVoices) {
                    // Check if voice ID is marked as "localOnly" by server OR simply missing from server logic
                    // If the server explicitly told us which IDs are missing (localOnlyIds), use that.
                    if (remoteData.localOnlyIds.includes(voice.id) || !voice.isInCloudStorage) {
                        toSync.push(voice);
                    }
                }
                setLocalVoicesToSync(toSync);
            }

            // D. DECISION MATRIX (Priority Order)

            // Priority 1: Storage Panic (Applies to everyone)
            if (quota.percentUsed > 90) {
                setCurrentState('free-storage-critical');
                return;
            }

            // Priority 2: Pro User Workflows
            if (isPro) {
                if (!saveAcrossBrowsers && validLocalVoices.length > 0) {
                    setCurrentState('pro-cloud-disabled');
                    return;
                }
                if (saveAcrossBrowsers && toSync.length > 0) {
                    setCurrentState('pro-sync-needed');
                    return;
                }
                if (saveAcrossBrowsers && remoteData.count > validLocalVoices.length) {
                    // We have more files on server than here
                    setCurrentState('pro-remote-available');
                    return;
                }
                setCurrentState('hidden');
                return;
            }

            // Priority 3: Free User Workflows
            // If remote count > local count, it implies there are voices "elsewhere" (cloud or other device).
            if (remoteData.count > validLocalVoices.length) {
                if (validLocalVoices.length === 0) {
                    // Purely remote voices found (e.g. from another device or prev sub)
                    setCurrentState('free-unique-remote');
                } else {
                    // Has some local, but MORE remote/elsewhere
                    setCurrentState('free-mixed-remote');
                }
                return;
            }

            // Standard Free User: Has local files that are at risk
            if (validLocalVoices.length > 0) {
                setCurrentState('free-risk-data-loss');
                return;
            }

            if (quota.percentUsed > 70) {
                // Warning level for Free users
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
        const total = localVoicesToSync.length;

        try {
            for (let i = 0; i < total; i++) {
                const voice = localVoicesToSync[i];

                // Edge Case: Local DB corruption check
                const record = await getVoiceFromIndexedDB(voice.id);
                if (!record?.audioBlob) {
                    console.warn(`Skipping corrupt voice ${voice.id}`);
                    continue;
                }

                const formData = new FormData();
                formData.append('voiceId', voice.id);
                formData.append('audioBlob', record.audioBlob);
                formData.append('characterId', characterId); // Ensure consistency

                const res = await fetch('/api/voices/migrate-upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) throw new Error('Upload failed');

                successCount++;
                setProgress(Math.round(((i + 1) / total) * 100));
            }

            // Refresh state after sync
            window.location.reload();
        } catch (err) {
            setError(`Sync failed after ${successCount} voices. Please try again.`);
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
                    title: 'Syncing your studio... 🎧',
                    desc: `We found voices that need a lift to the cloud. Sync them up to access them everywhere!`,
                    action: <button className="btn btn-primary" onClick={handleSync} disabled={isProcessing}>
                        {isProcessing ? `Lifting off... ${progress}%` : 'Sync Now'}
                    </button>
                };
            case 'pro-cloud-disabled':
                return {
                    icon: 'lucide:ghost',
                    title: 'Your voices are grounded ✈️',
                    desc: `Your voices are trapped in this browser. Turn on Cloud Mode to let them fly to your other devices!`,
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
                    desc: `Your created voices are currently saved only in this browser's cache. If you clear data, they'll be lost. Go Pro to back them up securely!`,
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