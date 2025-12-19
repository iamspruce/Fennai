// src/islands/DubReviewModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';
import { getDubbingMedia } from '@/lib/db/indexdb';

export default function DubReviewModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [originalMediaUrl, setOriginalMediaUrl] = useState<string | null>(null);
    const originalUrlRef = useRef<string | null>(null);

    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setIsOpen(true);
        };
        window.addEventListener('open-dub-review', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-review', handleOpen as EventListener);
    }, []);

    useEffect(() => {
        if (!jobId) return;

        const unsubscribe = onSnapshot(
            doc(db, 'dubbingJobs', jobId),
            (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as DubbingJob;
                    setJob(data);

                    // If job is finished or failed, clear activeJob from localStorage
                    if (data.status === 'completed' || data.status === 'failed') {
                        const activeJobStr = localStorage.getItem('activeJob');
                        if (activeJobStr) {
                            const activeJob = JSON.parse(activeJobStr);
                            if (activeJob.jobId === jobId) {
                                localStorage.removeItem('activeJob');
                            }
                        }
                    }
                }
            }
        );

        return () => unsubscribe();
    }, [jobId]);

    // Fetch original media from IndexedDB
    useEffect(() => {
        if (!jobId || !isOpen) return;

        const loadOriginalMedia = async () => {
            try {
                const media = await getDubbingMedia(jobId);
                if (media) {
                    // Clean up previous URL
                    if (originalUrlRef.current) {
                        URL.revokeObjectURL(originalUrlRef.current);
                    }

                    // Create blob from stored data
                    const blob = new Blob([media.audioData], { type: media.audioType });
                    const url = URL.createObjectURL(blob);

                    originalUrlRef.current = url;
                    setOriginalMediaUrl(url);
                }
            } catch (error) {
                console.error('[DubReviewModal] Failed to load original media:', error);
            }
        };

        loadOriginalMedia();

        return () => {
            // Cleanup on unmount
            if (originalUrlRef.current) {
                URL.revokeObjectURL(originalUrlRef.current);
                originalUrlRef.current = null;
            }
        };
    }, [jobId, isOpen]);

    const handleDownloadAndDelete = async () => {
        if (!job?.finalMediaUrl) return;

        // Download
        window.open(job.finalMediaUrl, '_blank');

        // Delete job
        await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });

        setIsOpen(false);
    };

    const handleDownloadAndSave = async () => {
        if (!job?.finalMediaUrl) return;

        // Download
        window.open(job.finalMediaUrl, '_blank');

        setIsOpen(false);
    };

    if (!isOpen || !job) return null;

    const isComplete = job.status === 'completed';
    const progress = job.progress || 0;
    const currentMediaUrl = showOriginal ? originalMediaUrl : job.finalMediaUrl;

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-header">
                    <h3 className="modal-title">
                        {isComplete ? 'Dubbing Complete!' : 'Processing...'}
                    </h3>
                    {isComplete && (
                        <button className="modal-close" onClick={() => setIsOpen(false)}>
                            <Icon icon="lucide:x" width={20} />
                        </button>
                    )}
                </div>

                <div className="modal-body">
                    {!isComplete ? (
                        <div className="progress-section">
                            <div className="circular-progress">
                                <svg width="120" height="120" viewBox="0 0 120 120">
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r="54"
                                        fill="none"
                                        stroke="var(--mauve-4)"
                                        strokeWidth="8"
                                    />
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r="54"
                                        fill="none"
                                        stroke="var(--orange-9)"
                                        strokeWidth="8"
                                        strokeLinecap="round"
                                        strokeDasharray={`${2 * Math.PI * 54}`}
                                        strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress / 100)}`}
                                        transform="rotate(-90 60 60)"
                                    />
                                </svg>
                                <div className="progress-text">{progress}%</div>
                            </div>
                            <p className="progress-status">{job.step}</p>
                        </div>
                    ) : (
                        <>
                            {/* Media Preview with Tabs */}
                            <div className="preview-section">
                                <div className="preview-tabs">
                                    <button
                                        className={`preview-tab ${!showOriginal ? 'active' : ''}`}
                                        onClick={() => setShowOriginal(false)}
                                    >
                                        <Icon icon="lucide:sparkles" width={16} />
                                        Dubbed Version
                                    </button>
                                    <button
                                        className={`preview-tab ${showOriginal ? 'active' : ''}`}
                                        onClick={() => setShowOriginal(true)}
                                        disabled={!originalMediaUrl}
                                    >
                                        <Icon icon="lucide:file-audio" width={16} />
                                        Original
                                    </button>
                                </div>

                                <div className="media-container">
                                    {job.mediaType === 'video' ? (
                                        <video
                                            key={currentMediaUrl} // Force reload when switching
                                            controls
                                            src={currentMediaUrl || undefined}
                                            className="media-player"
                                        />
                                    ) : (
                                        <audio
                                            key={currentMediaUrl}
                                            controls
                                            src={currentMediaUrl || undefined}
                                            className="media-player"
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="action-buttons">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleDownloadAndDelete}
                                >
                                    <Icon icon="lucide:download" width={18} />
                                    Download & Delete
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleDownloadAndSave}
                                >
                                    <Icon icon="lucide:download" width={18} />
                                    Download & Save
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <style>{`
                .preview-section {
                    margin-bottom: var(--space-m);
                }

                .preview-tabs {
                    display: flex;
                    gap: var(--space-2xs);
                    margin-bottom: var(--space-m);
                    background: var(--mauve-3);
                    padding: 4px;
                    border-radius: var(--radius-m);
                }

                .preview-tab {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-2xs);
                    padding: var(--space-xs) var(--space-s);
                    background: transparent;
                    border: none;
                    border-radius: var(--radius-s);
                    color: var(--mauve-11);
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .preview-tab:hover:not(:disabled) {
                    background: var(--mauve-4);
                    color: var(--mauve-12);
                }

                .preview-tab.active {
                    background: white;
                    color: var(--orange-9);
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
                }

                .preview-tab:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .media-container {
                    background: var(--mauve-2);
                    border-radius: var(--radius-m);
                    padding: var(--space-s);
                    min-height: 200px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .media-player {
                    width: 100%;
                    border-radius: var(--radius-m);
                }

                .action-buttons {
                    display: flex;
                    gap: var(--space-s);
                    margin-top: var(--space-m);
                }

                .btn {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-xs);
                    padding: var(--space-s);
                    border-radius: var(--radius-m);
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                }

                .btn-primary {
                    background: var(--orange-9);
                    color: white;
                }

                .btn-primary:hover {
                    background: var(--orange-10);
                }

                .btn-secondary {
                    background: var(--mauve-3);
                    color: var(--mauve-12);
                    border: 1px solid var(--mauve-6);
                }

                .btn-secondary:hover {
                    background: var(--mauve-4);
                }

                .progress-section {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--space-m);
                    padding: var(--space-xl) 0;
                }

                .circular-progress {
                    position: relative;
                }

                .progress-text {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-size: var(--step-2);
                    font-weight: 700;
                    color: var(--orange-9);
                }

                .progress-status {
                    font-size: 14px;
                    color: var(--mauve-11);
                    text-align: center;
                }
            `}</style>
        </div>
    );
}