// src/components/dubbing/DubbingVideoCard.tsx
import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { DubbingJob } from '@/types/dubbing';

interface DubbingVideoCardProps {
    job: DubbingJob;
    onPlay?: (jobId: string) => void;
    onDelete?: (jobId: string) => void;
}

export default function DubbingVideoCard({ job, onPlay, onDelete }: DubbingVideoCardProps) {
    const [showOriginal, setShowOriginal] = useState(false);

    const handleCardClick = () => {
        // Toggle between original and dubbed
        setShowOriginal(!showOriginal);
    };

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onPlay?.(job.id);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete this dubbed media?')) {
            onDelete?.(job.id);
        }
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="dubbing-video-card-container">
            <div
                className={`dubbing-video-card ${showOriginal ? 'show-original' : 'show-dubbed'}`}
                onClick={handleCardClick}
            >
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

                {/* Action Buttons */}
                <div className="card-actions">
                    <button
                        className="card-action-btn play-btn"
                        onClick={handlePlayClick}
                        title="Play"
                    >
                        <Icon icon="lucide:play" width={18} />
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

                .card-meta {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2xs);
                    font-size: 12px;
                    color: var(--mauve-11);
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

                @media (max-width: 768px) {
                    .card-actions {
                        opacity: 1;
                    }
                }
            `}</style>
        </div>
    );
}
