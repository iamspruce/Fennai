// components/CloningModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import {
  cloneSingleVoice,
  cloneMultiVoice,
  checkUserCanClone,
  type CloneVoiceResponse,
  type JobStatus
} from '@/lib/api/voiceClone';
import '@/styles/modal.css';

interface CloningEventDetail {
  characterId: string;
  text: string;
  isMultiCharacter?: boolean;
  characterIds?: string[];
  texts?: string[];
}

const getFriendlyErrorMessage = (errorMsg: string): string => {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('network') || lower.includes('fetch')) return "We're having trouble reaching our audio lab. Check your connection.";
  if (lower.includes('unauthorized') || lower.includes('token')) return "We need to verify your identity again.";
  if (lower.includes('insufficient credits')) return "You've used all your voice magic for now.";
  if (lower.includes('timed out')) return "Generation took too long. Please try again.";
  if (lower.includes('format') || lower.includes('type')) return "This audio file format is a bit tricky for us.";
  if (lower.includes('audio for character')) return "Couldn't load character voice sample. Please try again.";
  return "Our sound wizards hit a snag. Please try again.";
};

const getStatusMessage = (status: JobStatus['status']): string => {
  switch (status) {
    case 'queued':
      return 'Job queued, waiting for processing...';
    case 'processing':
      return 'AI is learning the voice patterns...';
    case 'completed':
      return 'Voice successfully cloned!';
    case 'failed':
      return 'Generation failed';
    default:
      return 'Preparing...';
  }
};

export default function CloningModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<CloningEventDetail | null>(null);

  const [status, setStatus] = useState<'checking' | 'cloning' | 'complete' | 'error'>('checking');
  const [jobStatus, setJobStatus] = useState<JobStatus['status']>('queued');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Warming up engines...');

  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<CloningEventDetail>) => {
      setData(e.detail);
      setIsOpen(true);
      setStatus('checking');
      setJobStatus('queued');
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
      // 1. Authorization Phase
      setStatus('checking');
      setMessage('Consulting the audio oracles...');
      setProgress(10);

      const { canClone, reason } = await checkUserCanClone();
      if (!canClone) throw new Error(reason || 'Unable to clone voice');

      // 2. Processing Phase
      setStatus('cloning');
      setJobStatus('queued');
      setMessage('Queueing generation job...');
      setProgress(20);

      // Start fake progress animation
      stopProgressSimulation();
      progressInterval.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          const increment = prev > 70 ? 0.3 : 0.8;
          return prev + increment;
        });
      }, 150);

      // Handle status updates from Firestore
      const onStatusUpdate = (jobStatusUpdate: JobStatus) => {
        setJobStatus(jobStatusUpdate.status);
        setMessage(getStatusMessage(jobStatusUpdate.status));

        // Update progress based on status
        if (jobStatusUpdate.status === 'queued') {
          setProgress(30);
        } else if (jobStatusUpdate.status === 'processing') {
          setProgress(50);
        }
      };

      let result: CloneVoiceResponse;
      if (data.isMultiCharacter && data.characterIds && data.texts) {
        result = await cloneMultiVoice({
          characters: data.characterIds.map((charId, idx) => ({
            characterId: charId,
            text: data.texts![idx],
          })),
        }, onStatusUpdate);
      } else {
        result = await cloneSingleVoice({
          characterId: data.characterId,
          text: data.text,
        }, onStatusUpdate);
      }

      // 3. Completion Phase
      stopProgressSimulation();
      setProgress(100);
      setJobStatus('completed');
      setMessage('Polishing the final audio...');

      setTimeout(() => {
        setStatus('complete');

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
        }, 800);
      }, 400);

    } catch (error: any) {
      stopProgressSimulation();
      setStatus('error');
      setJobStatus('failed');
      setMessage(getFriendlyErrorMessage(error.message || ''));
      console.error('Cloning error:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content cloning-modal">
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
            {status === 'cloning' && jobStatus === 'queued' && 'Queued...'}
            {status === 'cloning' && jobStatus === 'processing' && 'Synthesizing Audio...'}
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