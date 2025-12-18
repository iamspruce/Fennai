// src/components/dubbing/DubbingVideoCard.tsx
import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { DubbingJob } from '@/types/dubbing';

interface DubbingVideoCardProps {
    job: DubbingJob;
    onPlay?: (jobId: string) => void;
    onDelete?: (jobId: string) => void;
    onAction?: (jobId: string, status: string) => void;
}

export default function DubbingVideoCard({ job, onPlay, onDelete, onAction }: DubbingVideoCardProps) {
    const [showOriginal, setShowOriginal] = useState(false);

    const isCompleted = job.status === 'completed';
    const isFailed = job.status === 'failed';
    const isTranscribingDone = job.status === 'transcribing_done';
    const isRetrying = job.status === 'retrying';
    const isProcessing = ['uploading', 'processing', 'extracting', 'transcribing', 'clustering', 'translating', 'cloning', 'merging'].includes(job.status || '');

    const handleCardClick = () => {
        if (!isCompleted) {
            handleActionClick();
            return;
        }
        // Toggle between original and dubbed only if completed
        setShowOriginal(!showOriginal);
    };

    const handleActionClick = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();

        // If transcribing is done or processing, open settings/progress
        if (isTranscribingDone || isProcessing || isRetrying) {
            window.dispatchEvent(new CustomEvent('open-dub-settings', {
                detail: { jobId: job.id }
            }));
        } else if (isFailed) {
            // If failed, we might want a specific retry logic, but for now 
            // reopening settings is a good start if it failed during user flow
            // or we can add a retry handler
            onAction?.(job.id, 'retry');
        } else if (isCompleted) {
            onPlay?.(job.id);
        }
    };

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isCompleted) {
            onPlay?.(job.id);
        } else {
            handleActionClick(e);
        }
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete this dubbing job?')) {
            onDelete?.(job.id);
        }
    };

    const formatDuration = (seconds: number) => {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const getStatusText = () => {
        if (isRetrying) return 'Something went wrong, retrying...';
        if (isFailed) return 'Failed';
        if (isTranscribingDone) return 'Ready for Settings';

        switch (job.status) {
            case 'uploading': return 'Uploading...';
            case 'processing': return 'Initializing...';
            case 'extracting': return 'Extracting Audio...';
            case 'transcribing': return 'Transcribing...';
            case 'clustering': return 'Analyzing Speakers...';
            case 'translating': return 'Translating...';
            case 'cloning': return 'Synthesizing...';
            case 'merging': return 'Finalizing...';
            default: return job.status || 'Processing...';
        }
    };

    const renderProcessingState = () => (
        <div className="card-layer processing-layer">
            <div className="card-thumbnail">
                {isRetrying ? (
                    <Icon icon="lucide:refresh-cw" width={48} className="spin text-amber-500" />
                ) : (
                    <Icon icon="lucide:loader-2" width={48} className="spin primary-color" />
                )}

                <div className="card-badge processing-badge">
                    {isFailed ? 'Error' : isRetrying ? 'Retrying' : 'Processing'}
                </div>
            </div>
            <div className="card-content">
                <h4 className="card-title">{job.fileName || 'Untitled'}</h4>
                <div className="processing-info">
                    <p className="status-text">{getStatusText()}</p>
                    {job.progress !== undefined && (
                        <div className="mini-progress-bar">
                            <div className="fill" style={{ width: `${job.progress}%` }} />
                        </div>
                    )}
                </div>
                <div className="card-meta">
                    <span>{formatDate(job.createdAt)}</span>
                    {isFailed && <span className="error-hint">• Click to retry</span>}
                    {isTranscribingDone && <span className="ready-hint">• Click to continue</span>}
                </div>
            </div>
        </div>
    );

    return (
        <div className={`dubbing-video-card-container ${!isCompleted ? 'is-incomplete' : ''}`}>
            <div
                className={`dubbing-video-card ${isCompleted ? (showOriginal ? 'show-original' : 'show-dubbed') : 'show-processing'}`}
                onClick={handleCardClick}
            >
                {isCompleted ? (
                    <>
                        {/* Dubbed Version (Top Card) */}
                        <div className="card-layer dubbed-layer">
                            <div className="card-thumbnail">
                                {job.mediaType === 'video' ? (
                                    <Icon icon="lucide:video" width={32} />
                                ) : (
                                    <Icon icon="lucide:music" width={32} />
                                )}
                                <div className="card-badge dubbed-badge">
                                    <Icon icon="lucide:sparkles" width={12} />
                                    Dubbed
                                </div>
                            </div>
                            <div className="card-content">
                                <h4 className="card-title">{job.fileName || 'Untitled'}</h4>
                                <div className="card-meta">
                                    <span>{formatDuration(job.duration || 0)}</span>
                                    <span>•</span>
                                    <span>{formatDate(job.createdAt)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Original Version (Bottom Card) */}
                        <div className="card-layer original-layer">
                            <div className="card-thumbnail">
                                {job.mediaType === 'video' ? (
                                    <Icon icon="lucide:video" width={32} />
                                ) : (
                                    <Icon icon="lucide:music" width={32} />
                                )}
                                <div className="card-badge original-badge">
                                    <Icon icon="lucide:file-audio" width={12} />
                                    Original
                                </div>
                            </div>
                            <div className="card-content">
                                <h4 className="card-title">{job.fileName || 'Untitled'}</h4>
                                <div className="card-meta">
                                    <span>{formatDuration(job.duration || 0)}</span>
                                    <span>•</span>
                                    <span>{formatDate(job.createdAt)}</span>
                                </div>
                            </div>
                        </div>
                    </>
                ) : renderProcessingState()}

                {/* Action Buttons */}
                <div className="card-actions">
                    <button
                        className="card-action-btn play-btn"
                        onClick={handlePlayClick}
                        title={isCompleted ? "Play" : "Resume"}
                    >
                        <Icon icon={isCompleted ? "lucide:play" : (isFailed ? "lucide:refresh-cw" : "lucide:external-link")} width={18} />
                    </button>
                    <button
                        className="card-action-btn delete-btn"
                        onClick={handleDeleteClick}
                        title="Delete"
                    >
                        <Icon icon="lucide:trash-2" width={18} />
                    </button>
                </div>
            </div>

            <style>{`
                .dubbing-video-card-container {
                    position: relative;
                    width: 100%;
                    aspect-ratio: 16 / 9;
                    min-height: 200px;
                }

                .dubbing-video-card {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    cursor: pointer;
                    perspective: 1000px;
                }

                .card-layer {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    background: var(--mauve-2);
                    border: 1px solid var(--mauve-6);
                    border-radius: var(--radius-l);
                    overflow: hidden;
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    flex-direction: column;
                }

                /* Dubbed Layer (Top) */
                .dubbed-layer {
                    z-index: 2;
                    transform: translateY(-8px) translateX(8px) rotate(2deg);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                }

                .show-dubbed .dubbed-layer {
                    transform: translateY(0) translateX(0) rotate(0deg);
                    z-index: 3;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
                }

                .show-original .dubbed-layer {
                    transform: translateY(8px) translateX(-8px) rotate(-2deg);
                    z-index: 1;
                    opacity: 0.7;
                }

                /* Original Layer (Bottom) */
                .original-layer {
                    z-index: 1;
                    transform: translateY(8px) translateX(-8px) rotate(-2deg);
                    opacity: 0.7;
                }

                .show-original .original-layer {
                    transform: translateY(0) translateX(0) rotate(0deg);
                    z-index: 3;
                    opacity: 1;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
                }

                .show-dubbed .original-layer {
                    transform: translateY(8px) translateX(-8px) rotate(-2deg);
                    z-index: 1;
                }

                .processing-layer {
                    z-index: 3;
                    border-style: dashed;
                    border-width: 2px;
                }

                .card-thumbnail {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, var(--mauve-3), var(--mauve-4));
                    color: var(--mauve-9);
                    position: relative;
                }

                .card-badge {
                    position: absolute;
                    top: var(--space-xs);
                    right: var(--space-xs);
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    border-radius: var(--radius-s);
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .dubbed-badge {
                    background: var(--orange-9);
                    color: white;
                }

                .original-badge {
                    background: var(--mauve-12);
                    color: white;
                }

                .processing-badge {
                    background: var(--mauve-6);
                    color: var(--mauve-11);
                }

                .card-content {
                    padding: var(--space-s);
                    background: white;
                    border-top: 1px solid var(--mauve-6);
                }

                .card-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--mauve-12);
                    margin: 0 0 4px 0;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .processing-info {
                    margin-bottom: var(--space-xs);
                }

                .status-text {
                    font-size: 13px;
                    color: var(--orange-11);
                    font-weight: 500;
                    margin: 0 0 4px 0;
                }

                .mini-progress-bar {
                    width: 100%;
                    height: 4px;
                    background: var(--mauve-4);
                    border-radius: 2px;
                    overflow: hidden;
                }

                .mini-progress-bar .fill {
                    height: 100%;
                    background: var(--orange-9);
                    transition: width 0.3s ease;
                }

                .card-meta {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2xs);
                    font-size: 12px;
                    color: var(--mauve-11);
                }

                .error-hint {
                    color: var(--red-11);
                    font-weight: 500;
                }

                .ready-hint {
                    color: var(--green-11);
                    font-weight: 500;
                }

                .card-actions {
                    position: absolute;
                    bottom: var(--space-s);
                    left: var(--space-s);
                    display: flex;
                    gap: var(--space-2xs);
                    z-index: 10;
                    opacity: 0;
                    transition: opacity 0.2s;
                }

                .dubbing-video-card:hover .card-actions {
                    opacity: 1;
                }

                .card-action-btn {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: white;
                    border: 1px solid var(--mauve-6);
                    border-radius: var(--radius-m);
                    color: var(--mauve-12);
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }

                .card-action-btn:hover {
                    transform: scale(1.1);
                }

                .play-btn:hover {
                    background: var(--orange-9);
                    color: white;
                    border-color: var(--orange-9);
                }

                .delete-btn:hover {
                    background: var(--red-9);
                    color: white;
                    border-color: var(--red-9);
                }

                .spin {
                    animation: spin 2s linear infinite;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                @media (max-width: 768px) {
                    .card-actions {
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}
