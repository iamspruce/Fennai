import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '@/types/character';
import { UPLOAD_LIMITS, SUPPORTED_LANGUAGES } from '@/types/dubbing';
import { saveDubbingMedia } from '@/lib/db/indexdb';

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
    const [error, setError] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const limits = UPLOAD_LIMITS[userTier];

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetForm();
        };
        window.addEventListener('open-dubbing-modal', handleOpen);
        return () => window.removeEventListener('open-dubbing-modal', handleOpen);
    }, []);

    const resetForm = () => {
        setFile(null);
        setDuration(0);
        setMainLanguage('en');
        setOtherLanguages([]);
        setOtherLangInput('');
        setError('');
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

            setDuration(fileDuration);
            setFile(selectedFile);

            // Auto-open preview/edit modal
            const reader = new FileReader();
            reader.onload = () => {
                window.dispatchEvent(
                    new CustomEvent('open-preview-modal', {
                        detail: {
                            audioBlob: selectedFile,
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
            // Convert file to base64
            const base64Data = await fileToBase64(file);

            // Call dubbing transcribe endpoint
            const response = await fetch('/api/proxy/dub/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaData: base64Data,
                    mediaType,
                    fileName: file.name,
                    duration,
                    fileSizeMB: file.size / (1024 * 1024),
                    detectedLanguage: SUPPORTED_LANGUAGES.find(l => l.code === mainLanguage)?.name,
                    detectedLanguageCode: mainLanguage,
                    otherLanguages,
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Upload failed');
            }

            const data = await response.json();
            const jobId = data.job_id;

            // Save media to IndexedDB for preview
            await saveDubbingMedia({
                id: jobId,
                mediaType,
                audioData: await file.arrayBuffer(),
                audioType: file.type,
                duration,
                fileSize: file.size,
                createdAt: Date.now(),
            });

            // Open settings modal (will listen to job status)
            window.dispatchEvent(
                new CustomEvent('open-dub-settings', {
                    detail: { jobId }
                })
            );

            setIsOpen(false);

        } catch (err: any) {
            setError(err.message || 'Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
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
                        <Icon icon="lucide:video" width={20} height={20} style={{ color: 'var(--purple-9)' }} />
                        <h3 className="modal-title">
                            Hi! Use {character.name} to dub videos easily
                        </h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Upload Section */}
                    {!file ? (
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
                                    <select
                                        value={mainLanguage}
                                        onChange={(e) => setMainLanguage(e.target.value)}
                                        className="form-select"
                                    >
                                        {SUPPORTED_LANGUAGES.map(lang => (
                                            <option key={lang.code} value={lang.code}>
                                                {lang.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">
                                        Are there any other languages? (optional)
                                    </label>
                                    <div className="tag-input-container">
                                        <input
                                            type="text"
                                            value={otherLangInput}
                                            onChange={(e) => setOtherLangInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleAddOtherLanguage();
                                                }
                                            }}
                                            placeholder="Type language and press Enter"
                                            className="form-input"
                                        />
                                    </div>

                                    {otherLanguages.length > 0 && (
                                        <div className="tags-list">
                                            {otherLanguages.map(lang => (
                                                <div key={lang} className="tag">
                                                    <span>{lang}</span>
                                                    <button onClick={() => handleRemoveOtherLanguage(lang)}>
                                                        <Icon icon="lucide:x" width={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
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
            border-color: var(--purple-9);
            background: var(--purple-2);
          }

          .upload-zone.dragging {
            border-color: var(--purple-9);
            background: var(--purple-3);
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

          .section-title {
            font-size: var(--step-0);
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0 0 var(--space-m) 0;
          }

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

          .form-select, .form-input {
            width: 100%;
            padding: var(--space-xs) var(--space-s);
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-12);
            font-size: 14px;
          }

          .form-select {
            cursor: pointer;
          }

          .tags-list {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2xs);
            margin-top: var(--space-xs);
          }

          .tag {
            display: flex;
            align-items: center;
            gap: var(--space-2xs);
            padding: 4px 8px;
            background: var(--purple-4);
            border: 1px solid var(--purple-7);
            border-radius: var(--radius-s);
            font-size: 13px;
            color: var(--purple-11);
          }

          .tag button {
            background: none;
            border: none;
            padding: 0;
            color: var(--purple-11);
            cursor: pointer;
            display: flex;
            align-items: center;
          }

          .tag button:hover {
            color: var(--red-9);
          }

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
            background: var(--purple-9);
            color: white;
          }

          .btn-primary:hover:not(:disabled) {
            background: var(--purple-10);
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