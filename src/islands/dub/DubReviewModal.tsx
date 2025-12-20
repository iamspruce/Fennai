// src/islands/DubReviewModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';
import { getDubbingMedia } from '@/lib/db/indexdb';
import AudioPlayer from '@/components/ui/AudioPlayer';

export default function DubReviewModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [mainCharacter, setMainCharacter] = useState<any>(null);
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [originalMediaUrl, setOriginalMediaUrl] = useState<string | null>(null);
    const originalUrlRef = useRef<string | null>(null);

    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setMainCharacter(e.detail.mainCharacter);
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

        const hasAutoSavedRef = useRef(false);

        // Auto-save logic (Same logic as voices)
        useEffect(() => {
            if (!job || job.status !== 'completed' || !job.finalMediaUrl || !mainCharacter || hasAutoSavedRef.current) return;

            const performAutoSave = async () => {
                // Only auto-save if saveAcrossBrowsers is false (Local-only logic)
                if (mainCharacter.saveAcrossBrowsers === false) {
                    console.log('[DubReviewModal] Auto-saving local-only dubbed video...');
                    hasAutoSavedRef.current = true;

                    try {
                        const response = await fetch(job.finalMediaUrl!);
                        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

                        const blob = await response.blob();
                        const arrayBuffer = await blob.arrayBuffer();

                        const { saveDubbingResult } = await import('@/lib/db/indexdb');
                        await saveDubbingResult({
                            id: jobId,
                            resultAudioData: job.mediaType === 'audio' ? arrayBuffer : undefined,
                            resultAudioType: job.mediaType === 'audio' ? blob.type : undefined,
                            resultVideoData: job.mediaType === 'video' ? arrayBuffer : undefined,
                            resultVideoType: job.mediaType === 'video' ? blob.type : undefined,
                        });
                        console.log('[DubReviewModal] Auto-save complete ✓');
                    } catch (err) {
                        console.warn('[DubReviewModal] Auto-save failed:', err);
                    }
                }
            };

            performAutoSave();
        }, [job, mainCharacter, jobId]);

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

        try {
            // 1. Trigger Download
            window.open(job.finalMediaUrl, '_blank');

            // 2. Save to IndexedDB (Mirroring voice logic)
            console.log('[DubReviewModal] Saving result to local storage...');
            const response = await fetch(job.finalMediaUrl);
            if (!response.ok) throw new Error(`Failed to fetch media result: ${response.status}`);

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();

            const { saveDubbingResult } = await import('@/lib/db/indexdb');
            await saveDubbingResult({
                id: jobId,
                resultAudioData: job.mediaType === 'audio' ? arrayBuffer : undefined,
                resultAudioType: job.mediaType === 'audio' ? blob.type : undefined,
                resultVideoData: job.mediaType === 'video' ? arrayBuffer : undefined,
                resultVideoType: job.mediaType === 'video' ? blob.type : undefined,
            });

            console.log('[DubReviewModal] Result saved to IndexedDB ✓');
            setIsOpen(false);

            // Optional: Reload to show in MediaList if needed, 
            // but MediaList listens to Firestore so it might already be there.
            // voices logic reloads so let's be safe
            window.location.reload();

        } catch (error: any) {
            console.error('[DubReviewModal] Save error:', error);

            const errorDetails = {
                name: error.name || 'UnknownError',
                message: error.message || 'No error message',
                stack: error.stack || 'No stack trace'
            };

            alert(
                `Save to Local Failed!\n\n` +
                `Error: ${errorDetails.name}\n` +
                `Message: ${errorDetails.message}\n\n` +
                `The file was still opened for download. Please take a screenshot of this error.`
            );
        }
    };

    const getFriendlyStatusMessage = (job: DubbingJob) => {
        const step = job.step || '';

        // If explicitly cloning, give more detail
        if (job.status === 'cloning' && job.totalChunks && job.totalChunks > 0) {
            const current = job.completedChunks || 0;
            const progress = Math.round((current / job.totalChunks) * 100);
            return `Creating your custom voices... (${progress}%)`;
        }

        if (step.includes('Cloning voices')) {
            return 'Creating your custom voices...';
        }

        if (step.includes('Translating')) {
            return 'Translating your script...';
        }

        if (step.includes('Merging')) {
            return 'Finalizing your video...';
        }

        return step || 'Processing...';
    };

    const getFriendlyErrorMessage = (error: string) => {
        if (!error) return 'An unexpected error occurred.';

        if (error.includes('GPU out of memory')) {
            return 'Our servers are a bit busy. Please try again in a few moments.';
        }
        if (error.includes('credits')) {
            return 'You do not have enough credits to complete this action.';
        }
        if (error.includes('Unauthorized')) {
            return 'You do not have permission to perform this action.';
        }

        // Return generic message for other technical errors to avoid confusing users
        return 'Something went wrong while processing your request. Please try again.';
    };

    if (!isOpen || !job) return null;

    const isComplete = job.status === 'completed';
    const isFailed = job.status === 'failed';
    const progress = job.progress || 0;
    const currentMediaUrl = showOriginal ? originalMediaUrl : job.finalMediaUrl;

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-header">
                    <h3 className="modal-title">
                        {isComplete ? 'Dubbing Complete!' : isFailed ? 'Dubbing Failed' : 'Processing...'}
                    </h3>
                    {(isComplete || isFailed) && (
                        <button className="modal-close" onClick={() => setIsOpen(false)}>
                            <Icon icon="lucide:x" width={20} />
                        </button>
                    )}
                </div>

                <div className="modal-body">
                    {isFailed ? (
                        <div className="error-section">
                            <div className="error-icon">
                                <Icon icon="lucide:alert-triangle" width={48} height={48} />
                            </div>
                            <h4 className="error-title">Oops! Something went wrong</h4>
                            <p className="error-message">
                                {getFriendlyErrorMessage(job.error || '')}
                            </p>
                            <button className="btn btn-secondary btn-full" onClick={() => setIsOpen(false)}>
                                Close
                            </button>
                        </div>
                    ) : !isComplete ? (
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
                            <p className="progress-status">{getFriendlyStatusMessage(job)}</p>
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
                                        <AudioPlayer
                                            key={currentMediaUrl}
                                            audioUrl={currentMediaUrl || undefined}
                                            className="media-player"
                                            waveColor="#FFA07A"
                                            progressColor="#FF4500"
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

               
                .btn-full {
                    width: 100%;
                    flex: none;
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
                    font-weight: 500;
                }
                
                .error-section {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: var(--space-l) 0;
                    text-align: center;
                }
                
                .error-icon {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    background: var(--red-3);
                    color: var(--red-9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: var(--space-m);
                }
                
                .error-title {
                    font-size: var(--step-1);
                    font-weight: 700;
                    color: var(--red-11);
                    margin-bottom: var(--space-xs);
                }
                
                .error-message {
                    font-size: 15px;
                    color: var(--mauve-11);
                    margin-bottom: var(--space-l);
                    max-width: 300px;
                    line-height: 1.5;
                }
            `}</style>
        </div>
    );
}