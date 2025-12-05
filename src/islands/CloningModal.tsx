import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { cloneSingleVoice, cloneMultiVoice, checkUserCanClone, type CloneVoiceResponse } from '@/lib/api/voiceClone';
import '@/styles/modal.css';

interface CloningEventDetail {
  characterId: string;
  text: string;
  isMultiCharacter?: boolean;
  characterIds?: string[];
  texts?: string[];
}

// Helper for friendly error mapping
const getFriendlyErrorMessage = (errorMsg: string): string => {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch')) return "We're having trouble reaching our audio lab. Check your connection.";
  if (lower.includes('unauthorized') || lower.includes('token')) return "We need to verify your identity again.";
  if (lower.includes('quota') || lower.includes('limit')) return "You've used all your voice magic for now.";
  if (lower.includes('format') || lower.includes('type')) return "This audio file format is a bit tricky for us.";
  if (lower.includes('audio for character')) return "Couldn't load character voice sample. Please try again.";
  return "Our sound wizards hit a snag. Please try again.";
};

export default function CloningModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<CloningEventDetail | null>(null);

  const [status, setStatus] = useState<'checking' | 'cloning' | 'complete' | 'error'>('checking');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Warming up engines...');

  // Ref for the fake progress interval so we can clear it easily
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<CloningEventDetail>) => {
      setData(e.detail);
      setIsOpen(true);
      setStatus('checking');
      setProgress(0);
      setMessage('Warming up engines...');
    };

    window.addEventListener('open-cloning-modal', handleOpen as EventListener);
    return () => window.removeEventListener('open-cloning-modal', handleOpen as EventListener);
  }, []);

  useEffect(() => {
    if (isOpen && data) {
      startCloning();
    }
    // Cleanup interval on unmount or close
    return () => stopProgressSimulation();
  }, [isOpen, data]);

  const onClose = () => {
    stopProgressSimulation();
    setIsOpen(false);
    setData(null);
  };

  const stopProgressSimulation = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  };

  const startCloning = async () => {
    if (!data) return;

    try {
      // 1. Authorization Phase (Playful Tone)
      setStatus('checking');
      setMessage('Consulting the audio oracles...');
      setProgress(10);

      const { canClone, reason } = await checkUserCanClone();
      if (!canClone) throw new Error(reason || 'Unable to clone voice');

      // 2. Processing Phase
      setStatus('cloning');
      setMessage('Teaching the AI to speak...');
      setProgress(30);

      // Start "Fake" progress to make it feel alive while waiting for API
      // It will move from 30% to 85% over time, but never hit 100% until done
      stopProgressSimulation();
      progressInterval.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 85) return prev;
          // Slow down as we get higher
          const increment = prev > 70 ? 0.2 : 0.8;
          return prev + increment;
        });
      }, 100);

      let result: CloneVoiceResponse;
      if (data.isMultiCharacter && data.characterIds && data.texts) {
        // Multi-character cloning
        result = await cloneMultiVoice({
          characters: data.characterIds.map((charId, idx) => ({
            characterId: charId,
            text: data.texts![idx],
          })),
        });
      } else {
        // Single-character cloning
        result = await cloneSingleVoice({
          characterId: data.characterId,
          text: data.text,
        });
      }

      // 3. Completion Phase
      stopProgressSimulation();
      setProgress(100);
      setMessage('Polishing the final audio...'); // Brief final status

      setTimeout(() => {
        setStatus('complete');
        setMessage('Voice successfully cloned!');

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
        }, 800); // Slightly longer pause to let them see the "Complete" checkmark
      }, 400);

    } catch (error: any) {
      stopProgressSimulation();
      setStatus('error');
      // Use friendly error mapping
      setMessage(getFriendlyErrorMessage(error.message || ''));
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
                  {Math.floor(progress)}%
                </span>
              )}
            </div>
          </div>

          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', color: 'var(--mauve-12)' }}>
            {status === 'checking' && 'Verifying...'}
            {status === 'cloning' && 'Synthesizing Audio...'}
            {status === 'complete' && 'All Done!'}
            {status === 'error' && 'Oops!'}
          </h3>

          <p style={{ color: 'var(--mauve-11)', margin: 0, fontSize: '15px', maxWidth: '80%' }}>
            {message}
          </p>

          {status === 'error' && (
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '24px' }}>
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}