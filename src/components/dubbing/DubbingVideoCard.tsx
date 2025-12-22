import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';

// --- ICONS ---
const DownloadIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>;
const DeleteIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>;
const CloudIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>;
const DeviceIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;

// Mock types for demo
interface DubbingJob {
    id: string;
    status: 'processing' | 'completed' | 'failed';
    fileName?: string;
    originalMediaUrl?: string;
    finalMediaUrl?: string;
    clonedAudioUrl?: string;
    mediaType?: 'video' | 'audio';
}

interface DubbingVideoCardProps {
    job: DubbingJob;
    mainCharacter?: any;
    onPlay?: (jobId: string) => void;
    onDelete?: (jobId: string) => void;
}

export default function DubbingVideoCard({ job, mainCharacter, onPlay, onDelete }: DubbingVideoCardProps) {
    const isFailed = job.status === 'failed';
    const isCompleted = job.status === 'completed';
    const isProcessing = !isFailed && !isCompleted;
    const storageType = (job as any).storageType || 'local-only';

    const [activeLayer, setActiveLayer] = useState<'original' | 'dubbed'>(isProcessing ? 'original' : 'dubbed');
    const [localOriginalUrl, setLocalOriginalUrl] = useState<string | null>(null);
    const [localResultUrl, setLocalResultUrl] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);

    // Auto-switch to dubbed when completed (only once)
    const [hasAutoSwitched, setHasAutoSwitched] = useState(false);
    useEffect(() => {
        if (isCompleted && !hasAutoSwitched) {
            setActiveLayer('dubbed');
            setHasAutoSwitched(true);
        }
    }, [isCompleted, hasAutoSwitched]);

    // Mock media loading
    useEffect(() => {
        setLocalOriginalUrl(job.originalMediaUrl || null);
        setLocalResultUrl(job.finalMediaUrl || job.clonedAudioUrl || null);
    }, [job.id]);

    const handleLayerClick = (layer: 'original' | 'dubbed', e: React.MouseEvent) => {
        e.stopPropagation();
        if (activeLayer === layer) {
            if ((layer === 'dubbed' && isFailed) || isProcessing) {
                onPlay?.(job.id);
            }
            return;
        }
        setActiveLayer(layer);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete?.(job.id);
    };

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDownloading) return;
        const url = job.finalMediaUrl || job.clonedAudioUrl;
        if (!url) return;
        setIsDownloading(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch');
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            const ext = job.mediaType === 'audio' ? 'wav' : 'mp4';
            a.download = job.fileName || `dubbed_${job.id}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            alert("Download failed");
        } finally {
            setIsDownloading(false);
        }
    };

    const originalSrc = localOriginalUrl || job.originalMediaUrl;

    return (
        <div className="dub-video-stack">
            <div className="stack-viewport">
                {/* --- ORIGINAL LAYER --- */}
                <div
                    className={`video-card original ${activeLayer === 'original' ? 'front' : 'back'}`}
                    onClick={(e) => handleLayerClick('original', e)}
                >
                    <div className="glass-label">Original</div>
                    <div className="card-content">
                        {originalSrc ? (
                            <video
                                src={originalSrc}
                                controls={activeLayer === 'original'}
                                className="media-element"
                                preload="metadata"
                            />
                        ) : (
                            <div className="placeholder">
                                <Icon icon="lucide:video" width={32} className="text-mauve-8" />
                            </div>
                        )}

                        {/* Overlays */}
                        {activeLayer !== 'original' && <div className="inactive-overlay" />}
                        {isProcessing && activeLayer === 'original' && (
                            <div className="processing-overlay">
                                <div className="spinner-container">
                                    <Icon icon="lucide:loader-2" width={24} className="spin text-orange-9" />
                                </div>
                                <span>Processing...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* --- DUBBED LAYER --- */}
                {!isProcessing && (
                    <div
                        className={`video-card dubbed ${activeLayer === 'dubbed' ? 'front' : 'back'} ${isFailed ? 'failed-state' : ''}`}
                        onClick={(e) => handleLayerClick('dubbed', e)}
                    >
                        <div className="glass-label">Dubbed</div>
                        <div className="card-content">
                            {isFailed ? (
                                <div className="failed-placeholder">
                                    <div className="icon-circle fail">
                                        <Icon icon="lucide:alert-circle" width={20} className="text-red-9" />
                                    </div>
                                    <span className="fail-text">Generation Failed</span>
                                    <span className="fail-sub">Tap to retry</span>
                                </div>
                            ) : (
                                <video
                                    src={localResultUrl || job.finalMediaUrl || job.clonedAudioUrl}
                                    controls={activeLayer === 'dubbed'}
                                    className="media-element"
                                    preload="metadata"
                                />
                            )}
                            {activeLayer !== 'dubbed' && <div className="inactive-overlay" />}
                        </div>
                    </div>
                )}
            </div>

            {/* --- FOOTER --- */}
            <div className="card-footer">
                <div className="meta-group">
                    <span className="file-name" title={job.fileName}>{job.fileName || 'Untitled Project'}</span>
                    <div className="meta-badges">
                        {storageType === 'cloud' ? (
                            <span className="pill-badge cloud">
                                <CloudIcon /> iCloud
                            </span>
                        ) : (
                            <span className="pill-badge local">
                                <DeviceIcon /> On Device
                            </span>
                        )}
                    </div>
                </div>

                <div className="action-group">
                    {isCompleted && !isFailed && (
                        <button
                            className={`ios-btn ${isDownloading ? "pulse" : ""}`}
                            onClick={handleDownload}
                            disabled={isDownloading}
                        >
                            <DownloadIcon />
                        </button>
                    )}
                    <button className="ios-btn delete" onClick={handleDelete}>
                        <DeleteIcon />
                    </button>
                </div>
            </div>

            <style>{`
                /* Container */
                .dub-video-stack {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    gap: 12px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }

                /* The 3D Viewport - Extra padding at top for the peeking card */
                .stack-viewport {
                    position: relative;
                    width: 100%;
                    aspect-ratio: 16 / 9;
                    perspective: 1000px;
                    padding-top: 24px; /* Space for back card to peek out */
                }

                /* Base Card Styles */
                .video-card {
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: calc(100% - 24px); /* Account for the padding */
                    border-radius: 16px;
                    background: #000;
                    overflow: hidden;
                    border: 1px solid rgba(0,0,0,0.1);
                    transition: all 0.5s cubic-bezier(0.32, 0.72, 0, 1);
                    transform-origin: bottom center;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    cursor: pointer;
                    will-change: transform, opacity, filter;
                }

                /* Front State - Full visibility, covers back card */
                .video-card.front {
                    z-index: 10;
                    transform: translateY(0) scale(1);
                    opacity: 1;
                    filter: brightness(100%);
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
                }

                /* Back State - Peeks out from top, clearly visible and clickable */
                .video-card.back {
                    z-index: 1;
                    /* Move up so it peeks from the top */
                    transform: translateY(-34px) scale(0.96);
                    opacity: 0.9;
                    border-color: rgba(255,255,255,0.15);
                    /* Add top shadow to show depth */
                    box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
                }
                
                /* Make it obvious the back card is interactive */
                .video-card.back:hover {
                    transform: translateY(-28px) scale(0.97);
                    opacity: 1;
                    box-shadow: 0 -8px 20px rgba(0,0,0,0.2);
                }

                /* Content Areas */
                .card-content { 
                    width: 100%; 
                    height: 100%; 
                    position: relative; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    background: #1a1a1a; 
                }
                
                .media-element { 
                    width: 100%; 
                    height: 100%; 
                    object-fit: cover; 
                    display: block;
                }
                
                /* iOS Style Glass Labels */
                .glass-label {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    z-index: 20;
                    background: rgba(0, 0, 0, 0.4);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    color: rgba(255,255,255,0.9);
                    padding: 4px 10px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.3px;
                    pointer-events: none;
                    border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                /* Overlays */
                .inactive-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.3);
                    backdrop-filter: blur(2px);
                    -webkit-backdrop-filter: blur(2px);
                    z-index: 5;
                    transition: all 0.3s ease;
                }

                .processing-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.4);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    gap: 12px;
                    z-index: 10;
                    font-size: 13px;
                    font-weight: 500;
                }
                
                /* Placeholder / Fail States */
                .placeholder { 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    width: 100%; 
                    height: 100%; 
                    background: #2a2a2a; 
                }
                
                .failed-state { 
                    background: #2a2a2a; 
                    border: 1px solid #dc2626; 
                }
                
                .failed-placeholder { 
                    display: flex; 
                    flex-direction: column; 
                    align-items: center; 
                    gap: 6px; 
                }
                
                .icon-circle.fail { 
                    width: 36px; 
                    height: 36px; 
                    background: #fca5a5; 
                    border-radius: 50%; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    margin-bottom: 4px;
                }
                
                .fail-text { 
                    color: #f3f4f6; 
                    font-weight: 600; 
                    font-size: 13px; 
                }
                
                .fail-sub { 
                    color: #9ca3af; 
                    font-size: 11px; 
                }

                /* Footer Styling */
                .card-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0 2px;
                }

                .meta-group {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    flex: 1;
                    min-width: 0;
                    padding-right: 12px;
                }

                .file-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: #1f2937;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    letter-spacing: -0.01em;
                }

                .meta-badges { 
                    display: flex; 
                    gap: 8px; 
                }

                .pill-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    font-weight: 500;
                    color: #6b7280;
                }
                
                .pill-badge.cloud svg { color: #3b82f6; }
                .pill-badge.local svg { color: #f97316; }

                /* iOS Actions */
                .action-group { 
                    display: flex; 
                    gap: 10px; 
                    align-items: center; 
                }

                .ios-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: none;
                    background: #f3f4f6;
                    color: #6b7280;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                }
                
                .ios-btn:hover:not(:disabled) {
                    background: #e5e7eb;
                    color: #1f2937;
                    transform: scale(1.05);
                }
                
                .ios-btn:active:not(:disabled) {
                    transform: scale(0.92);
                }

                .ios-btn.delete:hover {
                    background: #fecaca;
                    color: #dc2626;
                }

                .pulse { 
                    animation: pulse 1.5s infinite ease-in-out; 
                    opacity: 0.7; 
                }
                
                .spin { 
                    animation: spin 1s linear infinite; 
                }
                
                @keyframes pulse { 
                    0% { transform: scale(1); } 
                    50% { transform: scale(0.9); opacity: 0.6; } 
                    100% { transform: scale(1); } 
                }
                
                @keyframes spin { 
                    from { transform: rotate(0deg); } 
                    to { transform: rotate(360deg); } 
                }
                
                .text-mauve-8 { color: #6b7280; }
                .text-orange-9 { color: #f97316; }
                .text-red-9 { color: #dc2626; }
            `}</style>
        </div>
    );
}

