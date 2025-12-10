import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { getVoiceFromIndexedDB, getStorageQuota } from '@/lib/db/indexdb';

interface MigrationBannerProps {
    characterId: string;
    isPro: boolean;
    saveAcrossBrowsers: boolean; // Per-character setting from Character type
}

export default function MigrationBanner({ characterId, isPro, saveAcrossBrowsers }: MigrationBannerProps) {
    const [localVoicesWithAudio, setLocalVoicesWithAudio] = useState<any[]>([]);
    const [remoteLocalOnlyCount, setRemoteLocalOnlyCount] = useState(0);
    const [totalLocalVoices, setTotalLocalVoices] = useState(0);
    const [isMigrating, setIsMigrating] = useState(false);
    const [isEnablingCloud, setIsEnablingCloud] = useState(false);
    const [storagePressure, setStoragePressure] = useState(0);
    const [progress, setProgress] = useState(0);
    const [currentVoice, setCurrentVoice] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isDismissed, setIsDismissed] = useState(false);

    // Effect 1: Check Local Storage & Quota
    useEffect(() => {
        const checkLocalAndQuota = async () => {
            try {
                // Check quota for marketing state
                const quota = await getStorageQuota();
                setStoragePressure(quota.percentUsed);

                // Get ALL local voices for this character
                const { getAllVoices } = await import('@/lib/db/indexdb');
                const allLocal = await getAllVoices();
                const characterVoices = allLocal.filter(v => v.characterId === characterId);
                setTotalLocalVoices(characterVoices.length);
            } catch (err) {
                console.error('Error checking local storage:', err);
            }
        };
        checkLocalAndQuota();
    }, [characterId]);

    // Effect 2: Check Remote Migration Status (Only if cloud is ON for this character)
    useEffect(() => {
        if (!saveAcrossBrowsers) return;

        const checkMigration = async () => {
            try {
                const response = await fetch(`/api/voices/check-migration?characterId=${characterId}`);
                if (!response.ok) return;

                const { localOnlyIds, count } = await response.json();
                setRemoteLocalOnlyCount(count);

                // Only keep voices that actually have audio on THIS device
                const voicesWithAudio = [];
                for (const voiceId of localOnlyIds) {
                    const record = await getVoiceFromIndexedDB(voiceId);
                    if (record?.audioBlob) {
                        voicesWithAudio.push(record);
                    }
                }
                setLocalVoicesWithAudio(voicesWithAudio);
            } catch (err) {
                console.error('Error checking migration:', err);
            }
        };

        checkMigration();
    }, [characterId, saveAcrossBrowsers]);

    // Handle turning on Cloud Mode for this character
    const handleEnableCloud = async () => {
        setIsEnablingCloud(true);
        try {
            const formData = new FormData();
            formData.append('characterId', characterId);

            const res = await fetch('/api/character/enable-cloud', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error('Failed to enable');

            // Reload page to refresh props and trigger the standard migration flow
            window.location.reload();
        } catch (e) {
            setError("Couldn't flip the switch. Try again?");
            setIsEnablingCloud(false);
        }
    };

    const handleMigrate = async () => {
        if (localVoicesWithAudio.length === 0) return;

        setIsMigrating(true);
        setProgress(0);
        setError(null);

        let completed = 0;
        for (let i = 0; i < localVoicesWithAudio.length; i++) {
            const voice = localVoicesWithAudio[i];
            setCurrentVoice(i + 1);

            try {
                const record = await getVoiceFromIndexedDB(voice.id);
                if (!record?.audioBlob) continue;

                const formData = new FormData();
                formData.append('voiceId', voice.id);
                formData.append('audioBlob', record.audioBlob);

                const res = await fetch('/api/voices/migrate-upload', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) throw new Error('Upload failed');

                completed++;
                setProgress((completed / localVoicesWithAudio.length) * 100);

                if (i < localVoicesWithAudio.length - 1) {
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (err: any) {
                console.error(`Failed to migrate ${voice.id}:`, err);
                setError(`Oops! ${completed} made it to the cloud, but some got stage fright.`);
                break;
            }
        }

        if (!error && completed === localVoicesWithAudio.length) {
            setTimeout(() => window.location.reload(), 1000);
        } else {
            setIsMigrating(false);
        }
    };

    const handleDismiss = () => setIsDismissed(true);

    // ─── Decide what to show ───
    const hasLocalAudioHere = localVoicesWithAudio.length > 0;
    const hasRemoteOnly = remoteLocalOnlyCount > localVoicesWithAudio.length;

    // Determine which state to show (priority order)
    const shouldShow = (() => {
        // Pro user states
        if (isPro) {
            if (!saveAcrossBrowsers && totalLocalVoices > 0) return 'pro-cloud-off-with-voices';
            if (saveAcrossBrowsers && hasLocalAudioHere) return 'pro-ready-to-sync';
            if (saveAcrossBrowsers && hasRemoteOnly) return 'pro-remote-only';
            return null; // Pro user with nothing to show
        }

        // Free user states
        if (storagePressure > 80) return 'free-storage-critical';
        if (storagePressure > 60) return 'free-storage-warning';
        if (hasRemoteOnly) return 'free-remote-locked';
        if (totalLocalVoices > 5) return 'free-many-voices-upsell';

        return null; // Nothing to show
    })();

    if (isDismissed || !shouldShow) return null;

    return (
        <div className="migration-banner">
            <div className="banner-icon">
                {/* Dynamic Icon based on state */}
                {shouldShow === 'pro-cloud-off-with-voices' ? (
                    <Icon icon="lucide:ghost" width={32} height={32} />
                ) : shouldShow === 'free-storage-critical' || shouldShow === 'free-storage-warning' ? (
                    <Icon icon="lucide:hard-drive" width={32} height={32} />
                ) : shouldShow === 'free-remote-locked' ? (
                    <Icon icon="lucide:lock" width={32} height={32} />
                ) : (
                    <Icon icon="lucide:cloud-upload" width={32} height={32} />
                )}
            </div>

            <div className="banner-content">
                {/* =========================================================
                    PRO: Cloud OFF + Has Local Voices (Living Dangerously)
                   ========================================================= */}
                {shouldShow === 'pro-cloud-off-with-voices' && (
                    <>
                        <h3>
                            <Icon icon="lucide:alert-triangle" width={20} height={20} />
                            These {totalLocalVoices} voice{totalLocalVoices > 1 ? 's are' : ' is'} living dangerously!
                        </h3>
                        <p>
                            Right now, your voices only exist in this browser. If you clear your cache or switch to your phone, they'll vanish like a ghost! 👻
                            Turn on <strong>Cloud Mode</strong> to give them a forever home.
                        </p>
                    </>
                )}

                {/* =========================================================
                    PRO: Cloud ON + Local Audio (Ready to Sync)
                   ========================================================= */}
                {shouldShow === 'pro-ready-to-sync' && (
                    <>
                        <h3>
                            <Icon icon="lucide:sparkles" width={20} height={20} />
                            {localVoicesWithAudio.length} voice{localVoicesWithAudio.length > 1 ? 's' : ''} ready to fly to the cloud!
                        </h3>
                        <p>
                            Send them up now and they'll be waiting for you on every device. One-time trip, no baggage fees.
                        </p>
                    </>
                )}

                {/* =========================================================
                    PRO: Remote Only (Sync on other device)
                   ========================================================= */}
                {shouldShow === 'pro-remote-only' && (
                    <>
                        <h3>
                            <Icon icon="lucide:globe" width={20} height={20} />
                            {remoteLocalOnlyCount} voice{remoteLocalOnlyCount > 1 ? 's are' : ' is'} chilling on another device
                        </h3>
                        <p>
                            They're already marked for cloud sync! Just open this character on that device and hit "Sync to Cloud" whenever you feel like it.
                        </p>
                    </>
                )}

                {/* =========================================================
                    FREE: Storage Critical (>80%)
                   ========================================================= */}
                {shouldShow === 'free-storage-critical' && (
                    <>
                        <h3>
                            <Icon icon="lucide:alert-octagon" width={20} height={20} />
                            Houston, we have a storage problem! 🚨
                        </h3>
                        <p>
                            You've used {Math.round(storagePressure)}% of your browser's storage limit.
                            Your browser might start auto-deleting your oldest voices to make room!
                            Upgrade to Pro and we'll move everything to the cloud where they'll be safe forever.
                        </p>
                    </>
                )}

                {/* =========================================================
                    FREE: Storage Warning (60-80%)
                   ========================================================= */}
                {shouldShow === 'free-storage-warning' && (
                    <>
                        <h3>
                            <Icon icon="lucide:hard-drive" width={20} height={20} />
                            Your browser's getting a bit full... 📦
                        </h3>
                        <p>
                            You've used {Math.round(storagePressure)}% of your browser's storage.
                            If it fills up, the browser might start deleting your oldest voices automatically.
                            Go Pro to upload them to the cloud and never worry about running out of space!
                        </p>
                    </>
                )}

                {/* =========================================================
                    FREE: Remote Voices Locked (Other Device)
                   ========================================================= */}
                {shouldShow === 'free-remote-locked' && (
                    <>
                        <h3>
                            <Icon icon="lucide:lock" width={20} height={20} />
                            {remoteLocalOnlyCount} voice{remoteLocalOnlyCount > 1 ? 's are' : ' is'} trapped on another device! 🔒
                        </h3>
                        <p>
                            Your voices want to travel with you, but they're stuck in browser jail.
                            Upgrade to Pro and they'll magically appear everywhere you log in—phone, tablet, laptop, you name it!
                        </p>
                    </>
                )}

                {/* =========================================================
                    FREE: Many Local Voices (Upsell)
                   ========================================================= */}
                {shouldShow === 'free-many-voices-upsell' && (
                    <>
                        <h3>
                            <Icon icon="lucide:sparkles" width={20} height={20} />
                            Look at you, voice collecting champion! 🏆
                        </h3>
                        <p>
                            You've got {totalLocalVoices} voices saved locally. That's awesome!
                            But what if you want to use them on your phone? Or your laptop crashes? 😱
                            Go Pro and we'll back them all up to the cloud so you can access them anywhere, anytime.
                        </p>
                    </>
                )}

                {/* Errors & Progress Bars */}
                {error && (
                    <div className="banner-error">
                        <Icon icon="lucide:alert-circle" width={16} height={16} />
                        <span>{error}</span>
                    </div>
                )}

                {isMigrating && (
                    <div className="migration-progress">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="progress-text">
                            Uploading voice {currentVoice} of {localVoicesWithAudio.length}... {Math.round(progress)}%
                        </span>
                    </div>
                )}

                {/* Pro CTA Buttons for Free Users */}
                {!isPro && (shouldShow === 'free-storage-critical' || shouldShow === 'free-storage-warning' || shouldShow === 'free-remote-locked' || shouldShow === 'free-many-voices-upsell') && (
                    <a href="/pricing" className="btn btn-primary" style={{ marginTop: '12px', display: 'inline-flex' }}>
                        <Icon icon="lucide:rocket" width={18} height={18} />
                        {shouldShow === 'free-storage-critical' || shouldShow === 'free-storage-warning'
                            ? 'Go Pro & Save Space'
                            : 'Upgrade to Pro'}
                    </a>
                )}
            </div>

            <div className="banner-actions">
                {/* ACTION: Turn On Cloud (Pro user with cloud off) */}
                {shouldShow === 'pro-cloud-off-with-voices' && !isEnablingCloud && (
                    <>
                        <button onClick={handleEnableCloud} className="btn btn-primary">
                            <Icon icon="lucide:zap" width={18} height={18} />
                            Turn On Cloud
                        </button>
                        <button onClick={handleDismiss} className="btn btn-ghost" title="I like living dangerously">
                            <Icon icon="lucide:x" width={18} height={18} />
                        </button>
                    </>
                )}
                {isEnablingCloud && <div className="spinner" />}

                {/* ACTION: Sync to Cloud (Pro user ready to sync) */}
                {shouldShow === 'pro-ready-to-sync' && !isMigrating && (
                    <>
                        <button onClick={handleMigrate} className="btn btn-primary">
                            <Icon icon="lucide:cloud-upload" width={18} height={18} />
                            Sync to Cloud
                        </button>
                        <button onClick={handleDismiss} className="btn btn-ghost" title="Dismiss">
                            <Icon icon="lucide:x" width={18} height={18} />
                        </button>
                    </>
                )}
                {isMigrating && <div className="spinner" />}

                {/* Dismiss button for informational states */}
                {(shouldShow === 'pro-remote-only' || !isPro) && !isMigrating && !isEnablingCloud && (
                    <button onClick={handleDismiss} className="btn btn-ghost" title="Dismiss">
                        <Icon icon="lucide:x" width={18} height={18} />
                    </button>
                )}
            </div>

            {/* Styles */}
            <style>{`
                .migration-banner {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-m);
                    padding: var(--space-m);
                    animation: slideIn 0.3s ease-out;
                }

                @keyframes slideIn {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .banner-icon {
                    flex-shrink: 0;
                    width: 48px;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--orange-4);
                    border-radius: var(--radius-full);
                    color: var(--orange-11);
                }

                .banner-content {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                }

                .banner-content h3 {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    margin: 0 0 var(--space-xs) 0;
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: var(--mauve-1);
                }

                .banner-content p {
                    margin: 0 0 var(--space-s) 0;
                    font-size: 0.95rem;
                    color: var(--mauve-2);
                    line-height: 1.5;
                }

                .banner-error {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    margin-top: var(--space-s);
                    padding: var(--space-xs) var(--space-s);
                    color: var(--red-11);
                    background: var(--red-4);
                    border-radius: var(--radius-m);
                    font-size: 0.9rem;
                }

                .migration-progress { margin-top: var(--space-s); }
                .progress-bar { width: 100%; height: 8px; background: var(--mauve-6); border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--space-xs); }
                .progress-fill { height: 100%; background: linear-gradient(90deg, var(--orange-9) 0%, var(--violet-9) 100%); border-radius: var(--radius-full); transition: width 0.3s ease; }
                .progress-text { font-size: 0.9rem; color: var(--mauve-12); font-weight: 500; }

                .banner-actions {
                    flex-shrink: 0;
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-xs);
                }

                .btn {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    padding: var(--space-xs) var(--space-s);
                    border: none;
                    border-radius: var(--radius-full);
                    font-size: 0.95rem;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }

                .btn-primary {
                    background: var(--orange-9);
                    color: white;
                }
                .btn-primary:hover { background: var(--orange-10); transform: translateY(-1px); }

                .btn-ghost {
                    background: var(--mauve-5);
                    color: var(--mauve-12);
                    padding: var(--space-xs);
                }

                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid var(--mauve-6);
                    border-top: 3px solid var(--orange-9);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                @keyframes spin { to { transform: rotate(360deg); } }

                @media (max-width: 768px) {
                    .migration-banner { flex-direction: column; }
                    .banner-actions { width: 100%; justify-content: space-between; }
                    .btn { flex: 1; }
                    .btn-ghost { flex: 0; }
                }
            `}</style>
        </div>
    );
}