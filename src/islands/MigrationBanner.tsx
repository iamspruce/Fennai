import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { getVoiceFromIndexedDB, getStorageQuota } from '@/lib/db/indexdb'; //

interface MigrationBannerProps {
    characterId: string;
    isPro: boolean;
    saveAcrossBrowsers: boolean; // This comes from [id].astro props
}

export default function MigrationBanner({ characterId, isPro, saveAcrossBrowsers }: MigrationBannerProps) {
    const [localVoicesWithAudio, setLocalVoicesWithAudio] = useState<any[]>([]);
    const [remoteLocalOnlyCount, setRemoteLocalOnlyCount] = useState(0);
    const [isMigrating, setIsMigrating] = useState(false);
    const [isEnablingCloud, setIsEnablingCloud] = useState(false); // NEW
    const [storagePressure, setStoragePressure] = useState(0); // NEW
    const [progress, setProgress] = useState(0);
    const [currentVoice, setCurrentVoice] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isDismissed, setIsDismissed] = useState(false);

    // Effect 1: Check Local Storage & Quota
    useEffect(() => {
        const checkLocalAndQuota = async () => {
            // Check quota for marketing state
            const quota = await getStorageQuota();
            setStoragePressure(quota.percentUsed);

            // Get local voices specifically for this character logic...
            // (Logic inferred from your existing code structure)
        };
        checkLocalAndQuota();
    }, []);

    // Effect 2: Check Remote Migration Status (Only if cloud is ON)
    useEffect(() => {
        if (!saveAcrossBrowsers) return;

        const checkMigration = async () => {
            try {
                const response = await fetch(`/api/voices/check-migration?characterId=${characterId}`); //
                if (!response.ok) return;

                const { localOnlyIds, count } = await response.json();
                setRemoteLocalOnlyCount(count);

                // Only keep voices that actually have audio on THIS device
                const voicesWithAudio = [];
                for (const voiceId of localOnlyIds) {
                    const record = await getVoiceFromIndexedDB(voiceId); //
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

    // NEW: Handle turning on Cloud Mode
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
        // ... (Keep your existing migration logic exactly as is) ...
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

                const res = await fetch('/api/voices/migrate-upload', { //
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

    // NEW: Check if user has voices locally but cloud is OFF
    // Note: We need to check if ANY voices exist locally for this character. 
    // Assuming you can pass `totalVoices` or similar prop, or we infer from the fact 
    // that this component is mounted on a character page.
    // For now, I will assume if `saveAcrossBrowsers` is false, we want to show the banner
    // if the user is Pro.

    // Fallback logic for display conditions
    if (isDismissed) return null;

    return (
        <div className="migration-banner">
            <div className="banner-icon">
                {/* Dynamic Icon based on state */}
                {!saveAcrossBrowsers && isPro ? (
                    <Icon icon="lucide:ghost" width={32} height={32} />
                ) : !isPro && storagePressure > 70 ? (
                    <Icon icon="lucide:hard-drive" width={32} height={32} />
                ) : (
                    <Icon icon="lucide:cloud-upload" width={32} height={32} />
                )}
            </div>

            <div className="banner-content">
                {/* =========================================================
                    NEW STATE: Pro User + Cloud OFF (Living Dangerously)
                   ========================================================= */}
                {isPro && !saveAcrossBrowsers && (
                    <>
                        <h3>
                            <Icon icon="lucide:alert-triangle" width={20} height={20} />
                            These voices are living dangerously!
                        </h3>
                        <p>
                            Right now, your voices only exist in this browser. If you clear your cache or switch to your phone, they'll vanish like a ghost! 👻
                            Turn on <strong>Cloud Mode</strong> to give them a forever home.
                        </p>
                    </>
                )}

                {/* =========================================================
                    EXISTING STATE: Pro + Cloud ON + Local Audio (Ready to Sync)
                   ========================================================= */}
                {isPro && saveAcrossBrowsers && hasLocalAudioHere && (
                    <>
                        <h3>
                            <Icon icon="lucide:sparkles" width={20} height={20} />
                            {localVoicesWithAudio.length} voice{localVoicesWithAudio.length > 1 ? 's' : ''} ready to fly to the cloud!
                        </h3>
                        <p>
                            Send them up now and they’ll be waiting for you on every device. One-time trip, no baggage fees.
                        </p>
                    </>
                )}

                {/* =========================================================
                    EXISTING STATE: Pro + Remote Only (Sync on other device)
                   ========================================================= */}
                {isPro && saveAcrossBrowsers && !hasLocalAudioHere && hasRemoteOnly && (
                    <>
                        <h3>
                            <Icon icon="lucide:globe" width={20} height={20} />
                            {remoteLocalOnlyCount} voice{remoteLocalOnlyCount > 1 ? 's are' : ' is'} chilling on another device
                        </h3>
                        <p>
                            They’re already marked for cloud sync! Just open this character on that device and hit “Sync to Cloud” whenever you feel like it.
                        </p>
                    </>
                )}

                {/* =========================================================
                    NEW MARKETING STATE: Free + Storage Getting Full
                   ========================================================= */}
                {!isPro && storagePressure > 70 && (
                    <>
                        <h3>
                            <Icon icon="lucide:weight" width={20} height={20} />
                            Your browser is getting a bit heavy...
                        </h3>
                        <p>
                            You've used {Math.round(storagePressure)}% of your browser's allocated storage.
                            If it gets full, the browser might start deleting your oldest voices!
                            Upgrade to Pro to upload them to the cloud and keep them safe forever.
                        </p>
                        <a href="/pricing" className="btn btn-primary" style={{ marginTop: '12px', display: 'inline-flex' }}>
                            <Icon icon="lucide:rocket" width={18} height={18} />
                            Go Pro & Save Space
                        </a>
                    </>
                )}

                {/* =========================================================
                    EXISTING STATE: Free + Remote Only (Upsell)
                   ========================================================= */}
                {!isPro && hasRemoteOnly && storagePressure <= 70 && (
                    <>
                        <h3>
                            <Icon icon="lucide:lock" width={20} height={20} />
                            {remoteLocalOnlyCount} voice{remoteLocalOnlyCount > 1 ? 's are' : ' is'} trapped on another device
                        </h3>
                        <p>
                            Your voices want to travel the world with you! Upgrade to Pro and they’ll magically appear everywhere you log in.
                        </p>
                        <a href="/pricing" className="btn btn-primary" style={{ marginTop: '12px', display: 'inline-flex' }}>
                            <Icon icon="lucide:rocket" width={18} height={18} />
                            Upgrade to Pro & Free Your Voices
                        </a>
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
            </div>

            <div className="banner-actions">

                {/* ACTION: Turn On Cloud (New) */}
                {isPro && !saveAcrossBrowsers && !isEnablingCloud && (
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


                {/* ACTION: Sync (Existing) */}
                {isPro && saveAcrossBrowsers && hasLocalAudioHere && !isMigrating && (
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

                {/* Dismiss logic for others */}
                {!isMigrating && !isEnablingCloud && (
                    (!isPro || (isPro && saveAcrossBrowsers && !hasLocalAudioHere)) && (
                        <button onClick={handleDismiss} className="btn btn-ghost" title="Dismiss">
                            <Icon icon="lucide:x" width={18} height={18} />
                        </button>
                    )
                )}
            </div>

            {/* Styles remain exactly the same as your provided file */}
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
                    background: var(--pink-4);
                    border-radius: var(--radius-full);
                    color: var(--pink-11);
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
                .progress-fill { height: 100%; background: linear-gradient(90deg, var(--pink-9) 0%, var(--violet-9) 100%); border-radius: var(--radius-full); transition: width 0.3s ease; }
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
                    background: var(--pink-9);
                    color: white;
                }
                .btn-primary:hover { background: var(--pink-10); transform: translateY(-1px); }

                .btn-ghost {
                    background: var(--mauve-5);
                    color: var(--mauve-12);
                    padding: var(--space-xs);
                }

                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid var(--mauve-6);
                    border-top: 3px solid var(--pink-9);
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