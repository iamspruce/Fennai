// src/islands/dub/ResumeJobModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';

interface ResumeJobData {
    jobId: string;
    type: 'dubbing' | 'cloning';
    fileName?: string;
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

        // Depending on the job type, open the appropriate modal
        if (jobData.type === 'dubbing') {
            // For dubbing, we usually go to settings or review depending on status
            // But for now, let's just trigger 'open-dub-settings' which handles status check
            window.dispatchEvent(new CustomEvent('open-dub-settings', {
                detail: { jobId: jobData.jobId }
            }));
        } else if (jobData.type === 'cloning') {
            // For voice cloning, we might have a different modal
            window.dispatchEvent(new CustomEvent('open-cloning-modal', {
                detail: { jobId: jobData.jobId }
            }));
        }

        setIsOpen(false);
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

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:rotate-cw" width={20} className="primary-color" />
                        <h3 className="modal-title">Resume Active Job?</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)} disabled={isProcessing}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="resume-content">
                        <div className="resume-icon">
                            <Icon
                                icon={jobData.type === 'dubbing' ? "lucide:video" : "lucide:mic"}
                                width={48}
                                height={48}
                            />
                        </div>

                        <h4>Found an active {jobData.type} job</h4>
                        <p>
                            It looks like you have a <strong>{jobData.type}</strong> job for
                            "<em>{jobData.fileName || 'Untitled'}</em>" still in progress.
                            Would you like to continue where you left off?
                        </p>

                        <div className="resume-actions">
                            <button
                                className="btn btn-primary btn-full"
                                onClick={handleContinue}
                                disabled={isProcessing}
                            >
                                <Icon icon="lucide:play" width={18} />
                                Continue {jobData.type === 'dubbing' ? 'Dubbing' : 'Cloning'}
                            </button>

                            <button
                                className="btn btn-outline btn-full btn-danger-hover"
                                onClick={handleStopAndDelete}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <Icon icon="lucide:loader-2" width={18} className="spin" />
                                ) : (
                                    <Icon icon="lucide:trash-2" width={18} />
                                )}
                                Stop and Delete
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
                        background: white;
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
