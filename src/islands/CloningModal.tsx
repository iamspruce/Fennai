import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cloneSingleVoice, cloneMultiVoice, checkUserCanClone, type CloneVoiceResponse } from '@/lib/api/voiceClone';

interface CloningEventDetail {
  characterId: string;
  text: string;
  audioFile: File;
  isMultiCharacter?: boolean;
  characterIds?: string[];
  texts?: string[]; // Individual text for each character
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
      // Step 1: Check authorization
      setStatus('checking');
      setMessage('Checking authorization...');
      setProgress(10);

      const { canClone, reason } = await checkUserCanClone();

      if (!canClone) {
        throw new Error(reason || 'Unable to clone voice');
      }

      setProgress(30);
      setMessage('Cloning voice...');

      // Step 2: Clone voice
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
      setMessage('Processing...');

      // Step 3: Complete
      setTimeout(() => {
        setProgress(100);
        setStatus('complete');
        setMessage('Voice cloned successfully!');

        // Auto-transition to Preview Modal after success
        setTimeout(() => {
          setIsOpen(false);

          // Dispatch event with full dialogue data
          window.dispatchEvent(new CustomEvent('open-preview-modal', {
            detail: {
              audioBlob: result.audioBlob,
              source: data.isMultiCharacter ? 'multi-character' : 'single-character',
              characterId: data.characterId,
              text: data.text,
              isMultiCharacter: data.isMultiCharacter,
              characterIds: data.characterIds,
              texts: data.texts, // Pass individual texts
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
        <div className="modal-header">
          <Icon icon="lucide:sparkles" width={32} height={32} style={{ color: 'var(--pink-9)' }} />
          {status === 'error' && (
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <Icon icon="lucide:x" width={20} height={20} />
            </button>
          )}
        </div>

        <div className="cloning-body">
          <div className="progress-circle">
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="var(--mauve-4)" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="54" fill="none"
                stroke={status === 'error' ? '#ef4444' : 'var(--pink-9)'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress / 100)}`}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
            </svg>
            <div className="progress-content">
              {status === 'error' ? (
                <Icon icon="lucide:alert-circle" width={40} height={40} style={{ color: '#ef4444' }} />
              ) : status === 'complete' ? (
                <Icon icon="lucide:check" width={40} height={40} style={{ color: 'var(--pink-9)' }} />
              ) : (
                <span className="progress-text">{progress}%</span>
              )}
            </div>
          </div>

          <h3 className="cloning-title">
            {status === 'checking' && 'Authorizing...'}
            {status === 'cloning' && 'Cloning Voice...'}
            {status === 'complete' && 'Complete!'}
            {status === 'error' && 'Error'}
          </h3>

          <p className="cloning-message">{message}</p>

          {status === 'error' && (
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}