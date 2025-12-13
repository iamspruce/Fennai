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

        // Transform technical errors into friendly messages
        let friendlyError = "Oops! Something went wrong with the voice magic. ";

        if (err.message?.includes('network') || err.message?.includes('fetch')) {
          friendlyError += "Looks like your internet took a coffee break. Mind checking your connection? ☕";
        } else if (err.message?.includes('timeout')) {
          friendlyError += "This is taking longer than expected. Our servers might be having a moment. Try again in a bit? 🕐";
        } else if (err.message?.includes('credits') || err.message?.includes('balance')) {
          friendlyError += "Looks like you're running low on credits. Time for a top-up! 💳";
        } else if (err.message?.includes('rate limit')) {
          friendlyError += "Whoa there, speedy! You've hit our rate limit. Take a breather and try again in a few minutes. 🐌";
        } else if (err.message?.includes('invalid') || err.message?.includes('format')) {
          friendlyError += "Hmm, something's not quite right with the audio format. Make sure it's a supported file type! 🎵";
        } else if (err.message?.includes('too large') || err.message?.includes('size')) {
          friendlyError += "That file's a bit too chunky for us! Try a smaller one. 🐘";
        } else if (err.message?.includes('audio') && err.message?.includes('quality')) {
          friendlyError += "The audio quality isn't quite clear enough. Try recording in a quieter space! 🎤";
        } else {
          friendlyError += "Our voice cloning gremlins are having a bad day. Give it another shot? 🧙‍♂️";
        }

        setError(friendlyError);
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
              <button
                className="btn btn-full"
                onClick={handleClose}
                style={{
                  marginTop: 'var(--space-s)',
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
                borderTop: '4px solid var(--orange-9)',
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
                {!jobStatus && 'Preparing...'}
              </h4>

              {/* Multi-chunk progress */}
              {showMultiChunkProgress && (
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
              {jobStatus?.reservedCost && (
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
                This may take a few moments...
              </p>
            </div>
          ) : null}
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