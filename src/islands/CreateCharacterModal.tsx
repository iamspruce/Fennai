import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';

// Import the shared component
import VoiceOptions from '@components/create/VoiceOptions';
import { AVATAR_STYLES, generateAvatarUrl, type AvatarStyle } from '@lib/utils/avatar';

interface CreateCharacterModalProps {
    isPro?: boolean;
}

export default function CreateCharacterModal({ isPro = false }: CreateCharacterModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [currentStep, setCurrentStep] = useState<'avatar' | 'name' | 'voice'>('avatar');

    // Form state
    const [selectedAvatar, setSelectedAvatar] = useState<AvatarStyle>(AVATAR_STYLES[0]);
    const [characterName, setCharacterName] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [saveAcrossBrowsers, setSaveAcrossBrowsers] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetForm();
        };

        window.addEventListener('open-create-character-modal', handleOpen);
        return () => window.removeEventListener('open-create-character-modal', handleOpen);
    }, []);

    // Listen for voice file updates (Fixes "Invalid Audio" bug)
    useEffect(() => {
        const handleVoiceUpdate = (e: CustomEvent) => {
            // Handle both structure: {file, source} and legacy File object
            const detail = e.detail;
            const file = detail?.file || detail;

            console.log('Voice file updated:', { file, type: file?.type, size: file?.size });

            if (!file) {
                // If null is dispatched (reset), clear file
                setSelectedFile(null);
                setError(null);
                return;
            }

            // More permissive audio type checking
            const validTypes = [
                'audio/mpeg',      // MP3
                'audio/wav',       // WAV
                'audio/wave',      // WAV alternative
                'audio/x-wav',     // WAV alternative
                'audio/ogg',       // OGG
                'audio/webm',      // WebM
                'audio/mp4',       // M4A
                'audio/x-m4a',     // M4A alternative
                'audio/aac',       // AAC
                'audio/flac',      // FLAC
            ];

            const maxSize = 10 * 1024 * 1024; // 10MB

            // Check if it's a File object
            if (!(file instanceof File)) {
                setError('Invalid file object');
                setSelectedFile(null);
                return;
            }

            // Check file size first
            if (file.size === 0) {
                setError('Audio file is empty');
                setSelectedFile(null);
                return;
            }

            if (file.size > maxSize) {
                setError('File size must be less than 10MB');
                setSelectedFile(null);
                return;
            }

            // Check type - be more permissive
            const isValidType = validTypes.includes(file.type) ||
                file.type.startsWith('audio/');

            if (!isValidType) {
                console.error('Invalid audio type:', file.type);
                setError(`Invalid audio format: ${file.type || 'unknown'}. Please upload MP3, WAV, OGG, or WebM files.`);
                setSelectedFile(null);
                return;
            }

            // File is valid
            setSelectedFile(file);
            setError(null);
            console.log('Voice file accepted:', file.name);
        };

        window.addEventListener('voice-file-updated', handleVoiceUpdate as EventListener);
        return () => window.removeEventListener('voice-file-updated', handleVoiceUpdate as EventListener);
    }, []);

    // Listen for edited voice
    useEffect(() => {
        const handleVoiceEdited = (e: CustomEvent) => {
            if (e.detail.source === 'modal-upload') {
                const newFile = new File([e.detail.blob], 'voice_sample.wav', { type: 'audio/wav' });
                setSelectedFile(newFile);

                // Dispatch back to update VoiceOptions UI
                window.dispatchEvent(new CustomEvent('voice-file-updated', {
                    detail: { file: newFile, source: 'upload' }
                }));
            }
        };

        window.addEventListener('voice-edited', handleVoiceEdited as EventListener);
        return () => window.removeEventListener('voice-edited', handleVoiceEdited as EventListener);
    }, []);

    const resetForm = () => {
        setCurrentStep('avatar');
        setSelectedAvatar(AVATAR_STYLES[0]);
        setCharacterName('');
        setSelectedFile(null);
        setSaveAcrossBrowsers(false);
        setError(null);

        // Reset the VoiceOptions UI visually
        window.dispatchEvent(new CustomEvent('voice-file-updated', { detail: null }));
    };

    const canProceedToName = () => (selectedAvatar as string) !== '';
    const canProceedToVoice = () => characterName.trim().length >= 2;
    const canSubmit = () => selectedFile !== null;

    const handleNext = () => {
        if (currentStep === 'avatar' && canProceedToName()) {
            setCurrentStep('name');
        } else if (currentStep === 'name' && canProceedToVoice()) {
            setCurrentStep('voice');
        }
    };

    const handleBack = () => {
        if (currentStep === 'voice') {
            setCurrentStep('name');
        } else if (currentStep === 'name') {
            setCurrentStep('avatar');
        }
    };

    const handleSubmit = async () => {
        if (!canSubmit()) {
            setError('Please provide a voice sample');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            console.log('Submitting character creation...', {
                name: characterName,
                avatarStyle: selectedAvatar,
                file: {
                    name: selectedFile?.name,
                    size: selectedFile?.size,
                    type: selectedFile?.type
                }
            });

            const formData = new FormData();
            formData.append('name', characterName);
            formData.append('avatarStyle', selectedAvatar);

            // Critical for Safari: append blob with filename explicitly
            if (selectedFile) {
                formData.append('voiceFile', selectedFile, selectedFile.name || 'voice_sample.wav');
            }

            if (isPro) {
                formData.append('saveAcrossBrowsers', saveAcrossBrowsers.toString());
            }

            const response = await fetch('/api/characters/create', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json().catch(() => ({ error: 'Invalid response from server' }));

            if (response.ok) {
                console.log('Character created successfully');
                window.dispatchEvent(new Event('character-created'));
                window.location.reload();
            } else {
                const errorMsg = data.error || `Server error: ${response.status} ${response.statusText}`;
                console.error('Submission failed:', errorMsg);
                setError(errorMsg);
            }
        } catch (err: any) {
            console.error('Submit error caught:', err);
            setError(`Network or Unexpected Error: ${err.message || 'Please check your connection'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setIsOpen(false);
        resetForm();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <motion.div
                className="modal-content modal-wide"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Mobile Handle */}
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:sparkles" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
                        <h3 className="modal-title">Create New Character</h3>
                    </div>
                    <button className="modal-close" onClick={handleClose}>
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Progress Indicator */}
                    <div style={{
                        display: 'flex',
                        gap: 'var(--space-2xs)',
                        marginBottom: 'var(--space-l)',
                        padding: '4px',
                        background: 'var(--mauve-3)',
                        borderRadius: 'var(--radius-m)'
                    }}>
                        {['avatar', 'name', 'voice'].map((step, idx) => (
                            <div
                                key={step}
                                style={{
                                    flex: 1,
                                    height: '4px',
                                    borderRadius: '2px',
                                    background: currentStep === step || (
                                        (step === 'avatar') ||
                                        (step === 'name' && (currentStep === 'name' || currentStep === 'voice')) ||
                                        (step === 'voice' && currentStep === 'voice')
                                    ) ? 'var(--orange-9)' : 'var(--mauve-6)',
                                    transition: 'all 0.3s'
                                }}
                            />
                        ))}
                    </div>

                    <AnimatePresence mode="wait">
                        {/* Step 1: Avatar Selection */}
                        {currentStep === 'avatar' && (
                            <motion.div
                                key="avatar-step"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <h4 style={{
                                    fontSize: 'var(--step-0)',
                                    fontWeight: 600,
                                    color: 'var(--mauve-12)',
                                    marginBottom: 'var(--space-s)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2xs)'
                                }}>
                                    Pick an avatar style
                                    <span style={{ fontSize: '12px', color: 'var(--mauve-11)', fontWeight: 'normal' }}>
                                        (Step 1 of 3)
                                    </span>
                                </h4>

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
                                    gap: 'var(--space-s)',
                                    marginBottom: 'var(--space-l)'
                                }}>
                                    {AVATAR_STYLES.map((style) => (
                                        <motion.div
                                            key={style}
                                            onClick={() => setSelectedAvatar(style)}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            style={{
                                                position: 'relative',
                                                cursor: 'pointer',
                                                borderRadius: 'var(--radius-m)',
                                                overflow: 'hidden',
                                                border: selectedAvatar === style
                                                    ? '3px solid var(--orange-9)'
                                                    : '2px solid var(--mauve-6)',
                                                background: 'var(--mauve-2)',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {selectedAvatar === style && (
                                                <motion.div
                                                    layoutId="avatar-ring-modal"
                                                    style={{
                                                        position: 'absolute',
                                                        inset: 0,
                                                        border: '3px solid var(--orange-9)',
                                                        borderRadius: 'var(--radius-m)',
                                                        pointerEvents: 'none',
                                                        zIndex: 1
                                                    }}
                                                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                                />
                                            )}
                                            <img
                                                src={generateAvatarUrl(`character-${style}`, style)}
                                                alt={style}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                            />
                                        </motion.div>
                                    ))}
                                </div>

                                <button
                                    onClick={handleNext}
                                    disabled={!canProceedToName()}
                                    style={{
                                        width: '100%',
                                        padding: '14px',
                                        background: canProceedToName() ? 'var(--orange-9)' : 'var(--mauve-6)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-m)',
                                        fontSize: '15px',
                                        fontWeight: 600,
                                        cursor: canProceedToName() ? 'pointer' : 'not-allowed',
                                        opacity: canProceedToName() ? 1 : 0.6
                                    }}
                                >
                                    Continue
                                </button>
                            </motion.div>
                        )}

                        {/* Step 2: Name Input */}
                        {currentStep === 'name' && (
                            <motion.div
                                key="name-step"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <h4 style={{
                                    fontSize: 'var(--step-0)',
                                    fontWeight: 600,
                                    color: 'var(--mauve-12)',
                                    marginBottom: 'var(--space-s)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2xs)'
                                }}>
                                    Name your character
                                    <span style={{ fontSize: '12px', color: 'var(--mauve-11)', fontWeight: 'normal' }}>
                                        (Step 2 of 3)
                                    </span>
                                </h4>

                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-m)',
                                    padding: 'var(--space-l)',
                                    background: 'var(--mauve-2)',
                                    borderRadius: 'var(--radius-m)',
                                    marginBottom: 'var(--space-l)'
                                }}>
                                    <img
                                        src={generateAvatarUrl(`character-${selectedAvatar}`, selectedAvatar)}
                                        alt="Preview"
                                        style={{
                                            width: '64px',
                                            height: '64px',
                                            borderRadius: 'var(--radius-m)',
                                            border: '2px solid var(--mauve-6)'
                                        }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <input
                                            type="text"
                                            value={characterName}
                                            onChange={(e) => setCharacterName(e.target.value)}
                                            placeholder="e.g., Sarah, John, Robot..."
                                            autoFocus
                                            style={{
                                                width: '100%',
                                                padding: '12px 14px',
                                                background: 'var(--mauve-1)',
                                                border: '2px solid var(--mauve-6)',
                                                borderRadius: 'var(--radius-m)',
                                                fontSize: '16px',
                                                color: 'var(--mauve-12)',
                                                outline: 'none',
                                                transition: 'all 0.2s'
                                            }}
                                            onFocus={(e) => {
                                                e.target.style.borderColor = 'var(--orange-9)';
                                                e.target.style.boxShadow = '0 0 0 2px var(--orange-4)';
                                            }}
                                            onBlur={(e) => {
                                                e.target.style.borderColor = 'var(--mauve-6)';
                                                e.target.style.boxShadow = 'none';
                                            }}
                                        />
                                        <p style={{
                                            fontSize: '12px',
                                            color: 'var(--mauve-11)',
                                            marginTop: 'var(--space-2xs)'
                                        }}>
                                            {characterName.length}/50 characters
                                        </p>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-s)' }}>
                                    <button
                                        onClick={handleBack}
                                        style={{
                                            padding: '14px',
                                            background: 'var(--mauve-3)',
                                            color: 'var(--mauve-12)',
                                            border: '1px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            fontSize: '15px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNext}
                                        disabled={!canProceedToVoice()}
                                        style={{
                                            padding: '14px',
                                            background: canProceedToVoice() ? 'var(--orange-9)' : 'var(--mauve-6)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: 'var(--radius-m)',
                                            fontSize: '15px',
                                            fontWeight: 600,
                                            cursor: canProceedToVoice() ? 'pointer' : 'not-allowed',
                                            opacity: canProceedToVoice() ? 1 : 0.6
                                        }}
                                    >
                                        Continue
                                    </button>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 3: Voice Selection (Updated with VoiceOptions) */}
                        {currentStep === 'voice' && (
                            <motion.div
                                key="voice-step"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                            >
                                <h4 style={{
                                    fontSize: 'var(--step-0)',
                                    fontWeight: 600,
                                    color: 'var(--mauve-12)',
                                    marginBottom: 'var(--space-s)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2xs)'
                                }}>
                                    Give your character a voice
                                    <span style={{ fontSize: '12px', color: 'var(--mauve-11)', fontWeight: 'normal' }}>
                                        (Step 3 of 3)
                                    </span>
                                </h4>

                                {/* REPLACED: Use VoiceOptions Component */}
                                <div style={{ marginBottom: 'var(--space-m)' }}>
                                    <VoiceOptions hasError={!!error && !selectedFile} />
                                </div>

                                {isPro && (
                                    <label style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-s)',
                                        cursor: 'pointer',
                                        marginBottom: 'var(--space-m)',
                                        padding: 'var(--space-s)',
                                        background: 'var(--mauve-2)',
                                        borderRadius: 'var(--radius-m)'
                                    }}>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="checkbox"
                                                checked={saveAcrossBrowsers}
                                                onChange={(e) => setSaveAcrossBrowsers(e.target.checked)}
                                                style={{ display: 'none' }}
                                            />
                                            <div style={{
                                                width: '44px',
                                                height: '24px',
                                                background: saveAcrossBrowsers ? 'var(--orange-9)' : 'var(--mauve-7)',
                                                borderRadius: '12px',
                                                position: 'relative',
                                                transition: 'all 0.3s'
                                            }}>
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '2px',
                                                    left: saveAcrossBrowsers ? '22px' : '2px',
                                                    width: '20px',
                                                    height: '20px',
                                                    background: 'white',
                                                    borderRadius: '50%',
                                                    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                                                }} />
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '14px', color: 'var(--mauve-12)' }}>
                                            Save voice across browsers (Pro)
                                        </span>
                                    </label>
                                )}

                                {error && (
                                    <div style={{
                                        padding: 'var(--space-s)',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        border: '1px solid #ef4444',
                                        borderRadius: 'var(--radius-m)',
                                        color: '#dc2626',
                                        marginBottom: 'var(--space-m)',
                                        fontSize: '14px'
                                    }}>
                                        {error}
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-s)' }}>
                                    <button
                                        onClick={handleBack}
                                        disabled={isSubmitting}
                                        style={{
                                            padding: '14px',
                                            background: 'var(--mauve-3)',
                                            color: 'var(--mauve-12)',
                                            border: '1px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            fontSize: '15px',
                                            fontWeight: 600,
                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                            opacity: isSubmitting ? 0.6 : 1
                                        }}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!canSubmit() || isSubmitting}
                                        style={{
                                            padding: '14px',
                                            background: (canSubmit() && !isSubmitting) ? 'var(--orange-9)' : 'var(--mauve-6)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: 'var(--radius-m)',
                                            fontSize: '15px',
                                            fontWeight: 600,
                                            cursor: (canSubmit() && !isSubmitting) ? 'pointer' : 'not-allowed',
                                            opacity: (canSubmit() && !isSubmitting) ? 1 : 0.6,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 'var(--space-2xs)'
                                        }}
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                                                >
                                                    <Icon icon="lucide:loader-2" width={18} height={18} />
                                                </motion.div>
                                                Creating...
                                            </>
                                        ) : (
                                            <>
                                                <Icon icon="lucide:sparkles" width={18} height={18} />
                                                Create Character
                                            </>
                                        )}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}