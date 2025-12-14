// src/islands/CloningModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { cloneSingleVoice, cloneMultiVoice, resumeJob, getPendingJobs, type JobStatus } from '@/lib/api/apiClient';

export default function CloningModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [cloningData, setCloningData] = useState<any>(null);
  const [showPendingJobs, setShowPendingJobs] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<any[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Check for pending jobs on mount
  useEffect(() => {
    const pending = getPendingJobs();
    const jobs = Object.values(pending);

    if (jobs.length > 0) {
      setPendingJobs(jobs);
      setShowPendingJobs(true);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const startCloning = async (detail: any) => {
    setIsOpen(true);
    setIsCloning(true);
    setError('');
    setJobStatus(null);
    setShowPendingJobs(false);

    const { characterId, text, isMultiCharacter, characterIds, texts } = detail;

    setCloningData({ characterId, text, isMultiCharacter, characterIds, texts });

    try {
      let result;

      if (isMultiCharacter) {
        const characters = characterIds.map((id: string, idx: number) => ({
          characterId: id,
          text: texts[idx]
        }));

        result = await cloneMultiVoice(
          { characters },
          (status) => {
            setJobStatus(status);
          }
        );
      } else {
        result = await cloneSingleVoice(
          { characterId, text },
          (status) => {
            setJobStatus(status);
          }
        );
      }

      // Success!
      setIsCloning(false);

      // Brief pause to show completion
      setTimeout(() => {
        setIsOpen(false);

        // Dispatch preview modal event
        window.dispatchEvent(new CustomEvent('open-preview-modal', {
          detail: {
            audioBlob: result.audioBlob,
            duration: result.duration,
            source: isMultiCharacter ? 'multi-character' : 'single-character',
            characterId: characterId,
            text: text,
            isMultiCharacter: isMultiCharacter,
            characterIds: characterIds,
            texts: texts,
          }
        }));
      }, 800);

    } catch (err: any) {
      console.error('Cloning failed:', err);

      // Transform technical errors into friendly messages
      let friendlyError = "Oops! Something went wrong with the voice magic. ";

      if (err.message?.includes('network') || err.message?.includes('fetch')) {
        friendlyError += "Looks like your internet took a coffee break. Mind checking your connection? ☕";
      } else if (err.message?.includes('timeout') || err.message?.includes('timed out')) {
        friendlyError += "This is taking longer than expected. Don't worry - your job might still be processing. Check the 'Resume' button if you see it! 🕐";
      } else if (err.message?.includes('credits') || err.message?.includes('balance')) {
        friendlyError += "Looks like you're running low on credits. Time for a top-up! 💳";
      } else if (err.message?.includes('rate limit')) {
        friendlyError += "Whoa there, speedy! You've hit our rate limit. Take a breather and try again in a few minutes. 🌊";
      } else if (err.message?.includes('invalid') || err.message?.includes('format')) {
        friendlyError += "Hmm, something's not quite right with the audio format. Make sure it's a supported file type! 🎵";
      } else if (err.message?.includes('too large') || err.message?.includes('size')) {
        friendlyError += "That file's a bit too chunky for us! Try a smaller one. 🐘";
      } else if (err.message?.includes('audio') && err.message?.includes('quality')) {
        friendlyError += "The audio quality isn't quite clear enough. Try recording in a quieter space! 🎤";
      } else if (err.message?.includes('Storage') || err.message?.includes('storage')) {
        friendlyError += "Your device is running low on storage space. Try clearing some old voices! 💾";
      } else {
        friendlyError += "Our voice cloning gremlins are having a bad day. Give it another shot? 🧙‍♂️";
      }

      setError(friendlyError);
      setIsCloning(false);

      // Refresh pending jobs list in case job is still processing
      const pending = getPendingJobs();
      setPendingJobs(Object.values(pending));
    }
  };

  useEffect(() => {
    const handleOpen = async (e: CustomEvent) => {
      startCloning(e.detail);
    };

    window.addEventListener('open-cloning-modal', handleOpen as unknown as EventListener);
    return () => window.removeEventListener('open-cloning-modal', handleOpen as unknown as EventListener);
  }, []);

  const handleResumeJob = async (job: any) => {
    setIsOpen(true);
    setIsCloning(true);
    setError('');
    setJobStatus(null);
    setShowPendingJobs(false);

    setCloningData({
      characterId: job.characterId,
      text: job.text,
      isMultiCharacter: job.isMultiCharacter,
      characterIds: job.characterIds,
      texts: job.texts
    });

    try {
      const result = await resumeJob(job.jobId, (status) => {
        setJobStatus(status);
      });

      // Success!
      setIsCloning(false);

      setTimeout(() => {
        setIsOpen(false);

        window.dispatchEvent(new CustomEvent('open-preview-modal', {
          detail: {
            audioBlob: result.audioBlob,
            duration: result.duration,
            source: job.isMultiCharacter ? 'multi-character' : 'single-character',
            characterId: job.characterId,
            text: job.text,
            isMultiCharacter: job.isMultiCharacter,
            characterIds: job.characterIds,
            texts: job.texts,
          }
        }));
      }, 800);
    } catch (err: any) {
      console.error('Resume failed:', err);
      setError(err.message || 'Failed to resume job');
      setIsCloning(false);
    }
  };

  const handleClose = () => {
    if (!isCloning) {
      setIsOpen(false);
      setJobStatus(null);
      setError('');
      setShowPendingJobs(false);

      // Refresh pending jobs when closing
      const pending = getPendingJobs();
      if (Object.keys(pending).length > 0) {
        setPendingJobs(Object.values(pending));
      }
    }
  };

  const handleDismissPending = () => {
    setShowPendingJobs(false);
  };

  if (!isOpen && !showPendingJobs) return null;

  const showMultiChunkProgress = jobStatus?.totalChunks && jobStatus.totalChunks > 1;
  const isRetrying = jobStatus?.status === 'retrying';
  const retryCount = jobStatus?.retryCount || 0;
  const maxRetries = jobStatus?.maxRetries || 2;

  // Show pending jobs notification
  if (showPendingJobs && !isOpen) {
    return (
      <div className="pending-jobs-notification">
        <div className="notification-content">
          <div className="notification-header">
            <Icon icon="lucide:clock" width={20} style={{ color: 'var(--orange-9)' }} />
            <h4>Resume In-Progress Jobs?</h4>
            <button className="close-btn" onClick={handleDismissPending}>
              <Icon icon="lucide:x" width={16} />
            </button>
          </div>
          <p className="notification-text">
            You have {pendingJobs.length} voice generation{pendingJobs.length > 1 ? 's' : ''} that {pendingJobs.length > 1 ? 'were' : 'was'} interrupted. Would you like to check their status?
          </p>
          <div className="notification-actions">
            {pendingJobs.map((job) => (
              <button
                key={job.jobId}
                className="resume-job-btn"
                onClick={() => handleResumeJob(job)}
              >
                <div className="job-preview">
                  <span className="job-text">{job.text.substring(0, 40)}...</span>
                  <span className="job-badge">{job.isMultiCharacter ? 'Multi' : 'Single'}</span>
                </div>
                <Icon icon="lucide:play" width={16} />
              </button>
            ))}
          </div>
        </div>

        <style>{`
          .pending-jobs-notification {
            position: fixed;
            top: 80px;
            right: 16px;
            max-width: 380px;
            background: var(--mauve-2);
            border: 1px solid var(--orange-6);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 9999;
            animation: slideIn 0.3s ease;
          }

          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }

          .notification-content {
            padding: 16px;
          }

          .notification-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }

          .notification-header h4 {
            flex: 1;
            font-size: 14px;
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0;
          }

          .close-btn {
            background: transparent;
            border: none;
            color: var(--mauve-9);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
          }

          .close-btn:hover {
            background: var(--mauve-4);
            color: var(--mauve-11);
          }

          .notification-text {
            font-size: 13px;
            color: var(--mauve-11);
            margin: 0 0 12px 0;
            line-height: 1.4;
          }

          .notification-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .resume-job-btn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: var(--orange-3);
            border: 1px solid var(--orange-6);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            width: 100%;
          }

          .resume-job-btn:hover {
            background: var(--orange-4);
            border-color: var(--orange-7);
            transform: translateY(-1px);
          }

          .job-preview {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
            text-align: left;
          }

          .job-text {
            font-size: 13px;
            color: var(--mauve-12);
            font-weight: 500;
          }

          .job-badge {
            font-size: 11px;
            color: var(--orange-11);
            font-weight: 600;
            text-transform: uppercase;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>

        {/* Mobile Handle */}
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <Icon icon="lucide:wand-2" width={20} style={{ color: 'var(--orange-9)' }} />
            <h3 className="modal-title">Voice Cloning</h3>
          </div>
          {!isCloning && (
            <button className="modal-close" onClick={handleClose}>
              <Icon icon="lucide:x" width={20} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {error ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-m)',
              padding: 'var(--space-xl) var(--space-m)',
              textAlign: 'center'
            }}>
              <Icon icon="lucide:alert-circle" width={48} style={{ color: 'var(--red-9)' }} />
              <h4 style={{ fontSize: 'var(--step-0)', fontWeight: 600, color: 'var(--mauve-12)', margin: 0 }}>
                Cloning Failed
              </h4>
              <p style={{ fontSize: '14px', color: 'var(--mauve-11)', margin: 0 }}>
                {error}
              </p>
              <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: 'var(--space-s)' }}>
                {pendingJobs.length > 0 && (
                  <button
                    className="btn btn-full"
                    onClick={() => {
                      setError('');
                      setShowPendingJobs(true);
                      setIsOpen(false);
                    }}
                    style={{
                      flex: 1,
                      background: 'var(--orange-9)',
                      border: 'none',
                      color: 'white',
                      justifyContent: 'center',
                      padding: '12px 24px'
                    }}
                  >
                    Check Status
                  </button>
                )}
                <button
                  className="btn btn-full"
                  onClick={handleClose}
                  style={{
                    flex: pendingJobs.length > 0 ? 1 : undefined,
                    background: 'var(--mauve-3)',
                    border: '1px solid var(--mauve-6)',
                    color: 'var(--mauve-12)',
                    justifyContent: 'center',
                    padding: '12px 24px'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : isCloning ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-m)',
              padding: 'var(--space-xl) var(--space-m)'
            }}>

              {/* Spinner */}
              <div style={{
                width: 64,
                height: 64,
                border: '4px solid var(--mauve-4)',
                borderTop: isRetrying ? '4px solid var(--yellow-9)' : '4px solid var(--orange-9)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />

              {/* Status */}
              <h4 style={{
                fontSize: 'var(--step-0)',
                fontWeight: 600,
                color: 'var(--mauve-12)',
                margin: 0,
                textAlign: 'center'
              }}>
                {jobStatus?.status === 'queued' && 'Queuing generation...'}
                {jobStatus?.status === 'processing' && 'Generating voice...'}
                {jobStatus?.status === 'retrying' && `Retrying generation... (${retryCount}/${maxRetries})`}
                {jobStatus?.status === 'completed' && 'Polishing the final audio...'}
                {!jobStatus && 'Preparing...'}
              </h4>

              {/* Retry Warning */}
              {isRetrying && (
                <div style={{
                  width: '100%',
                  padding: 'var(--space-m)',
                  background: 'var(--yellow-2)',
                  border: '1px solid var(--yellow-6)',
                  borderRadius: 'var(--radius-m)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-s)'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)',
                    fontSize: '14px',
                    color: 'var(--yellow-11)'
                  }}>
                    <Icon icon="lucide:alert-triangle" width={18} />
                    <span style={{ fontWeight: 600 }}>
                      Generation had an issue - automatically retrying
                    </span>
                  </div>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--yellow-11)',
                    margin: 0
                  }}>
                    {jobStatus?.lastError || 'Our servers are working to resolve this.'}
                  </p>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--yellow-11)',
                    margin: 0
                  }}>
                    Retry {retryCount} of {maxRetries} - Your credits are safe!
                  </p>
                </div>
              )}

              {/* Multi-chunk progress */}
              {showMultiChunkProgress && !isRetrying && (
                <div style={{
                  width: '100%',
                  padding: 'var(--space-m)',
                  background: 'var(--mauve-2)',
                  border: '1px solid var(--mauve-6)',
                  borderRadius: 'var(--radius-m)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-s)'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)',
                    fontSize: '14px',
                    color: 'var(--mauve-11)'
                  }}>
                    <Icon icon="lucide:layers" width={18} />
                    <span>
                      Processing {jobStatus.speakerCount} speakers in {jobStatus.totalChunks} chunks
                    </span>
                  </div>

                  <div style={{
                    width: '100%',
                    height: 8,
                    background: 'var(--mauve-4)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      background: 'var(--orange-9)',
                      borderRadius: 'var(--radius-full)',
                      transition: 'width 0.3s ease',
                      width: `${(jobStatus.completedChunks! / jobStatus.totalChunks!) * 100}%`
                    }} />
                  </div>

                  <p style={{
                    fontSize: '13px',
                    color: 'var(--mauve-11)',
                    margin: 0,
                    textAlign: 'center'
                  }}>
                    {jobStatus.completedChunks}/{jobStatus.totalChunks} chunks complete
                  </p>
                </div>
              )}

              {/* Cost info */}
              {jobStatus?.reservedCost && !isRetrying && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-xs)',
                  padding: 'var(--space-xs) var(--space-s)',
                  background: 'var(--orange-2)',
                  border: '1px solid var(--orange-6)',
                  borderRadius: 'var(--radius-m)',
                  fontSize: '13px',
                  color: 'var(--orange-11)'
                }}>
                  <Icon icon="lucide:coins" width={16} />
                  <span>Reserved: {jobStatus.reservedCost} credits</span>
                </div>
              )}

              <p style={{
                fontSize: '14px',
                color: 'var(--mauve-11)',
                margin: 0,
                textAlign: 'center'
              }}>
                {isRetrying
                  ? "Don't worry - we'll keep trying automatically..."
                  : "Safe to close this - your job will continue in the background!"}
              </p>
            </div>
          ) : (
            /* Success state */
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-m)',
              padding: 'var(--space-xl) var(--space-m)',
              textAlign: 'center'
            }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--green-2)',
                border: '2px solid var(--green-6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Icon icon="lucide:check" width={32} style={{ color: 'var(--green-9)' }} />
              </div>
              <h4 style={{ fontSize: 'var(--step-0)', fontWeight: 600, color: 'var(--mauve-12)', margin: 0 }}>
                Voice successfully cloned!
              </h4>
              <p style={{ fontSize: '14px', color: 'var(--mauve-11)', margin: 0 }}>
                Opening preview...
              </p>
            </div>
          )}
        </div>

      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}