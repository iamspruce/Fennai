import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '@/types/character';
import { UPLOAD_LIMITS, SUPPORTED_LANGUAGES } from '@/types/dubbing';
import { saveDubbingMedia } from '@/lib/db/indexdb';
import { transcribeDubbing, getDubbingUploadUrl } from '@/lib/api/apiClient';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DubbingJob } from '@/types/dubbing';

interface DubMediaSelectModalProps {
    character: Character;
    allCharacters: Character[];
    userTier: 'free' | 'pro' | 'enterprise';
}

export default function DubMediaSelectModal({
    character,
    allCharacters,
    userTier,
}: DubMediaSelectModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [mediaType, setMediaType] = useState<'audio' | 'video'>('audio');
    const [duration, setDuration] = useState(0);
    const [mainLanguage, setMainLanguage] = useState('en');
    const [otherLanguages, setOtherLanguages] = useState<string[]>([]);
    const [otherLangInput, setOtherLangInput] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<DubbingJob | null>(null);
    const [error, setError] = useState('');
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const otherLangInputRef = useRef<HTMLInputElement>(null);
    const limits = UPLOAD_LIMITS[userTier];

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetForm();
        };

        const handleMediaSaved = (e: CustomEvent) => {
            console.log('[DubMediaSelectModal] Media saved from preview:', e.detail);
            const { blob, duration, mediaType, fileName } = e.detail;

            const newFile = new File([blob], fileName || 'media', { type: blob.type });
            setFile(newFile);
            setDuration(duration);
            setMediaType(mediaType);
            setIsOpen(true);
        };

        const handleCancel = () => {
            console.log('[DubMediaSelectModal] Media preview cancelled');
            resetForm();
            setIsOpen(true);
        };

        window.addEventListener('open-dubbing-modal', handleOpen);
        window.addEventListener('media-preview-saved', handleMediaSaved as EventListener);
        window.addEventListener('media-preview-cancelled', handleCancel);

        return () => {
            window.removeEventListener('open-dubbing-modal', handleOpen);
            window.removeEventListener('media-preview-saved', handleMediaSaved as EventListener);
            window.removeEventListener('media-preview-cancelled', handleCancel);
        };
    }, []);

    // Listen to job status if we have a currentJobId
    useEffect(() => {
        if (!currentJobId || !isOpen) return;

        console.log('[DubMediaSelectModal] Listening to job:', currentJobId);
        const unsubscribe = onSnapshot(doc(db, 'dubbingJobs', currentJobId), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as DubbingJob;
                setJobStatus(data);
                console.log('[DubMediaSelectModal] Job status update:', data.status);

                if (data.status === 'transcribing_done') {
                    // Success! Move to settings
                    window.dispatchEvent(
                        new CustomEvent('open-dub-settings', {
                            detail: {
                                jobId: currentJobId,
                                defaultCharacterId: character.id
                            }
                        })
                    );
                    setIsOpen(false);
                    resetForm();
                } else if (data.status === 'failed') {
                    const errorMsg = data.error || 'Transcription failed';
                    setError(errorMsg);
                    setIsProcessing(false);
                    localStorage.removeItem('activeJob');
                    setCurrentJobId(null); // Stop listening to failed job

                    window.dispatchEvent(new CustomEvent('show-alert', {
                        detail: {
                            title: 'Transcription Failed',
                            message: 'Something went wrong while analyzing your media.',
                            type: 'error',
                            details: `Job Error: ${errorMsg}`
                        }
                    }));
                }
            }
        });

        return () => unsubscribe();
    }, [currentJobId, isOpen]);

    const resetForm = () => {
        setFile(null);
        setDuration(0);
        setMainLanguage('en');
        setOtherLanguages([]);
        setOtherLangInput('');
        setError('');
        setIsProcessing(false);
        setIsUploading(false);
        setCurrentJobId(null);
        setJobStatus(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
            validateAndSetFile(droppedFile);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            validateAndSetFile(selectedFile);
        }
    };

    const validateAndSetFile = async (selectedFile: File) => {
        setError('');

        // Check file type
        const isAudio = selectedFile.type.startsWith('audio/');
        const isVideo = selectedFile.type.startsWith('video/');

        if (!isAudio && !isVideo) {
            setError('Please upload an audio or video file');
            return;
        }

        setMediaType(isVideo ? 'video' : 'audio');

        // Check file size
        const sizeMB = selectedFile.size / (1024 * 1024);
        if (sizeMB > limits.maxFileSizeMB) {
            setError(`File size exceeds ${limits.maxFileSizeMB}MB limit for ${userTier} tier`);
            return;
        }

        // Get duration
        try {
            const fileDuration = await getMediaDuration(selectedFile, isVideo ? 'video' : 'audio');

            if (fileDuration > limits.maxDurationSeconds) {
                setError(`Duration exceeds ${limits.maxDurationSeconds}s limit for ${userTier} tier`);
                return;
            }

            // We don't set the file yet, we wait for confirmation in the preview modal
            // setDuration(fileDuration);
            // setFile(selectedFile);

            // Auto-open preview/edit modal
            const reader = new FileReader();
            reader.onload = () => {
                window.dispatchEvent(
                    new CustomEvent('open-preview-modal', {
                        detail: {
                            audioBlob: selectedFile,
                            fileName: selectedFile.name,
                            source: 'dubbing',
                            mediaType: isVideo ? 'video' : 'audio',
                        }
                    })
                );
            };
            reader.readAsDataURL(selectedFile);

        } catch (err) {
            setError('Failed to process media file');
            console.error(err);
        }
    };

    const getMediaDuration = (file: File, type: 'audio' | 'video'): Promise<number> => {
        return new Promise((resolve, reject) => {
            const element = document.createElement(type);
            const url = URL.createObjectURL(file);

            element.addEventListener('loadedmetadata', () => {
                URL.revokeObjectURL(url);
                resolve(element.duration);
            });

            element.addEventListener('error', () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load media'));
            });

            element.src = url;
        });
    };

    const handleAddOtherLanguage = () => {
        const lang = otherLangInput.trim();
        if (lang && !otherLanguages.includes(lang)) {
            setOtherLanguages([...otherLanguages, lang]);
            setOtherLangInput('');
        }
    };

    const handleRemoveOtherLanguage = (lang: string) => {
        setOtherLanguages(otherLanguages.filter(l => l !== lang));
    };

    const handleUseMedia = async () => {
        if (!file) return;

        setIsUploading(true);
        setError('');

        try {
            // 1. Get Signed URL for direct upload
            const { uploadUrl, mediaPath } = await getDubbingUploadUrl({
                fileName: file.name,
                contentType: file.type || (mediaType === 'video' ? 'video/mp4' : 'audio/wav'),
            });

            // 2. Upload directly to GCS
            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type || (mediaType === 'video' ? 'video/mp4' : 'audio/wav'),
                },
            });

            if (!uploadResponse.ok) {
                throw new Error('Failed to upload file to storage');
            }

            // 3. Call transcribe API with the GCS path
            const result = await transcribeDubbing({
                mediaPath,
                mediaType,
                fileName: file.name,
                duration,
                fileSizeMB: file.size / (1024 * 1024),
                detectedLanguage: SUPPORTED_LANGUAGES.find(l => l.code === mainLanguage)?.name || 'English',
                detectedLanguageCode: mainLanguage,
                otherLanguages,
                characterId: character.id,
            });

            // Save media to IndexedDB for preview
            const fileBuffer = await file.arrayBuffer();
            await saveDubbingMedia({
                id: result.jobId,
                mediaType,
                audioData: mediaType === 'audio' ? fileBuffer : new ArrayBuffer(0),
                audioType: mediaType === 'audio' ? file.type : '',
                videoData: mediaType === 'video' ? fileBuffer : undefined,
                videoType: mediaType === 'video' ? file.type : undefined,
                duration,
                fileSize: file.size,
                createdAt: Date.now(),
            });

            // 4. Persistence
            localStorage.setItem('activeJob', JSON.stringify({
                jobId: result.jobId,
                type: 'dubbing',
                fileName: file.name,
                status: 'transcribing'
            }));

            // 5. Start waiting
            setCurrentJobId(result.jobId);
            setIsProcessing(true);

        } catch (err: any) {
            console.error('[DubMediaSelectModal] Error:', err);

            // Detailed error logging for mobile debugging
            const errorDetails = {
                name: err.name || 'UnknownError',
                message: err.message || 'No error message',
                status: err.status || 'N/A',
                stack: err.stack || 'No stack trace'
            };

            window.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: 'Upload Failed',
                    message: err.message || 'We encountered an error while uploading your media. Please try again.',
                    type: 'error',
                    details: `Error: ${errorDetails.name}\nMessage: ${errorDetails.message}\nStatus: ${errorDetails.status}\nStack: ${errorDetails.stack}`
                }
            }));

            setError(err.message || 'Upload failed');
            setIsUploading(false);
        } finally {
            // We stay uploading/processing until transcribing_done
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:video" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
                        <h3 className="modal-title">
                            Hi! Use {character.name} to dub videos easily
                        </h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Processing State */}
                    {isProcessing ? (
                        <div className="processing-wait-state">
                            <div className="processing-icon-container">
                                <Icon icon="lucide:loader-2" width={48} className="spin primary-color" />
                            </div>
                            <h4>Analyzing your media...</h4>
                            <p>We're transcribing and identifying speakers. This usually takes a minute.</p>

                            {jobStatus?.progress !== undefined && (
                                <div className="processing-progress">
                                    <div className="progress-bar">
                                        <div className="progress-fill" style={{ width: `${jobStatus.progress}%` }} />
                                    </div>
                                    <span className="progress-text">{jobStatus.step || 'Processing...'} ({jobStatus.progress}%)</span>
                                </div>
                            )}

                            <button
                                className="btn btn-outline btn-full"
                                style={{ marginTop: 'var(--space-l)' }}
                                onClick={() => setIsOpen(false)}
                            >
                                Run in background
                            </button>
                        </div>
                    ) : !file ? (
                        <div
                            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Icon icon="lucide:upload-cloud" width={48} height={48} />
                            <h4>Upload video or audio</h4>
                            <p>Drag & drop or click to browse</p>
                            <div className="upload-limits">
                                <span>Max: {limits.maxDurationSeconds}s</span>
                                <span>•</span>
                                <span>{limits.maxFileSizeMB}MB</span>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="audio/*,video/*"
                                onChange={handleFileSelect}
                                style={{ display: 'none' }}
                            />
                        </div>
                    ) : (
                        <>
                            {/* File Info */}
                            <div className="file-info-card">
                                <Icon
                                    icon={mediaType === 'video' ? 'lucide:video' : 'lucide:music'}
                                    width={24}
                                />
                                <div className="file-details">
                                    <h4>{file.name}</h4>
                                    <p>
                                        {Math.round(duration)}s • {(file.size / (1024 * 1024)).toFixed(1)}MB
                                    </p>
                                </div>
                                <button
                                    className="btn-icon"
                                    onClick={() => setFile(null)}
                                    title="Remove"
                                    disabled={isUploading}
                                >
                                    <Icon icon="lucide:x" width={18} />
                                </button>
                            </div>

                            {/* Language Form */}
                            <div className="language-section">
                                <h4 className="section-title">
                                    This helps our AI do a better job for you
                                </h4>

                                <div className="form-group">
                                    <label className="form-label">
                                        What is the main language used in this {mediaType}?
                                    </label>
                                    <div className="ios-select-wrapper">
                                        <button
                                            className="ios-select-button"
                                            onClick={() => setIsLanguageMenuOpen(!isLanguageMenuOpen)}
                                            disabled={isUploading}
                                        >
                                            <div className="ios-select-content">
                                                <Icon icon="lucide:globe" width={18} />
                                                {SUPPORTED_LANGUAGES.find(l => l.code === mainLanguage)?.name || 'Select Language'}
                                            </div>
                                            <Icon icon="lucide:chevron-down" width={16} />
                                        </button>

                                        {isLanguageMenuOpen && !isUploading && (
                                            <div className="ios-select-menu">
                                                {SUPPORTED_LANGUAGES.map(lang => (
                                                    <button
                                                        key={lang.code}
                                                        className={`ios-select-item ${mainLanguage === lang.code ? 'selected' : ''}`}
                                                        onClick={() => {
                                                            setMainLanguage(lang.code);
                                                            setIsLanguageMenuOpen(false);
                                                        }}
                                                    >
                                                        <div className="ios-select-item-content">
                                                            {lang.name}
                                                        </div>
                                                        {mainLanguage === lang.code && <Icon icon="lucide:check" width={16} className="check-icon" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">
                                        Are there any other languages? (optional)
                                    </label>
                                    <div
                                        className="chip-input-container"
                                        onClick={() => otherLangInputRef.current?.focus()}
                                    >
                                        {otherLanguages.map(lang => (
                                            <div key={lang} className="input-chip">
                                                <span>{lang}</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveOtherLanguage(lang);
                                                    }}
                                                    disabled={isUploading}
                                                >
                                                    <Icon icon="lucide:x" width={14} />
                                                </button>
                                            </div>
                                        ))}
                                        <input
                                            ref={otherLangInputRef}
                                            type="text"
                                            value={otherLangInput}
                                            onChange={(e) => setOtherLangInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddOtherLanguage();
                                                }
                                                if (e.key === 'Backspace' && otherLangInput === '' && otherLanguages.length > 0) {
                                                    handleRemoveOtherLanguage(otherLanguages[otherLanguages.length - 1]);
                                                }
                                            }}
                                            placeholder={otherLanguages.length === 0 ? "Type language..." : ""}
                                            className="ghost-input"
                                            disabled={isUploading}
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="error-banner">
                                    <Icon icon="lucide:alert-circle" width={18} />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                className="btn btn-primary btn-full"
                                onClick={handleUseMedia}
                                disabled={isUploading}
                            >
                                {isUploading ? (
                                    <>
                                        <Icon icon="lucide:loader-2" width={18} className="spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>Use this {mediaType}</>
                                )}
                            </button>
                        </>
                    )}
                </div>

                <style>{`
          .processing-wait-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: var(--space-2xl) var(--space-m);
            min-height: 300px;
          }

          .processing-icon-container {
            width: 80px;
            height: 80px;
            background: var(--mauve-2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: var(--space-l);
          }

          .processing-wait-state h4 {
            font-size: var(--step-1);
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0 0 var(--space-xs) 0;
          }

          .processing-wait-state p {
            font-size: 15px;
            color: var(--mauve-11);
            max-width: 320px;
            margin-bottom: var(--space-xl);
          }

          .processing-progress {
            width: 100%;
            max-width: 320px;
          }

          .progress-bar {
            width: 100%;
            height: 8px;
            background: var(--mauve-3);
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: var(--space-xs);
          }

          .progress-fill {
            height: 100%;
            background: var(--orange-9);
            transition: width 0.3s ease;
          }

          .progress-text {
            font-size: 13px;
            color: var(--mauve-11);
            font-weight: 500;
          }

          .btn-outline {
            background: white;
            border: 1px solid var(--mauve-6);
            color: var(--mauve-11);
          }

          .primary-color {
            color: var(--orange-9);
          }

          .upload-zone {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-s);
            padding: var(--space-2xl);
            border: 2px dashed var(--mauve-7);
            border-radius: var(--radius-l);
            background: var(--mauve-2);
            cursor: pointer;
            transition: all 0.2s;
            min-height: 300px;
          }

          .upload-zone:hover {
            border-color: var(--orange-9);
            background: var(--orange-2);
          }

          .upload-zone.dragging {
            border-color: var(--orange-9);
            background: var(--orange-3);
            transform: scale(1.02);
          }

          .upload-zone h4 {
            font-size: var(--step-1);
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0;
          }

          .upload-zone p {
            color: var(--mauve-11);
            margin: 0;
          }

          .upload-limits {
            display: flex;
            gap: var(--space-xs);
            font-size: 13px;
            color: var(--mauve-10);
          }

          .file-info-card {
            display: flex;
            align-items: center;
            gap: var(--space-s);
            padding: var(--space-s);
            background: var(--mauve-3);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            margin-bottom: var(--space-m);
          }

          .file-details {
            flex: 1;
          }

          .file-details h4 {
            font-size: 14px;
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0 0 4px 0;
          }

          .file-details p {
            font-size: 13px;
            color: var(--mauve-11);
            margin: 0;
          }

          .btn-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--mauve-4);
            border: none;
            border-radius: var(--radius-m);
            color: var(--mauve-11);
            cursor: pointer;
          }

          .btn-icon:hover {
            background: var(--red-3);
            color: var(--red-9);
          }

          .language-section {
            margin-bottom: var(--space-m);
          }

          /* .section-title handled by modal.css */

          .form-group {
            margin-bottom: var(--space-m);
          }

          .form-label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            color: var(--mauve-12);
            margin-bottom: var(--space-2xs);
          }
          
          /* .form-select and .form-input removed - using modal.css classes */
          /* .tags-list, .tag removed - using chip-input-container */

          .error-banner {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            padding: var(--space-s);
            background: var(--red-3);
            border: 1px solid var(--red-7);
            border-radius: var(--radius-m);
            color: var(--red-11);
            margin-bottom: var(--space-m);
          }

          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-xs);
            padding: var(--space-s);
            border-radius: var(--radius-m);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
          }

          .btn-primary {
            background: var(--orange-9);
            color: white;
          }

          .btn-primary:hover:not(:disabled) {
            background: var(--orange-10);
          }

          .btn-full {
            width: 100%;
          }

          .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .spin {
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
            </div>
        </div>
    );
}