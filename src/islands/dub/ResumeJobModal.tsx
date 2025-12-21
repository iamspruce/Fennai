// src/islands/dub/ResumeJobModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';

interface ResumeJobData {
    jobId: string;
    type: 'dubbing' | 'cloning';
    fileName?: string;
    status?: string;
}

export default function ResumeJobModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobData, setJobData] = useState<ResumeJobData | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const handleOpen = (e: CustomEvent<ResumeJobData>) => {
            setJobData(e.detail);
            setIsOpen(true);
        };

        window.addEventListener('open-resume-job-modal', handleOpen as EventListener);
        return () => window.removeEventListener('open-resume-job-modal', handleOpen as EventListener);
    }, []);

    const handleContinue = () => {
        if (!jobData) return;

        console.log('[ResumeJobModal] Continuing job:', jobData);

        // Close this modal first to prevent conflicts
        setIsOpen(false);

        // Small delay to ensure this modal is closed before opening another
        setTimeout(() => {
            // Depending on the job type, open the appropriate modal
            if (jobData.type === 'dubbing') {
                // If the job is already in a processing state beyond transcription, go straight to review
                const processingStatuses = ['cloning', 'translating', 'merging', 'completed'];
                if (processingStatuses.includes(jobData.status || '')) {
                    console.log('[ResumeJobModal] Opening DubReviewModal for processing job');
                    window.dispatchEvent(new CustomEvent('open-dub-review', {
                        detail: { jobId: jobData.jobId }
                    }));
                } else {
                    // Otherwise go to settings (which handles transcribing_done etc.)
                    console.log('[ResumeJobModal] Opening DubSettingsModal for configuration');
                    window.dispatchEvent(new CustomEvent('open-dub-settings', {
                        detail: { jobId: jobData.jobId }
                    }));
                }
            } else if (jobData.type === 'cloning') {
                // For voice cloning, we might have a different modal
                console.log('[ResumeJobModal] Opening cloning modal');
                window.dispatchEvent(new CustomEvent('open-cloning-modal', {
                    detail: { jobId: jobData.jobId }
                }));
            }
        }, 100); // 100ms delay to prevent modal conflicts
    };

    const handleStopAndDelete = async () => {
        if (!jobData) return;
        setIsProcessing(true);

        try {
            // 1. Delete from Firestore
            const collectionName = jobData.type === 'dubbing' ? 'dubbingJobs' : 'voiceJobs';
            await deleteDoc(doc(db, collectionName, jobData.jobId));

            // 2. Clear from localStorage
            localStorage.removeItem('activeJob');

            // 3. Clear from API (optional, but keep it simple for now)
            await fetch(`/api/${jobData.type}/${jobData.jobId}`, { method: 'DELETE' }).catch(() => { });

            setIsOpen(false);
        } catch (error) {
            console.error('Failed to delete job:', error);
            alert('Failed to delete the job. Please try again.');
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen || !jobData) return null;

    const isFailed = jobData.status === 'failed';

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon={isFailed ? "lucide:alert-octagon" : "lucide:rotate-cw"} width={20} className={isFailed ? "text-red-9" : "primary-color"} />
                        <h3 className="modal-title">{isFailed ? 'Job Failed' : 'Resume Active Job?'}</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)} disabled={isProcessing}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="resume-content">
                        <div className={`resume-icon ${isFailed ? 'failed' : ''}`}>
                            <Icon
                                icon={isFailed ? "lucide:alert-circle" : (jobData.type === 'dubbing' ? "lucide:video" : "lucide:mic")}
                                width={48}
                                height={48}
                            />
                        </div>

                        <h4>{isFailed ? "Generation Failed" : `Resume ${jobData.type === 'dubbing' ? 'Dubbing' : 'Voice Cloning'}`}</h4>
                        <p>
                            {isFailed
                                ? `Your ${jobData.type === 'dubbing' ? 'dubbing' : 'voice cloning'} job for "${jobData.fileName || 'Untitled'}" encountered an error. You can retry or delete it.`
                                : jobData.status === 'transcribing'
                                    ? `Your dubbing job for "${jobData.fileName || 'Untitled'}" is being analyzed. Continue to see progress.`
                                    : jobData.status === 'cloning'
                                        ? `Your dubbing job for "${jobData.fileName || 'Untitled'}" is cloning voices. Continue to monitor progress.`
                                        : `You have an active ${jobData.type === 'dubbing' ? 'dubbing' : 'voice cloning'} job for "${jobData.fileName || 'Untitled'}". Continue where you left off?`
                            }
                        </p>

                        <div className="resume-actions">
                            <button
                                className="btn-primary btn-full"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xs)', padding: 'var(--space-s)', borderRadius: 'var(--radius-m)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', border: 'none', background: 'var(--orange-9)', color: 'white' }}
                                onClick={handleContinue}
                                disabled={isProcessing}
                                onMouseOver={(e) => !isProcessing && (e.currentTarget.style.background = 'var(--orange-10)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'var(--orange-9)')}
                            >
                                <Icon icon={isFailed ? "lucide:rotate-ccw" : "lucide:play"} width={18} />
                                {isFailed ? 'Retry Job' : `Continue ${jobData.type === 'dubbing' ? 'Dubbing' : 'Cloning'}`}
                            </button>

                            <button
                                className="btn-outline btn-full btn-danger-hover"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xs)', padding: 'var(--space-s)', borderRadius: 'var(--radius-m)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', background: 'var(--mauve-1)', border: '1px solid var(--mauve-6)', color: 'var(--mauve-11)' }}
                                onClick={handleStopAndDelete}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <Icon icon="lucide:loader-2" width={18} className="spin" />
                                ) : (
                                    <Icon icon="lucide:trash-2" width={18} />
                                )}
                                {isFailed ? 'Delete Job' : 'Stop and Delete'}
                            </button>
                        </div>
                    </div>
                </div>

                <style>{`
                    .resume-content {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        padding: var(--space-m) 0;
                    }

                    .resume-icon {
                        width: 80px;
                        height: 80px;
                        background: var(--mauve-3);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: var(--orange-9);
                        margin-bottom: var(--space-m);
                    }
                    
                    .resume-icon.failed {
                        background: var(--red-3);
                        color: var(--red-9);
                    }
                    
                    .text-red-9 { color: var(--red-9); }

                    .resume-content h4 {
                        font-size: var(--step-1);
                        font-weight: 600;
                        color: var(--mauve-12);
                        margin: 0 0 var(--space-xs) 0;
                    }

                    .resume-content p {
                        font-size: 15px;
                        color: var(--mauve-11);
                        line-height: 1.6;
                        margin-bottom: var(--space-xl);
                        max-width: 320px;
                    }

                    .resume-actions {
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-s);
                        width: 100%;
                    }

                    .btn-danger-hover:hover {
                        background: var(--red-3) !important;
                        color: var(--red-9) !important;
                        border-color: var(--red-6) !important;
                    }

                    .btn-outline {
                        background: var(--mauve-1);
                        border: 1px solid var(--mauve-6);
                        color: var(--mauve-11);
                    }

                    .primary-color {
                        color: var(--orange-9);
                    }

                    .spin {
                        animation: spin 1s linear infinite;
                    }

                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>
    );
}
