// src/components/StorageManager.tsx
import { useState, useEffect } from 'react';
import {
    getStorageStats,
    getStorageQuota,
    getVoicesForCleanup,
    autoCleanupOldVoices,
    deleteVoicesBatch,
    formatBytes,
    type VoiceRecord,
} from '@/lib/db/indexdb';
import '@/styles/modal.css'; // ← your beautiful modal styles

export default function StorageManager() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<Awaited<ReturnType<typeof getStorageStats>> | null>(null);
    const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof getVoicesForCleanup>> | null>(null);
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
            const [storageStats, cleanupData] = await Promise.all([
                getStorageStats(),
                getVoicesForCleanup(),
            ]);
            setStats(storageStats);
            setCandidates(cleanupData);
        } catch (err) {
            console.error('Failed to load storage data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAutoCleanup = async () => {
        if (!confirm('Run automatic cleanup?\n\nOld voices will be removed, keeping your 10 most recent ones.')) return;
        setCleaning(true);
        try {
            const result = await autoCleanupOldVoices();
            alert(`Cleaned up ${result.deletedCount} voices → freed ${formatBytes(result.freedSpace)}`);
            await loadData();
        } catch {
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

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
            <div
                className="modal-content modal-wide modal-tall"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '900px' }}
            >
                {/* Header */}
                <div className="modal-header">
                    <h2 style={{ fontSize: 'var(--step-2)', fontWeight: 600, margin: 0 }}>
                        Storage Manager
                    </h2>
                    <button
                        className="modal-close"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close"
                    >
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--mauve-6)', marginBottom: 'var(--space-m)' }}>
                    {(['overview', 'cleanup'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setSelectedTab(tab)}
                            style={{
                                padding: 'var(--space-s) var(--space-l)',
                                fontWeight: selectedTab === tab ? 600 : 500,
                                color: selectedTab === tab ? 'var(--pink-11)' : 'var(--mauve-11)',
                                borderBottom: selectedTab === tab ? '2px solid var(--pink-9)' : 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: 'var(--step-0)',
                            }}
                        >
                            {tab === 'overview' ? 'Overview' : 'Free Up Space'}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ padding: '0 var(--space-m) var(--space-m)' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                            <div className="btn btn-primary btn-sm" style={{ width: 48, height: 48, margin: '0 auto var(--space-m)' }}>
                                <svg className="animate-spin" width="24" height="24" fill="none" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.3" />
                                    <path fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-8 8 8 8 0 01-8-8z" />
                                </svg>
                            </div>
                            <p style={{ color: 'var(--mauve-11)' }}>Loading storage info...</p>
                        </div>
                    ) : selectedTab === 'overview' ? (
                        <div style={{ display: 'grid', gap: 'var(--space-l)' }}>
                            {/* Quota Bar */}
                            <div style={{
                                background: 'var(--mauve-3)',
                                padding: 'var(--space-m)',
                                borderRadius: 'var(--radius-m)',
                                border: '1px solid var(--mauve-6)',
                            }}>
                                <div style={{ marginBottom: 'var(--space-s)', fontWeight: 600 }}>Browser Storage Used</div>
                                <div style={{ fontSize: 'var(--step-1)', marginBottom: 'var(--space-xs)' }}>
                                    {formatBytes(stats!.quota.usage)} of ~{formatBytes(stats!.quota.quota)}
                                    <span style={{ float: 'right', color: stats!.quota.percentUsed >= 80 ? 'var(--red-11)' : 'var(--mauve-11)' }}>
                                        {stats!.quota.percentUsed.toFixed(1)}%
                                    </span>
                                </div>
                                <div style={{ height: 12, background: 'var(--mauve-5)', borderRadius: 'var(--radius-s)', overflow: 'hidden' }}>
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${Math.min(stats!.quota.percentUsed, 100)}%`,
                                            background: stats!.quota.percentUsed >= 95 ? 'var(--red-9)' :
                                                stats!.quota.percentUsed >= 80 ? 'var(--yellow-9)' : 'var(--green-9)',
                                            transition: 'width 0.6s ease',
                                        }}
                                    />
                                </div>
                                <div style={{ fontSize: 'var(--step--1)', color: 'var(--mauve-11)', marginTop: 'var(--space-xs)' }}>
                                    {formatBytes(stats!.quota.available)} available
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-m)' }}>
                                {[
                                    { label: 'Total Voices', value: stats!.voiceCount },
                                    { label: 'Total Size', value: formatBytes(stats!.totalSize) },
                                    { label: 'Average Size', value: formatBytes(stats!.averageSize) },
                                    { label: 'Cloud Voices', value: stats!.cloudStorageCount },
                                ].map(item => (
                                    <div key={item.label} style={{
                                        background: 'var(--mauve-3)',
                                        padding: 'var(--space-m)',
                                        borderRadius: 'var(--radius-m)',
                                        textAlign: 'center',
                                        border: '1px solid var(--mauve-6)',
                                    }}>
                                        <div style={{ fontSize: 'var(--step-2)', fontWeight: 700, color: 'var(--mauve-12)' }}>
                                            {item.value}
                                        </div>
                                        <div style={{ fontSize: 'var(--step--1)', color: 'var(--mauve-11)' }}>
                                            {item.label}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: 'var(--space-l)' }}>
                            {/* Auto Cleanup */}
                            <div style={{
                                background: 'linear-gradient(135deg, var(--green-3), var(--emerald-3))',
                                padding: 'var(--space-l)',
                                borderRadius: 'var(--radius-l)',
                                border: '1px solid var(--green-7)',
                                textAlign: 'center',
                            }}>
                                <h3 style={{ margin: '0 0 var(--space-s)', fontSize: 'var(--step-1)' }}>Smart Auto Cleanup</h3>
                                <p style={{ margin: '0 0 var(--space-m)', fontSize: 'var(--step--1)', color: 'var(--mauve-11)' }}>
                                    Removes voices older than 30 days (keeps your 10 newest)
                                </p>
                                <button
                                    onClick={handleAutoCleanup}
                                    disabled={cleaning}
                                    className="btn btn-primary btn-sm"
                                >
                                    {cleaning ? 'Cleaning...' : 'Run Auto Cleanup'}
                                </button>
                            </div>

                            {/* Manual Cleanup Cards */}
                            {candidates && (
                                <>
                                    {candidates.old.length > 0 && (
                                        <CleanupCard
                                            title="Old Voices"
                                            count={candidates.old.length}
                                            desc="Older than 30 days"
                                            color="var(--yellow-9)"
                                            onClick={() => handleCleanup(candidates.old, 'old')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {candidates.unused.length > 0 && (
                                        <CleanupCard
                                            title="Unused Voices"
                                            count={candidates.unused.length}
                                            desc="Not played in 7+ days"
                                            color="var(--orange-9)"
                                            onClick={() => handleCleanup(candidates.unused, 'unused')}
                                            disabled={cleaning}
                                        />
                                    )}
                                    {candidates.large.length > 0 && (
                                        <CleanupCard
                                            title="Large Files"
                                            count={candidates.large.length}
                                            desc="Significantly bigger than average"
                                            color="var(--red-9)"
                                            onClick={() => handleCleanup(candidates.large, 'large')}
                                            disabled={cleaning}
                                        />
                                    )}
                                </>
                            )}

                            {candidates && candidates.old.length === 0 && candidates.unused.length === 0 && candidates.large.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                                    <div style={{ width: 80, height: 80, background: 'var(--green-4)', borderRadius: '50%', margin: '0 auto var(--space-l)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <svg width="40" height="40" fill="none" stroke="var(--green-11)" strokeWidth="3" viewBox="0 0 24 24">
                                            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <p style={{ fontSize: 'var(--step-1)', fontWeight: 600 }}>All clear!</p>
                                    <p style={{ color: 'var(--mauve-11)' }}>Your storage is perfectly organized.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Reusable card
function CleanupCard({ title, count, desc, color, onClick, disabled }: {
    title: string; count: number; desc: string; color: string; onClick: () => void; disabled: boolean;
}) {
    return (
        <div style={{
            background: 'var(--mauve-2)',
            border: '1px solid var(--mauve-6)',
            borderRadius: 'var(--radius-l)',
            padding: 'var(--space-l)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-s)',
        }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--step-0)' }}>{title}</div>
            <div style={{ fontSize: 'var(--step--1)', color: 'var(--mauve-11)' }}>
                {count} voices • {desc}
            </div>
            <button
                onClick={onClick}
                disabled={disabled}
                className="btn btn-primary btn-sm"
            >
                {disabled ? 'Deleting...' : 'Delete These Voices'}
            </button>
        </div>
    );
}