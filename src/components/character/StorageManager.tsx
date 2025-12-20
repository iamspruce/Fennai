// src/components/character/StorageManager.tsx
import { useState, useEffect } from 'react';
import {
    getStorageStats,
    getStorageQuota,
    getVoicesForCleanup,
    getDubbingMediaForCleanup,
    autoCleanupOldVoices,
    autoCleanupDubbingMedia,
    deleteVoicesBatch,
    deleteDubbingBatch,
    formatBytes,
    type VoiceRecord,
    type DubbingMediaRecord,
} from '@/lib/db/indexdb';
import { Icon } from '@iconify/react';
import '@/styles/modal.css';

export default function StorageManager() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<Awaited<ReturnType<typeof getStorageStats>> | null>(null);
    const [voiceCandidates, setVoiceCandidates] = useState<Awaited<ReturnType<typeof getVoicesForCleanup>> | null>(null);
    const [dubbingCandidates, setDubbingCandidates] = useState<Awaited<ReturnType<typeof getDubbingMediaForCleanup>> | null>(null);
    const [selectedTab, setSelectedTab] = useState<'overview' | 'cleanup'>('overview');
    const [cleaning, setCleaning] = useState(false);

    useEffect(() => {
        const handler = () => {
            setIsOpen(true);
            loadData();
        };
        window.addEventListener('open-storage-manager', handler);
        return () => window.removeEventListener('open-storage-manager', handler);
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [storageStats, voices, dubs] = await Promise.all([
                getStorageStats(),
                getVoicesForCleanup(),
                getDubbingMediaForCleanup(),
            ]);
            setStats(storageStats);
            setVoiceCandidates(voices);
            setDubbingCandidates(dubs);
        } catch (err) {
            console.error('Failed to load storage data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAutoCleanup = async () => {
        if (!confirm('Run automatic cleanup?\n\nThis will remove old voices and dubbed videos to free up space, keeping your most recent items.')) return;
        setCleaning(true);
        try {
            const [voiceResult, dubResult] = await Promise.all([
                autoCleanupOldVoices(),
                autoCleanupDubbingMedia()
            ]);
            const totalFreed = voiceResult.freedSpace + dubResult.freedSpace;
            alert(`Cleanup complete!\n- Voices: ${voiceResult.deletedCount} removed\n- Videos: ${dubResult.deletedCount} removed\n- Total Freed: ${formatBytes(totalFreed)}`);
            await loadData();
        } catch (err) {
            console.error('Cleanup failed:', err);
            alert('Cleanup failed');
        } finally {
            setCleaning(false);
        }
    };

    const handleCleanup = async (voices: VoiceRecord[], label: string) => {
        if (voices.length === 0) return;
        if (!confirm(`Delete ${voices.length} ${label} voices?\n\nThis cannot be undone.`)) return;
        setCleaning(true);
        try {
            const deleted = await deleteVoicesBatch(voices.map(v => v.id));
            alert(`Deleted ${deleted} ${label} voices`);
            await loadData();
        } catch {
            alert('Failed to delete');
        } finally {
            setCleaning(false);
        }
    };

    const handleDubbingCleanup = async (media: DubbingMediaRecord[], label: string) => {
        if (media.length === 0) return;
        if (!confirm(`Delete ${media.length} ${label} dubbed videos?\n\nThis cannot be undone.`)) return;
        setCleaning(true);
        try {
            const deleted = await deleteDubbingBatch(media.map(m => m.id));
            alert(`Deleted ${deleted} ${label} dubbed videos`);
            await loadData();
        } catch {
            alert('Failed to delete');
        } finally {
            setCleaning(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
            <div
                className="modal-content modal-wide"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Mobile Drag Handle */}
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                {/* Header */}
                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:hard-drive" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
                        <h2 className="modal-title">Storage Manager</h2>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)} aria-label="Close">
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* iOS Style Segmented Control */}
                    <div style={{
                        display: 'flex',
                        background: 'var(--mauve-3)',
                        padding: '4px',
                        borderRadius: '8px',
                        marginBottom: 'var(--space-l)',
                        position: 'relative'
                    }}>
                        {(['overview', 'cleanup'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setSelectedTab(tab)}
                                style={{
                                    flex: 1,
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    fontSize: '14px',
                                    fontWeight: selectedTab === tab ? 600 : 500,
                                    background: selectedTab === tab ? 'var(--mauve-1)' : 'transparent',
                                    color: selectedTab === tab ? 'var(--mauve-12)' : 'var(--mauve-11)',
                                    boxShadow: selectedTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {tab === 'overview' ? 'Overview' : 'Free Up Space'}
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                            <Icon icon="lucide:loader-2" className="animate-spin" width={32} height={32} style={{ color: 'var(--orange-9)', margin: '0 auto' }} />
                            <p style={{ color: 'var(--mauve-11)', marginTop: 'var(--space-m)' }}>Analyzing storage...</p>
                        </div>
                    ) : selectedTab === 'overview' ? (
                        <div style={{ display: 'grid', gap: 'var(--space-l)' }}>
                            {/* Quota Bar */}
                            <div style={{
                                background: 'var(--mauve-2)',
                                padding: 'var(--space-m)',
                                borderRadius: 'var(--radius-m)',
                                border: '1px solid var(--mauve-4)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', fontWeight: 600 }}>
                                    <span>Browser Storage</span>
                                    <span style={{ color: stats!.quota.percentUsed >= 80 ? 'var(--red-9)' : 'var(--mauve-11)' }}>
                                        {stats!.quota.percentUsed.toFixed(1)}% Used
                                    </span>
                                </div>

                                <div style={{ height: 16, background: 'var(--mauve-4)', borderRadius: '100px', overflow: 'hidden', marginBottom: '8px' }}>
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${Math.min(stats!.quota.percentUsed, 100)}%`,
                                            background: stats!.quota.percentUsed >= 90 ? 'var(--red-9)' :
                                                stats!.quota.percentUsed >= 75 ? 'var(--orange-9)' : 'var(--green-9)',
                                            transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                                        }}
                                    />
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--mauve-11)', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{formatBytes(stats!.quota.usage)} used</span>
                                    <span>{formatBytes(stats!.quota.available)} free</span>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-s)' }}>
                                {[
                                    { label: 'Voices', value: stats!.voiceCount, icon: 'lucide:mic' },
                                    { label: 'Voices Size', value: formatBytes(stats!.voicesSize), icon: 'lucide:file-audio' },
                                    { label: 'Dubbed', value: stats!.dubbingMediaCount, icon: 'lucide:video' },
                                    { label: 'Dubbing Size', value: formatBytes(stats!.dubbingSize), icon: 'lucide:file-video' },
                                    { label: 'Total Local', value: formatBytes(stats!.totalSize), icon: 'lucide:hard-drive' },
                                    { label: 'Synced', value: stats!.cloudStorageCount, icon: 'lucide:cloud' },
                                ].map(item => (
                                    <div key={item.label} style={{
                                        background: 'var(--mauve-2)',
                                        padding: 'var(--space-m)',
                                        borderRadius: 'var(--radius-m)',
                                        border: '1px solid var(--mauve-4)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}>
                                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--mauve-12)' }}>
                                            {item.value}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--mauve-11)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Icon icon={item.icon} width={12} /> {item.label}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-m)' }}>
                            {/* Auto Cleanup Hero */}
                            <div style={{
                                background: 'linear-gradient(135deg, var(--green-3), var(--emerald-3))',
                                padding: 'var(--space-m)',
                                borderRadius: 'var(--radius-m)',
                                border: '1px solid var(--green-6)',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                textAlign: 'center',
                                gap: 'var(--space-s)'
                            }}>
                                <div style={{ background: 'var(--green-4)', padding: '8px', borderRadius: '50%' }}>
                                    <Icon icon="lucide:sparkles" width={24} style={{ color: 'var(--green-11)' }} />
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--green-12)' }}>Smart Cleanup</h3>
                                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--green-11)' }}>
                                        Keep 10 newest voices, delete the rest.
                                    </p>
                                </div>
                                <button
                                    onClick={handleAutoCleanup}
                                    disabled={cleaning}
                                    className="btn"
                                    style={{
                                        width: '100%',
                                        background: 'var(--green-9)',
                                        color: 'white',
                                        border: 'none'
                                    }}
                                >
                                    {cleaning ? 'Running...' : 'Run Auto Cleanup'}
                                </button>
                            </div>

                            <div style={{ background: 'var(--mauve-3)', height: '1px', margin: 'var(--space-s) 0' }} />

                            {/* Manual Cleanup - Voices */}
                            <h4 style={{ margin: 'var(--space-s) 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--mauve-11)' }}>Voices</h4>
                            {voiceCandidates && (
                                <>
                                    {voiceCandidates.old.length > 0 && (
                                        <CleanupRow
                                            title="Old Voices"
                                            meta="> 30 days"
                                            count={voiceCandidates.old.length}
                                            icon="lucide:calendar-clock"
                                            color="var(--yellow-9)"
                                            onClick={() => handleCleanup(voiceCandidates.old, 'old')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {voiceCandidates.unused.length > 0 && (
                                        <CleanupRow
                                            title="Unused"
                                            meta="Not played > 7 days"
                                            count={voiceCandidates.unused.length}
                                            icon="lucide:ghost"
                                            color="var(--orange-9)"
                                            onClick={() => handleCleanup(voiceCandidates.unused, 'unused')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {voiceCandidates.large.length > 0 && (
                                        <CleanupRow
                                            title="Large Voices"
                                            meta="Heavy audio files"
                                            count={voiceCandidates.large.length}
                                            icon="lucide:weight"
                                            color="var(--red-9)"
                                            onClick={() => handleCleanup(voiceCandidates.large, 'large')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {voiceCandidates.remaining.length > 0 && (
                                        <CleanupRow
                                            title="Other Voices"
                                            meta="Recently added / small"
                                            count={voiceCandidates.remaining.length}
                                            icon="lucide:mic"
                                            color="var(--mauve-9)"
                                            onClick={() => handleCleanup(voiceCandidates.remaining, 'other')}
                                            disabled={cleaning}
                                        />
                                    )}
                                </>
                            )}

                            {/* Manual Cleanup - Dubbing */}
                            <h4 style={{ margin: 'var(--space-m) 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--mauve-11)' }}>Dubbed Videos</h4>
                            {dubbingCandidates && (
                                <>
                                    {dubbingCandidates.old.length > 0 && (
                                        <CleanupRow
                                            title="Old Videos"
                                            meta="> 3 days"
                                            count={dubbingCandidates.old.length}
                                            icon="lucide:history"
                                            color="var(--blue-9)"
                                            onClick={() => handleDubbingCleanup(dubbingCandidates.old, 'old')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {dubbingCandidates.unused.length > 0 && (
                                        <CleanupRow
                                            title="Unused"
                                            meta="Not viewed > 1 day"
                                            count={dubbingCandidates.unused.length}
                                            icon="lucide:clock-9"
                                            color="var(--indigo-9)"
                                            onClick={() => handleDubbingCleanup(dubbingCandidates.unused, 'unused')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {dubbingCandidates.large.length > 0 && (
                                        <CleanupRow
                                            title="Large Media"
                                            meta="> 2MB or heavy"
                                            count={dubbingCandidates.large.length}
                                            icon="lucide:file-video"
                                            color="var(--pink-9)"
                                            onClick={() => handleDubbingCleanup(dubbingCandidates.large, 'large')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {dubbingCandidates.remaining.length > 0 && (
                                        <CleanupRow
                                            title="Recently Added"
                                            meta="Current session media"
                                            count={dubbingCandidates.remaining.length}
                                            icon="lucide:video"
                                            color="var(--mauve-9)"
                                            onClick={() => handleDubbingCleanup(dubbingCandidates.remaining, 'recent')}
                                            disabled={cleaning}
                                        />
                                    )}
                                </>
                            )}

                            {((!voiceCandidates || (voiceCandidates.old.length === 0 && voiceCandidates.unused.length === 0 && voiceCandidates.large.length === 0 && voiceCandidates.remaining.length === 0)) &&
                                (!dubbingCandidates || (dubbingCandidates.old.length === 0 && dubbingCandidates.unused.length === 0 && dubbingCandidates.large.length === 0 && dubbingCandidates.remaining.length === 0))) && (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0', color: 'var(--mauve-10)' }}>
                                        <Icon icon="lucide:check-circle-2" width={48} style={{ margin: '0 auto var(--space-s)', opacity: 0.5 }} />
                                        <p>Your storage is optimized!</p>
                                    </div>
                                )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Reusable Row Component for Cleaner UI
function CleanupRow({ title, meta, count, icon, color, onClick, disabled }: any) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--mauve-2)',
            border: '1px solid var(--mauve-5)',
            borderRadius: 'var(--radius-m)',
            padding: 'var(--space-m)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-m)' }}>
                <div style={{
                    width: 40, height: 40,
                    borderRadius: '8px',
                    background: 'var(--mauve-4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: color
                }}>
                    <Icon icon={icon} width={20} />
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--mauve-10)' }}>{count} items • {meta}</div>
                </div>
            </div>
            <button
                onClick={onClick}
                disabled={disabled}
                className="btn btn-sm"
                style={{ background: 'var(--mauve-4)', color: 'var(--mauve-12)', border: 'none' }}
            >
                Clear
            </button>
        </div>
    );
}