// src/islands/DubReviewModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';

export default function DubReviewModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);

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
                    setJob(snapshot.data() as DubbingJob);
                }
            }
        );

        return () => unsubscribe();
    }, [jobId]);

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

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-header">
                    <h3 className="modal-title">
                        {isComplete ? 'Dubbing Complete!' : 'Processing...'}
                    </h3>
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
                                        stroke="var(--pink-9)"
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
                            {/* Media Preview */}
                            <div className="preview-toggle">
                                <button
                                    className={!showOriginal ? 'active' : ''}
                                    onClick={() => setShowOriginal(false)}
                                >
                                    Dubbed Version
                                </button>
                                <button
                                    className={showOriginal ? 'active' : ''}
                                    onClick={() => setShowOriginal(true)}
                                >
                                    Original
                                </button>
                            </div>

                            {job.mediaType === 'video' ? (
                                <video
                                    controls
                                    src={showOriginal ? job.originalMediaUrl : job.finalMediaUrl}
                                    style={{ width: '100%', borderRadius: 'var(--radius-m)' }}
                                />
                            ) : (
                                <audio
                                    controls
                                    src={showOriginal ? job.audioUrl : job.finalMediaUrl}
                                    style={{ width: '100%' }}
                                />
                            )}

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
        </div>
    );
}