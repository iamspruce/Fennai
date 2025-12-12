// src/islands/CloningModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cloneSingleVoice, cloneMultiVoice, type JobStatus } from '@/lib/api/apiClient';

export default function CloningModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleOpen = async (e: CustomEvent) => {
      setIsOpen(true);
      setIsCloning(true);
      setError('');
      setJobStatus(null);

      const { characterId, text, isMultiCharacter, characterIds, texts } = e.detail;

      try {
        if (isMultiCharacter) {
          const characters = characterIds.map((id: string, idx: number) => ({
            characterId: id,
            text: texts[idx]
          }));

          await cloneMultiVoice(
            { characters },
            (status) => {
              setJobStatus(status);
            }
          );
        } else {
          await cloneSingleVoice(
            { characterId, text },
            (status) => {
              setJobStatus(status);
            }
          );
        }

        setIsCloning(false);
        window.location.reload();

      } catch (err: any) {
        console.error('Cloning failed:', err);
        setError(err.message || 'Voice cloning failed');
        setIsCloning(false);
      }
    };

    window.addEventListener('open-cloning-modal', handleOpen as unknown as EventListener);
    return () => window.removeEventListener('open-cloning-modal', handleOpen as unknown as EventListener);
  }, []);

  const handleClose = () => {
    if (!isCloning) {
      setIsOpen(false);
      setJobStatus(null);
      setError('');
    }
  };

  if (!isOpen) return null;

  const showMultiChunkProgress = jobStatus?.totalChunks && jobStatus.totalChunks > 1;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

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
              <button className="btn btn-secondary" onClick={handleClose}>
                Close
              </button>
            </div>
          ) : isCloning ? (
            <div className="cloning-state">
              {/* Spinner */}
              <div className="spinner-container">
                <div className="spinner"></div>
              </div>

              {/* Status */}
              <h4 className="status-title">
                {jobStatus?.status === 'queued' && 'Queuing generation...'}
                {jobStatus?.status === 'processing' && 'Generating voice...'}
                {!jobStatus && 'Preparing...'}
              </h4>

              {/* Multi-chunk progress */}
              {showMultiChunkProgress && (
                <div className="chunk-progress">
                  <div className="chunk-info">
                    <Icon icon="lucide:layers" width={18} />
                    <span>
                      Processing {jobStatus.speakerCount} speakers in {jobStatus.totalChunks} chunks
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(jobStatus.completedChunks! / jobStatus.totalChunks!) * 100}%`
                      }}
                    />
                  </div>
                  <p className="chunk-status">
                    {jobStatus.completedChunks}/{jobStatus.totalChunks} chunks complete
                  </p>
                </div>
              )}

              {/* Cost info */}
              {jobStatus?.reservedCost && (
                <div className="cost-info">
                  <Icon icon="lucide:coins" width={16} />
                  <span>Reserved: {jobStatus.reservedCost} credits</span>
                </div>
              )}

              <p className="status-hint">This may take a few moments...</p>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
}


