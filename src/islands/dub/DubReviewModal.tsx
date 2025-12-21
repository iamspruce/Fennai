// src/islands/DubReviewModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';
import { getDubbingMedia, saveDubbingResult } from '@/lib/db/indexdb';
import AudioPlayer from '@/components/ui/AudioPlayer';

export default function DubReviewModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [mainCharacter, setMainCharacter] = useState<any>(null);
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [initialFileName, setInitialFileName] = useState('');
    const [showOriginal, setShowOriginal] = useState(false);
    const [originalMediaUrl, setOriginalMediaUrl] = useState<string | null>(null);
    const originalUrlRef = useRef<string | null>(null);
    const hasAutoSavedRef = useRef(false);

    // Reset auto-save flag when jobId changes
    useEffect(() => {
        hasAutoSavedRef.current = false;
    }, [jobId]);

    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setMainCharacter(e.detail.mainCharacter);
            if (e.detail.fileName) setInitialFileName(e.detail.fileName);
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

                        if (data.status === 'failed') {
                            window.dispatchEvent(new CustomEvent('show-alert', {
                                detail: {
                                    title: 'Dubbing Failed',
                                    message: 'The dubbing process encountered an error.',
                                    type: 'error',
                                    details: `Job Error: ${data.error || 'Unknown error'}`
                                }
                            }));
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
                        status: 'completed'
                    });
                    console.log('[DubReviewModal] Auto-save complete ✓');
                    window.dispatchEvent(new CustomEvent('local-media-updated'));

                    // PRIVACY: Once saved locally, delete from cloud if sync is disabled
                    console.log('[DubReviewModal] Purging cloud files for privacy...');
                    await fetch(`/api/dubbing/${jobId}`, { method: 'DELETE' });

                    // Note: MediaList will now show it from local storage
                } catch (err) {
                    console.warn('[DubReviewModal] Auto-save or Purge failed:', err);
                }
            }
        };

        performAutoSave();
    }, [job, mainCharacter, jobId]);

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

            await saveDubbingResult({
                id: jobId,
                resultAudioData: job.mediaType === 'audio' ? arrayBuffer : undefined,
                resultAudioType: job.mediaType === 'audio' ? blob.type : undefined,
                resultVideoData: job.mediaType === 'video' ? arrayBuffer : undefined,
                resultVideoType: job.mediaType === 'video' ? blob.type : undefined,
            });

            console.log('[DubReviewModal] Result saved to IndexedDB ✓');
            window.dispatchEvent(new CustomEvent('local-media-updated'));
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

            window.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: 'Save to Local Failed',
                    message: 'The file was opened for download, but we couldn\'t save it to your local browser storage.',
                    type: 'error',
                    details: `Error: ${error.name || 'Unknown'}\nMessage: ${error.message || 'No message'}\nStack: ${error.stack || 'No stack'}`
                }
            }));
        }
    };

    const getFriendlyStatusMessage = (job: DubbingJob) => {
        const step = job.step || '';
        const status = job.status;

        // Provide status-specific messages
        if (status === 'transcribing') {
            return 'Analyzing audio and detecting speakers...';
        }

        if (status === 'transcribing_done') {
            return 'Transcription complete! Setting up...';
        }

        // If explicitly cloning, give more detail
        if (status === 'cloning' && job.totalChunks && job.totalChunks > 0) {
            const current = job.completedChunks || 0;
            const progress = Math.round((current / job.totalChunks) * 100);
            return `Cloning voices with AI... (${current}/${job.totalChunks} segments)`;
        }

        if (status === 'cloning') {
            return 'Creating your custom AI voices...';
        }

        if (status === 'translating') {
            return 'Translating script to target language...';
        }

        if (status === 'merging') {
            return 'Merging audio and video... Almost done!';
        }

        // Fallback to step-based messages
        if (step.includes('Cloning voices')) {
            return 'Creating your custom voices...';
        }

        if (step.includes('Translating')) {
            return 'Translating your script...';
        }

        if (step.includes('Merging')) {
            return 'Finalizing your video...';
        }

        return step || 'Processing your dubbing job...';
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
                    <div className="modal-title-group">
                        <h3 className="modal-title">
                            {isComplete ? 'Dubbing Complete!' : isFailed ? 'Dubbing Failed' : 'Processing...'}
                        </h3>
                        {(job?.fileName || initialFileName) && (
                            <span className="modal-subtitle">{job?.fileName || initialFileName}</span>
                        )}
                    </div>
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
                            <div className="error-actions" style={{ display: 'flex', gap: 'var(--space-s)', width: '100%' }}>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => {
                                    window.dispatchEvent(new CustomEvent('open-dub-settings', { detail: { jobId } }));
                                    setIsOpen(false);
                                }}>
                                    <Icon icon="lucide:rotate-ccw" width={18} />
                                    Retry
                                </button>
                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsOpen(false)}>
                                    Close
                                </button>
                            </div>
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
                                            className="media-player video-player"
                                            style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }}
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
                                    className="btn-secondary btn-full"
                                    onClick={handleDownloadAndDelete}
                                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xs)', padding: 'var(--space-s)', borderRadius: 'var(--radius-m)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', border: '1px solid var(--mauve-6)', background: 'var(--mauve-2)', color: 'var(--mauve-11)' }}
                                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--mauve-3)'; e.currentTarget.style.borderColor = 'var(--mauve-7)'; }}
                                    onMouseOut={(e) => { e.currentTarget.style.background = 'var(--mauve-2)'; e.currentTarget.style.borderColor = 'var(--mauve-6)'; }}
                                >
                                    <Icon icon="lucide:download" width={18} />
                                    Download & Delete
                                </button>
                                <button
                                    className="btn-primary btn-full"
                                    onClick={handleDownloadAndSave}
                                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xs)', padding: 'var(--space-s)', borderRadius: 'var(--radius-m)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', border: 'none', background: 'var(--orange-9)', color: 'white' }}
                                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--orange-10)'}
                                    onMouseOut={(e) => e.currentTarget.style.background = 'var(--orange-9)'}
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
                    max-height: 450px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                }

                .media-player {
                    width: 100%;
                    border-radius: var(--radius-m);
                }

                .video-player {
                    max-height: 100%;
                    object-fit: contain;
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

                .modal-title-group {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .modal-subtitle {
                    font-size: 13px;
                    color: var(--mauve-11);
                    font-weight: 500;
                    margin-top: -2px;
                }
            `}</style>
        </div>
    );
}