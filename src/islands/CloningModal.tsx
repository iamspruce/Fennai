import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cloneSingleVoice, cloneMultiVoice, checkUserCanClone, type CloneVoiceResponse } from '@/lib/api/voiceClone';
import '@/styles/modal.css';

interface CloningEventDetail {
  characterId: string;
  text: string;
  audioFile: File;
  isMultiCharacter?: boolean;
  characterIds?: string[];
  texts?: string[];
  additionalCharacters?: Array<{ characterId: string; text: string; audioFile: File }>;
}

export default function CloningModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<CloningEventDetail | null>(null);

  const [status, setStatus] = useState<'checking' | 'cloning' | 'complete' | 'error'>('checking');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Preparing...');

  useEffect(() => {
    const handleOpen = (e: CustomEvent<CloningEventDetail>) => {
      setData(e.detail);
      setIsOpen(true);
      setStatus('checking');
      setProgress(0);
      setMessage('Preparing...');
    };

    window.addEventListener('open-cloning-modal', handleOpen as EventListener);
    return () => window.removeEventListener('open-cloning-modal', handleOpen as EventListener);
  }, []);

  useEffect(() => {
    if (isOpen && data) {
      startCloning();
    }
  }, [isOpen, data]);

  const onClose = () => {
    setIsOpen(false);
    setData(null);
  };

  const startCloning = async () => {
    if (!data) return;

    try {
      setStatus('checking');
      setMessage('Checking authorization...');
      setProgress(10);
      const { canClone, reason } = await checkUserCanClone();
      if (!canClone) throw new Error(reason || 'Unable to clone voice');

      setProgress(30);
      setMessage('Processing audio...');
      setStatus('cloning');

      let result: CloneVoiceResponse;
      if (data.isMultiCharacter) {
        result = await cloneMultiVoice({
          characters: [
            { characterId: data.characterId, text: data.texts ? data.texts[0] : data.text, audioFile: data.audioFile },
            ...(data.additionalCharacters || []),
          ],
        });
      } else {
        result = await cloneSingleVoice({
          characterId: data.characterId,
          text: data.text,
          audioFile: data.audioFile,
        });
      }

      setProgress(90);
      setMessage('Finalizing...');

      setTimeout(() => {
        setProgress(100);
        setStatus('complete');
        setMessage('Done!');

        setTimeout(() => {
          setIsOpen(false);
          window.dispatchEvent(new CustomEvent('open-preview-modal', {
            detail: {
              audioBlob: result.audioBlob,
              source: data.isMultiCharacter ? 'multi-character' : 'single-character',
              characterId: data.characterId,
              text: data.text,
              isMultiCharacter: data.isMultiCharacter,
              characterIds: data.characterIds,
              texts: data.texts,
            }
          }));
        }, 500);
      }, 500);

    } catch (error: any) {
      setStatus('error');
      setMessage(error.message || 'Failed to clone voice');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content cloning-modal">
        {/* Mobile Handle */}
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

        <div className="modal-header">
          <div className="modal-title-group">
            <Icon icon="lucide:sparkles" width={20} height={20} style={{ color: 'var(--pink-9)' }} />
            <span className="modal-title">Cloning</span>
          </div>
          {status === 'error' && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon icon="lucide:x" width={20} height={20} />
            </button>
          )}
        </div>

        <div className="modal-body" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '250px',
          textAlign: 'center'
        }}>
          <div className="progress-circle" style={{ position: 'relative', width: 120, height: 120, marginBottom: '24px' }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--mauve-3)" strokeWidth="6" />
              <circle
                cx="60" cy="60" r="54" fill="none"
                stroke={status === 'error' ? 'var(--red-9)' : 'var(--pink-9)'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress / 100)}`}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
              />
            </svg>
            <div className="progress-content" style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {status === 'error' ? (
                <Icon icon="lucide:alert-circle" width={40} style={{ color: 'var(--red-9)' }} />
              ) : status === 'complete' ? (
                <Icon icon="lucide:check" width={40} style={{ color: 'var(--pink-9)' }} />
              ) : (
                <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--pink-9)', fontVariantNumeric: 'tabular-nums' }}>
                  {progress}%
                </span>
              )}
            </div>
          </div>

          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: 'var(--mauve-12)' }}>
            {status === 'checking' && 'Authorizing...'}
            {status === 'cloning' && 'Generating Voice...'}
            {status === 'complete' && 'Complete!'}
            {status === 'error' && 'Something went wrong'}
          </h3>

          <p style={{ color: 'var(--mauve-11)', margin: 0, fontSize: '15px' }}>{message}</p>

          {status === 'error' && (
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '24px' }}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}