// src/islands/RecordVoiceModal.tsx
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { getPromptsForLanguage } from '@/lib/constants/recordingPrompts';
import "@/styles/modal.css";

interface RecordVoiceModalProps {
    userName: string;
}

// ... (Keep existing SUPPORTED_LANGUAGES array unchanged) ...
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
    { code: 'zh', name: 'Chinese (Simplified)' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'tr', name: 'Turkish' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'th', name: 'Thai' },
    { code: 'nl', name: 'Dutch' },
    { code: 'pl', name: 'Polish' },
    { code: 'uk', name: 'Ukrainian' },
];

export default function RecordVoiceModal({ userName }: RecordVoiceModalProps) {
    // ... (Keep existing state and refs unchanged) ...
    const [isOpen, setIsOpen] = useState(false);
    const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [showLanguageSelect, setShowLanguageSelect] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const prompts = selectedLanguage ? getPromptsForLanguage(selectedLanguage) : [];

    // ... (Keep existing useEffects and functions: handleOpen, loadVoices, resetState, requestMicPermission, etc.) ...

    // Copy all the logic functions (useEffect, resetState, requestMicPermission, startRecording, stopRecording, drawWaveform, etc) exactly as they were in the original file. 
    // I am omitting them here for brevity, but in your file, ensure they are present.

    // NOTE: Insert logic functions here...
    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetState();
        };

        window.addEventListener('open-record-modal', handleOpen);
        return () => window.removeEventListener('open-record-modal', handleOpen);
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

    const resetState = () => {
        setSelectedLanguage(null);
        setHasPermission(false);
        setIsRecording(false);
        setCurrentPromptIndex(0);
        setRecordedBlob(null);
        setShowLanguageSelect(false);
        audioChunksRef.current = [];
    };

    const requestMicPermission = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setHasPermission(true);

            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 2048;

            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);

            mediaRecorderRef.current = new MediaRecorder(stream);
            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
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

        const interval = setInterval(() => {
            setCurrentPromptIndex((prev) => {
                if (prev >= prompts.length - 1) {
                    clearInterval(interval);
                    stopRecording();
                    return prev;
                }
                return prev + 1;
            });
        }, 3000);
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const drawWaveform = () => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);

        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationFrameRef.current = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);

            ctx.clearRect(0, 0, width, height); // Clear transparently

            ctx.lineWidth = 3;
            ctx.strokeStyle = '#e93d82'; // Hardcoded pink-9 for canvas
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
        window.dispatchEvent(new CustomEvent('voice-file-updated', { detail: recordedBlob }));
        setIsOpen(false);
    };

    const handleRetry = () => {
        setRecordedBlob(null);
        setCurrentPromptIndex(0);
    };

    if (!isOpen) return null;

    const canBeginRecording = selectedLanguage && hasPermission;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
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
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {!recordedBlob ? (
                        <div className="recorder-flow">
                            {/* Step 1: Language */}
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
                                <>
                                    {/* Active Recorder UI */}
                                    <div className="active-recording-container">
                                        {/* Waveform Area */}
                                        <div className="waveform-box">
                                            <canvas ref={canvasRef} className="waveform-canvas" />
                                            {!isRecording && !hasPermission && (
                                                <div className="waveform-placeholder">
                                                    <Icon icon="lucide:activity" width={48} />
                                                </div>
                                            )}
                                        </div>

                                        {/* Info / Prompts */}
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
                                                    <p>Click record and read the text aloud clearly.</p>
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
                                                    <p className="step-counter">{currentPromptIndex + 1} / {prompts.length}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        /* Review State */
                        <div className="review-state">
                            <div className="success-icon">
                                <Icon icon="lucide:check" width={32} />
                            </div>
                            <h3>Recording Complete</h3>

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
                    padding: var(--space-s);
                    background: var(--mauve-2);
                    border: 1px solid var(--mauve-6);
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
                }

                .active-recording-container {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-l);
                    height: 100%;
                }

                .waveform-box {
                    background: var(--mauve-2);
                    border-radius: var(--radius-l);
                    height: 140px;
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .waveform-canvas {
                    width: 100%;
                    height: 100%;
                }

                .waveform-placeholder {
                    position: absolute;
                    color: var(--mauve-6);
                }

                .info-area {
                    text-align: center;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                
                .permission-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-s);

                }
                .ready-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }

                .language-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 12px;
                    background: var(--mauve-3);
                    border-radius: 20px;
                    font-size: 13px;
                    color: var(--mauve-11);
                    margin-bottom: var(--space-s);
                }

                .btn-record-large {
                    width: 72px;
                    height: 72px;
                    border-radius: 50%;
                    border: 4px solid var(--mauve-4);
                    background: transparent;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    margin-top: var(--space-m);
                    transition: all 0.3s;
                }
                .btn-record-large:hover {
                    border-color: var(--orange-9);
                    transform: scale(1.05);
                }
                
                .inner-red-dot {
                    width: 50px;
                    height: 50px;
                    background: var(--red-9);
                    border-radius: 50%;
                }

                .prompt-card {
                    margin-bottom: var(--space-m);
                    min-height: 80px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .prompt-text {
                    font-size: 24px;
                    font-weight: 600;
                    line-height: 1.3;
                    color: var(--mauve-12);
                }

                .progress-bar-container {
                    width: 100%;
                    height: 6px;
                    background: var(--mauve-4);
                    border-radius: 3px;
                    overflow: hidden;
                    margin-bottom: 8px;
                }

                .progress-fill {
                    height: 100%;
                    background: var(--orange-9);
                    transition: width 0.3s ease;
                }
                
                .step-counter {
                    font-size: 13px;
                    color: var(--mauve-10);
                    font-variant-numeric: tabular-nums;
                }

                .review-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding-top: var(--space-l);
                }

                .success-icon {
                    width: 64px;
                    height: 64px;
                    border-radius: 50%;
                    background: var(--green-3);
                    color: var(--green-9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: var(--space-m);
                }

                .audio-preview {
                    width: 100%;
                    margin: var(--space-m) 0;
                }
                
                .audio-preview audio {
                    width: 100%;
                }

                .review-actions {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: var(--space-m);
                    width: 100%;
                }

                .btn-primary, .btn-secondary {
                    padding: 12px;
                    border-radius: var(--radius-m);
                    font-weight: 600;
                    cursor: pointer;
                    border: none;
                    width: 100%;
                }
                .btn-primary { background: var(--orange-9); color: white; }
                .btn-secondary { background: var(--mauve-3); color: var(--mauve-12); }
            `}</style>
        </div>
    );
}