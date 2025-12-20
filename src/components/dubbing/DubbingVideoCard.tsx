import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { DubbingJob } from '@/types/dubbing';
import { getDubbingMedia } from '@/lib/db/indexdb';

// REFINED ICONS: Thinner strokes (1.5) and rounded caps for iOS look (Copied from VoiceCard.tsx)
const DownloadIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>;
const DeleteIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>;

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

    const [activeLayer, setActiveLayer] = useState<'original' | 'dubbed'>(isProcessing ? 'original' : 'dubbed');
    const [localOriginalUrl, setLocalOriginalUrl] = useState<string | null>(null);
    const [localResultUrl, setLocalResultUrl] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);

    // Load local media from IndexedDB
    useEffect(() => {
        let originalObjectUrl: string | null = null;
        let resultObjectUrl: string | null = null;

        const loadLocal = async () => {
            try {
                const record = await getDubbingMedia(job.id);
                if (!record) return;

                // 1. Load Original Media
                if (record.videoData) {
                    originalObjectUrl = URL.createObjectURL(new Blob([record.videoData], { type: record.videoType || 'video/mp4' }));
                    setLocalOriginalUrl(originalObjectUrl);
                } else if (record.audioData) {
                    const type = record.audioType || (record.mediaType === 'video' ? 'video/mp4' : 'audio/wav');
                    originalObjectUrl = URL.createObjectURL(new Blob([record.audioData], { type }));
                    setLocalOriginalUrl(originalObjectUrl);
                }

                // 2. Load Dubbed Result Media
                if (record.resultVideoData) {
                    resultObjectUrl = URL.createObjectURL(new Blob([record.resultVideoData], { type: record.resultVideoType || 'video/mp4' }));
                    setLocalResultUrl(resultObjectUrl);
                } else if (record.resultAudioData) {
                    const type = record.resultAudioType || (record.mediaType === 'video' ? 'video/mp4' : 'audio/wav');
                    resultObjectUrl = URL.createObjectURL(new Blob([record.resultAudioData], { type }));
                    setLocalResultUrl(resultObjectUrl);
                }

            } catch (e) {
                console.error('Error loading local media:', e);
            }
        };

        loadLocal();

        return () => {
            if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl);
            if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
        };
    }, [job.id]);

    // Automatically switch to dubbed view when job completes
    useEffect(() => {
        if (isCompleted) {
            setActiveLayer('dubbed');
        }
    }, [isCompleted]);

    // Toggle active layer
    const handleLayerClick = (layer: 'original' | 'dubbed', e: React.MouseEvent) => {
        e.stopPropagation();

        // If we are clicking the Fone already in front:
        if (activeLayer === layer) {
            // If it's processing or failed (and we clicked the failed card), trigger the parent action (Resume/Retry)
            if (layer === 'dubbed' && isFailed) {
                onPlay?.(job.id);
                return;
            }
            if (isProcessing) {
                onPlay?.(job.id);
                return;
            }
            // If completed or playing original, just let the video interactions happen
            return;
        }

        // If clicking the back card, bring to front
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
            // Use mp4 for video, wav for audio/voice? Assume video usually given context
            const ext = job.mediaType === 'audio' ? 'wav' : 'mp4';
            a.download = job.fileName || `dubbed_${job.id}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (err) {
            alert("Download failed");
            console.error(err);
        } finally {
            setIsDownloading(false);
        }
    };

    const originalSrc = localOriginalUrl || job.originalMediaUrl;

    return (
        <div className="dub-video-stack">
            <div className="stack-container">
                {/* Original Video Layer */}
                <div
                    className={`video-card original ${activeLayer === 'original' ? 'front' : 'back'}`}
                    onClick={(e) => handleLayerClick('original', e)}
                >
                    <div className="card-content">
                        {originalSrc ? (
                            <div className="video-wrapper">
                                <video
                                    src={originalSrc}
                                    controls={activeLayer === 'original'}
                                    className="media-element"
                                    preload="metadata"
                                >
                                    Your browser does not support the video tag.
                                </video>
                                {/* Overlay for back state or processing state if we want to block controls */}
                                {activeLayer !== 'original' && <div className="click-overlay" />}
                                {isProcessing && activeLayer === 'original' && (
                                    <div className="processing-overlay">
                                        <Icon icon="lucide:loader-2" width={40} className="spin text-orange-9" />
                                        <span>Processing...</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="placeholder">
                                <Icon icon="lucide:video" width={32} />
                                <span>Original</span>
                            </div>
                        )}
                        <span className="layer-label">Original</span>
                    </div>
                </div>

                {/* Dubbed Video Layer (Only show if not processing, i.e., completed or failed) */}
                {!isProcessing && (
                    <div
                        className={`video-card dubbed ${activeLayer === 'dubbed' ? 'front' : 'back'} ${isFailed ? 'failed-state' : ''}`}
                        onClick={(e) => handleLayerClick('dubbed', e)}
                    >
                        <div className="card-content">
                            {isFailed ? (
                                <div className="failed-placeholder">
                                    <Icon icon="lucide:alert-circle" width={40} className="text-red-9" />
                                    <span>Generation Failed</span>
                                    <span className="sub">Click to retry</span>
                                </div>
                            ) : (
                                <div className="video-wrapper">
                                    <video
                                        src={localResultUrl || job.finalMediaUrl || job.clonedAudioUrl}
                                        controls={activeLayer === 'dubbed'}
                                        className="media-element"
                                        preload="metadata"
                                    >
                                        Your browser does not support the video tag.
                                    </video>
                                    {activeLayer !== 'dubbed' && <div className="click-overlay" />}
                                </div>
                            )}
                            <span className="layer-label">Dubbed</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="card-footer">
                <span className="file-name" title={job.fileName}>{job.fileName || ''}</span>

                <div className="voice-actions">
                    {/* Only show download if completed and not failed */}
                    {isCompleted && !isFailed && (
                        <button
                            className={`action-btn ${isDownloading ? "downloading" : ""}`}
                            onClick={handleDownload}
                            disabled={isDownloading}
                            title="Download"
                        >
                            <DownloadIcon />
                        </button>
                    )}
                    <button
                        className="action-btn delete"
                        onClick={handleDelete}
                        title="Delete"
                    >
                        <DeleteIcon />
                    </button>
                </div>
            </div>

            <style>{`
                .dub-video-stack {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    width: 100%;
                }
                
                /* Re-use voice-actions styles for consistency with VoiceCard */
                .voice-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .action-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 1px solid var(--mauve-6);
                    background: white;
                    color: var(--mauve-11);
                    cursor: pointer;
                    transition: all 0.2s;
                    padding: 0;
                }
                
                .action-btn:hover:not(:disabled) {
                    background: var(--mauve-3);
                    color: var(--mauve-12);
                    transform: scale(1.05);
                }
                
                .action-btn.delete:hover {
                    background: var(--red-3);
                    color: var(--red-9);
                    border-color: var(--red-6);
                }
                
                .action-btn.downloading {
                    animation: pulse 1s infinite;
                    opacity: 0.7;
                }
                
                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(0.95); opacity: 0.5; }
                    100% { transform: scale(1); }
                }

                .stack-container {
                    position: relative;
                    width: 100%;
                    aspect-ratio: 16 / 10;
                    margin-bottom: 8px; 
                }

                .video-card {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    border-radius: var(--radius-l);
                    overflow: hidden;
                    background: black;
                    border: 1px solid var(--mauve-6);
                    transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    cursor: pointer;
                }

                .video-card.front {
                    z-index: 10;
                    transform: translate(0, 0) scale(1);
                    opacity: 1;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                }

                .video-card.back {
                    z-index: 1;
                    opacity: 0.7;
                    filter: grayscale(0.4);
                }

                /* Layout specific transforms */
                .video-card.original.back {
                    transform: translate(15px, 15px) rotate(3deg);
                }
                .video-card.dubbed.back {
                    transform: translate(-10px, 10px) rotate(-3deg);
                }

                /* Interaction hover for back cards */
                .video-card.back:hover {
                    opacity: 0.9;
                    filter: grayscale(0);
                    transform: translate(10px, 10px) rotate(0deg); /* Peek out */
                    z-index: 5;
                }

                .card-content {
                    width: 100%;
                    height: 100%;
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .video-wrapper {
                    width: 100%;
                    height: 100%;
                    background: black;
                }

                .media-element {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .click-overlay {
                    position: absolute;
                    inset: 0;
                    z-index: 2; /* Content is z-0 or z-1 */
                    background: transparent;
                }

                .processing-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.6);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    gap: 8px;
                    z-index: 3;
                    backdrop-filter: blur(2px);
                }

                .failed-state {
                    background: var(--mauve-2);
                    border-color: var(--red-6);
                }

                .failed-placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    color: var(--mauve-11);
                }

                .failed-placeholder .sub {
                    font-size: 12px;
                    opacity: 0.8;
                }

                .layer-label {
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    background: rgba(0, 0, 0, 0.6);
                    color: white;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    text-transform: uppercase;
                    font-weight: 600;
                    backdrop-filter: blur(4px);
                    pointer-events: none;
                }

                .card-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0 4px;
                }

                .file-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--mauve-12);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 70%;
                }

                .text-orange-9 { color: var(--orange-9); }
                .text-red-9 { color: var(--red-9); }
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}
