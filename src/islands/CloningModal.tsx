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
  const [pendingJobs, setPendingJobs] = useState<any[]>([]);

  const startCloning = async (detail: any) => {
    setIsOpen(true);
    setIsCloning(true);
    setError('');
    setJobStatus(null);

    const { characterId, text, isMultiCharacter, characterIds, texts, jobId } = detail;

    // If we're resuming, use handleResumeJob instead
    if (jobId && !text) {
      handleResumeJob(detail);
      return;
    }

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
      let friendlyError = "Oops! Something went wrong with the voice magic. ";
      if (err.message?.includes('network')) friendlyError += "Check your connection? ☕";
      else if (err.message?.includes('timeout')) friendlyError += "This is taking longer than expected. 🕐";
      else if (err.message?.includes('credits')) friendlyError += "Low on credits. 💳";
      else friendlyError += "Give it another shot? 🧙‍♂️";

      setError(friendlyError);
      setIsCloning(false);

      window.dispatchEvent(new CustomEvent('show-alert', {
        detail: {
          title: "Cloning Failed",
          message: friendlyError,
          type: "error",
          details: `Error: ${err.name || 'Unknown'}\nMessage: ${err.message || 'No message'}\nStack: ${err.stack || 'No stack'}`
        }
      }));
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

    setCloningData({
      characterId: job.characterId,
      text: job.text || 'Resuming...',
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
            text: job.text || '',
            isMultiCharacter: job.isMultiCharacter,
            characterIds: job.characterIds,
            texts: job.texts,
          }
        }));
      }, 800);
    } catch (err: any) {
      console.error('Resume failed:', err);
      const msg = err.message || 'Failed to resume job';
      setError(msg);
      setIsCloning(false);

      window.dispatchEvent(new CustomEvent('show-alert', {
        detail: {
          title: "Resume Failed",
          message: msg,
          type: "error",
          details: `Error: ${err.name || 'Unknown'}\nMessage: ${err.message || 'No message'}\nStack: ${err.stack || 'No stack'}`
        }
      }));
    }
  };

  const handleClose = () => {
    if (!isCloning) {
      setIsOpen(false);
      setJobStatus(null);
      setError('');
    }
  };

  if (!isOpen) return null;

  const showMultiChunkProgress = jobStatus?.totalChunks && jobStatus.totalChunks > 1;
  const isRetrying = jobStatus?.status === 'retrying';
  const retryCount = jobStatus?.retryCount || 0;
  const maxRetries = jobStatus?.maxRetries || 2;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-handle-bar"><div className="modal-handle-pill"></div></div>

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

        <div className="modal-body">
          {error ? (
            <div className="error-state">
              <Icon icon="lucide:alert-circle" width={48} style={{ color: 'var(--red-9)' }} />
              <h4>Cloning Failed</h4>
              <p>{error}</p>
              <button className="btn btn-full" onClick={handleClose}>Close</button>
            </div>
          ) : isCloning ? (
            <div className="processing-state">
              <div className="spinner" />
              <h4>
                {jobStatus?.status === 'queued' && 'Queuing generation...'}
                {jobStatus?.status === 'processing' && 'Generating voice...'}
                {jobStatus?.status === 'retrying' && `Retrying... (${retryCount}/${maxRetries})`}
                {jobStatus?.status === 'completed' && 'Polishing...'}
                {!jobStatus && 'Preparing...'}
              </h4>

              {isRetrying && (
                <div className="warning-box">
                  <Icon icon="lucide:alert-triangle" width={18} />
                  <span>Retrying automatically...</span>
                </div>
              )}

              {showMultiChunkProgress && !isRetrying && (
                <div className="progress-box">
                  <div className="progress-bar">
                    <div className="fill" style={{ width: `${(jobStatus.completedChunks! / jobStatus.totalChunks!) * 100}%` }} />
                  </div>
                  <p>{jobStatus.completedChunks}/{jobStatus.totalChunks} chunks</p>
                </div>
              )}

              <p className="hint">Safe to close - job will continue in background!</p>
            </div>
          ) : (
            <div className="success-state">
              <div className="check-icon"><Icon icon="lucide:check" width={32} /></div>
              <h4>Success!</h4>
              <p>Opening preview...</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .processing-state, .error-state, .success-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 32px 16px;
          text-align: center;
        }
        .spinner {
          width: 64px;
          height: 64px;
          border: 4px solid var(--mauve-4);
          border-top: 4px solid var(--orange-9);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        .progress-box { width: 100%; }
        .progress-bar { height: 8px; background: var(--mauve-4); border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
        .progress-bar .fill { height: 100%; background: var(--orange-9); transition: width 0.3s; }
        .warning-box { background: var(--yellow-2); border: 1px solid var(--yellow-6); padding: 12px; border-radius: 8px; color: var(--yellow-11); }
        .check-icon { width: 64px; height: 64px; background: var(--green-2); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--green-9); }
        .hint { font-size: 13px; color: var(--mauve-11); }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}