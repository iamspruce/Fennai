import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';

interface RecordVoiceModalProps {
    userName?: string;
}

const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'tr', name: 'Turkish' },
    { code: 'vi', name: 'Vietnamese' },
];

// Sample prompts - you should import from your actual prompts file
const PROMPTS_BY_LANGUAGE: Record<string, string[]> = {
    en: [
        "The quick brown fox jumps over the lazy dog.",
        "Hello, my name is Claude and I'm here to help.",
        "Technology is rapidly changing our world.",
        "Every person deserves kindness and respect.",
    ],
    es: [
        "El rápido zorro marrón salta sobre el perro perezoso.",
        "Hola, mi nombre es Claude y estoy aquí para ayudar.",
        "La tecnología está cambiando rápidamente nuestro mundo.",
        "Cada persona merece bondad y respeto.",
    ],
    // Add other languages as needed
};

const getPromptsForLanguage = (langCode: string): string[] => {
    return PROMPTS_BY_LANGUAGE[langCode] || PROMPTS_BY_LANGUAGE.en;
};

export default function RecordVoiceModal({ userName = 'Friend' }: RecordVoiceModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const promptIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const prompts = selectedLanguage ? getPromptsForLanguage(selectedLanguage) : [];

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetState();
        };

        window.addEventListener('open-record-modal', handleOpen);
        return () => {
            window.removeEventListener('open-record-modal', handleOpen);
            cleanup();
        };
    }, []);

    useEffect(() => {
        if (isRecording) {
            drawWaveform();
        }
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isRecording]);

    // Listen for voice-edited event to get the trimmed audio back
    useEffect(() => {
        const handleVoiceEdited = (e: CustomEvent) => {
            if (e.detail.source === 'record-modal') {
                const file = new File([e.detail.blob], 'recorded_voice.wav', { type: 'audio/wav' });
                window.dispatchEvent(new CustomEvent('voice-file-updated', { detail: file }));
            }
        };

        window.addEventListener('voice-edited', handleVoiceEdited as EventListener);
        return () => window.removeEventListener('voice-edited', handleVoiceEdited as EventListener);
    }, []);

    const cleanup = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (promptIntervalRef.current) {
            clearInterval(promptIntervalRef.current);
            promptIntervalRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    };

    const resetState = () => {
        setSelectedLanguage(null);
        setHasPermission(false);
        setIsRecording(false);
        setCurrentPromptIndex(0);
        setRecordedBlob(null);
        audioChunksRef.current = [];
        cleanup();
    };

    const requestMicPermission = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            streamRef.current = stream;
            setHasPermission(true);

            // Set up audio context for visualization
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 2048;

            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);

            // Set up media recorder
            const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/mp4';

            mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mimeType });
                setRecordedBlob(blob);
            };
        } catch (error) {
            console.error('Mic permission denied:', error);
            alert('Microphone access is required to record your voice.');
        }
    };

    const startRecording = () => {
        if (!mediaRecorderRef.current) return;

        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
        setIsRecording(true);
        setCurrentPromptIndex(0);

        // Auto-advance through prompts every 4 seconds
        promptIntervalRef.current = setInterval(() => {
            setCurrentPromptIndex((prev) => {
                const nextIndex = prev + 1;
                if (nextIndex >= prompts.length) {
                    // We've reached the end, stop recording
                    if (promptIntervalRef.current) {
                        clearInterval(promptIntervalRef.current);
                        promptIntervalRef.current = null;
                    }
                    // Stop recording after a short delay to capture the last prompt
                    setTimeout(() => {
                        stopRecording();
                    }, 500);
                    return prev;
                }
                return nextIndex;
            });
        }, 4000);
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);

            if (promptIntervalRef.current) {
                clearInterval(promptIntervalRef.current);
                promptIntervalRef.current = null;
            }
        }
    };

    const drawWaveform = () => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!isRecording) return;

            animationFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);

            ctx.clearRect(0, 0, width, height);

            ctx.lineWidth = 3;
            ctx.strokeStyle = '#e93d82';
            ctx.beginPath();

            const sliceWidth = width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * height) / 2;

                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);

                x += sliceWidth;
            }

            ctx.lineTo(width, height / 2);
            ctx.stroke();
        };

        draw();
    };

    const handleUseRecording = () => {
        if (!recordedBlob) return;

        // Option 1: Trigger preview/edit modal (if you want users to edit)
        window.dispatchEvent(new CustomEvent('open-preview-modal', {
            detail: {
                audioBlob: recordedBlob,
                source: 'record-modal',
                mediaType: 'audio'
            }
        }));

        // Option 2: Or directly dispatch the file (uncomment if you don't want editing)
        // const file = new File([recordedBlob], 'recorded_voice.webm', { type: recordedBlob.type });
        // window.dispatchEvent(new CustomEvent('voice-file-updated', { detail: file }));

        handleClose();
    };

    const handleRetry = () => {
        setRecordedBlob(null);
        setCurrentPromptIndex(0);
        audioChunksRef.current = [];
    };

    const handleClose = () => {
        cleanup();
        setIsOpen(false);
        resetState();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <div className="icon-circle">
                            <Icon icon="lucide:mic" width={20} />
                        </div>
                        <h3 className="modal-title">Voice Recorder</h3>
                    </div>
                    <button className="modal-close" onClick={handleClose}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {!recordedBlob ? (
                        <div className="recorder-flow">
                            {!selectedLanguage ? (
                                <div className="step-selection">
                                    <h4 className="step-title">Select your language</h4>
                                    <div className="language-grid">
                                        {SUPPORTED_LANGUAGES.map((lang) => (
                                            <button
                                                key={lang.code}
                                                className="language-card"
                                                onClick={() => setSelectedLanguage(lang.code)}
                                            >
                                                {lang.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="active-recording-container">
                                    <div className="waveform-box">
                                        <canvas ref={canvasRef} className="waveform-canvas" />
                                        {!isRecording && !hasPermission && (
                                            <div className="waveform-placeholder">
                                                <Icon icon="lucide:activity" width={48} />
                                            </div>
                                        )}
                                    </div>

                                    <div className="info-area">
                                        {!hasPermission ? (
                                            <div className="permission-state">
                                                <p>We need microphone access to record your voice.</p>
                                                <button className="btn btn-primary" onClick={requestMicPermission}>
                                                    Enable Microphone
                                                </button>
                                            </div>
                                        ) : !isRecording ? (
                                            <div className="ready-state">
                                                <div className="language-badge">
                                                    <Icon icon="lucide:globe" width={14} />
                                                    {SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage)?.name}
                                                </div>
                                                <p style={{ marginBottom: 'var(--space-m)', color: 'var(--mauve-11)' }}>
                                                    Click record and read each prompt aloud clearly.
                                                </p>
                                                <button className="btn-record-large" onClick={startRecording}>
                                                    <div className="inner-red-dot"></div>
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="recording-state">
                                                <div className="prompt-card">
                                                    <p className="prompt-text">{prompts[currentPromptIndex]}</p>
                                                </div>
                                                <div className="progress-bar-container">
                                                    <div
                                                        className="progress-fill"
                                                        style={{ width: `${((currentPromptIndex + 1) / prompts.length) * 100}%` }}
                                                    />
                                                </div>
                                                <p className="step-counter">
                                                    {currentPromptIndex + 1} / {prompts.length}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="review-state">
                            <div className="success-icon">
                                <Icon icon="lucide:check" width={32} />
                            </div>
                            <h3 style={{ marginBottom: 'var(--space-m)', color: 'var(--mauve-12)' }}>
                                Recording Complete
                            </h3>

                            <div className="audio-preview">
                                <audio controls src={URL.createObjectURL(recordedBlob)} />
                            </div>

                            <div className="review-actions">
                                <button className="btn-secondary" onClick={handleRetry}>
                                    Try Again
                                </button>
                                <button className="btn-primary" onClick={handleUseRecording}>
                                    Use Recording
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <style>{`
          .icon-circle {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--orange-3);
            color: var(--orange-9);
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .step-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--mauve-12);
            margin-bottom: var(--space-m);
            text-align: center;
          }

          .language-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
            gap: var(--space-s);
          }

          .language-card {
            padding: var(--space-m);
            background: var(--mauve-2);
            border: 2px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-11);
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }
          .language-card:hover {
            border-color: var(--orange-7);
            background: var(--orange-2);
            color: var(--orange-11);
            transform: translateY(-2px);
          }

          .active-recording-container {
            display: flex;
            flex-direction: column;
            gap: var(--space-l);
          }

          .waveform-box {
            background: var(--mauve-12);
            border-radius: var(--radius-l);
            height: 140px;
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--mauve-6);
          }

          .waveform-canvas {
            width: 100%;
            height: 100%;
            display: block;
          }

          .waveform-placeholder {
            position: absolute;
            color: var(--mauve-11);
          }

          .info-area {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          
          .permission-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-m);
          }
          
          .permission-state p {
            color: var(--mauve-11);
            font-size: 15px;
          }
          
          .ready-state {
            display: flex;
            flex-direction: column;
            align-items: center;
          }

          .language-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            background: var(--mauve-3);
            border-radius: 20px;
            font-size: 13px;
            color: var(--mauve-11);
            margin-bottom: var(--space-s);
            font-weight: 500;
          }

          .btn-record-large {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            border: 4px solid var(--mauve-6);
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-top: var(--space-s);
            transition: all 0.3s;
          }
          .btn-record-large:hover {
            border-color: var(--red-9);
            transform: scale(1.05);
            box-shadow: 0 4px 12px rgba(233, 61, 130, 0.3);
          }
          
          .inner-red-dot {
            width: 56px;
            height: 56px;
            background: var(--red-9);
            border-radius: 50%;
          }

          .recording-state {
            width: 100%;
          }

          .prompt-card {
            margin-bottom: var(--space-l);
            min-height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--space-m);
            background: var(--mauve-2);
            border-radius: var(--radius-m);
            border: 2px solid var(--mauve-6);
          }

          .prompt-text {
            font-size: 20px;
            font-weight: 600;
            line-height: 1.4;
            color: var(--mauve-12);
            margin: 0;
          }

          .progress-bar-container {
            width: 100%;
            height: 8px;
            background: var(--mauve-4);
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: var(--space-s);
          }

          .progress-fill {
            height: 100%;
            background: var(--orange-9);
            transition: width 0.5s ease;
          }
          
          .step-counter {
            font-size: 14px;
            color: var(--mauve-10);
            font-variant-numeric: tabular-nums;
            font-weight: 600;
            margin: 0;
          }

          .review-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: var(--space-l) 0;
          }

          .success-icon {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: var(--green-3);
            color: var(--green-9);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: var(--space-m);
            border: 3px solid var(--green-6);
          }

          .audio-preview {
            width: 100%;
            margin: var(--space-l) 0;
          }
          
          .audio-preview audio {
            width: 100%;
            border-radius: var(--radius-m);
          }

          .review-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-s);
            width: 100%;
            margin-top: var(--space-m);
          }

          .btn-primary, .btn-secondary {
            padding: 14px;
            border-radius: var(--radius-m);
            font-weight: 600;
            cursor: pointer;
            border: none;
            font-size: 15px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .btn-primary { 
            background: var(--orange-9); 
            color: white; 
          }
          .btn-primary:hover {
            background: var(--orange-10);
          }
          .btn-secondary { 
            background: var(--mauve-3); 
            color: var(--mauve-12);
            border: 1px solid var(--mauve-6);
          }
          .btn-secondary:hover {
            background: var(--mauve-4);
          }
        `}</style>
            </div>
        </div>
    );
}