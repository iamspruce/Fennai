import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';


import { AVATAR_STYLES, generateAvatarUrl, type AvatarStyle } from '@/lib/utils/avatar';

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

    // Voice option state
    const [showVoicePreview, setShowVoicePreview] = useState(false);

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            resetForm();
        };

        window.addEventListener('open-create-character-modal', handleOpen);
        return () => window.removeEventListener('open-create-character-modal', handleOpen);
    }, []);

    // Listen for voice file updates
    useEffect(() => {
        const handleVoiceUpdate = (e: CustomEvent) => {
            const file = e.detail as File;

            if (file) {
                const validTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/webm'];
                const maxSize = 10 * 1024 * 1024;

                if (!validTypes.includes(file.type) && !file.type.startsWith('audio/')) {
                    setError('Please upload a valid audio file');
                    setSelectedFile(null);
                } else if (file.size > maxSize) {
                    setError('File size must be less than 10MB');
                    setSelectedFile(null);
                } else {
                    setSelectedFile(file);
                    setShowVoicePreview(true);
                    setError(null);
                }
            }
        };

        window.addEventListener('voice-file-updated', handleVoiceUpdate as EventListener);
        return () => window.removeEventListener('voice-file-updated', handleVoiceUpdate as EventListener);
    }, []);

    // Listen for edited voice
    useEffect(() => {
        const handleVoiceEdited = (e: CustomEvent) => {
            if (e.detail.source === 'modal-upload') {
                setSelectedFile(new File([e.detail.blob], 'voice_sample.wav', { type: 'audio/wav' }));
                setShowVoicePreview(true);
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
        setShowVoicePreview(false);
        setSaveAcrossBrowsers(false);
        setError(null);
    };

    const handleUploadClick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file) {
                window.dispatchEvent(new CustomEvent('voice-file-updated', { detail: file }));
            }
        };
        input.click();
    };

    const handleLibraryClick = () => {
        window.dispatchEvent(new Event('open-voice-library'));
    };

    const handleRecordClick = () => {
        window.dispatchEvent(new Event('open-record-modal'));
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
            const formData = new FormData();
            formData.append('name', characterName);
            formData.append('avatarStyle', selectedAvatar);
            formData.append('voiceFile', selectedFile!);
            if (isPro) {
                formData.append('saveAcrossBrowsers', saveAcrossBrowsers.toString());
            }

            const response = await fetch('/api/characters/create', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                // Dispatch event to refresh character list
                window.dispatchEvent(new Event('character-created'));
                handleClose();
            } else {
                setError(data.error || 'Failed to create character');
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
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
                                    <span style={{
                                        fontSize: '12px',
                                        color: 'var(--mauve-11)',
                                        fontWeight: 'normal'
                                    }}>
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
                                                    layoutId="avatar-ring"
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
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    objectFit: 'cover',
                                                    display: 'block'
                                                }}
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
                                    <span style={{
                                        fontSize: '12px',
                                        color: 'var(--mauve-11)',
                                        fontWeight: 'normal'
                                    }}>
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

                        {/* Step 3: Voice Selection */}
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
                                    <span style={{
                                        fontSize: '12px',
                                        color: 'var(--mauve-11)',
                                        fontWeight: 'normal'
                                    }}>
                                        (Step 3 of 3)
                                    </span>
                                </h4>

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 'var(--space-s)',
                                    marginBottom: 'var(--space-m)'
                                }}>
                                    <button
                                        type="button"
                                        onClick={handleUploadClick}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 'var(--space-xs)',
                                            padding: 'var(--space-m)',
                                            background: 'var(--mauve-2)',
                                            border: '2px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--orange-7)';
                                            e.currentTarget.style.background = 'var(--orange-2)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--mauve-6)';
                                            e.currentTarget.style.background = 'var(--mauve-2)';
                                        }}
                                    >
                                        <div style={{
                                            width: '48px',
                                            height: '48px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'var(--orange-3)',
                                            color: 'var(--orange-9)',
                                            borderRadius: 'var(--radius-m)'
                                        }}>
                                            <Icon icon="lucide:upload" width={24} height={24} />
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mauve-12)' }}>
                                                Upload
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--mauve-11)' }}>
                                                From computer
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleLibraryClick}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 'var(--space-xs)',
                                            padding: 'var(--space-m)',
                                            background: 'var(--mauve-2)',
                                            border: '2px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--orange-7)';
                                            e.currentTarget.style.background = 'var(--orange-2)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--mauve-6)';
                                            e.currentTarget.style.background = 'var(--mauve-2)';
                                        }}
                                    >
                                        <div style={{
                                            width: '48px',
                                            height: '48px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'var(--orange-3)',
                                            color: 'var(--orange-9)',
                                            borderRadius: 'var(--radius-m)'
                                        }}>
                                            <Icon icon="lucide:library" width={24} height={24} />
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mauve-12)' }}>
                                                Library
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--mauve-11)' }}>
                                                Pre-made voices
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleRecordClick}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 'var(--space-xs)',
                                            padding: 'var(--space-m)',
                                            background: 'var(--mauve-2)',
                                            border: '2px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--orange-7)';
                                            e.currentTarget.style.background = 'var(--orange-2)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'var(--mauve-6)';
                                            e.currentTarget.style.background = 'var(--mauve-2)';
                                        }}
                                    >
                                        <div style={{
                                            width: '48px',
                                            height: '48px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'var(--orange-3)',
                                            color: 'var(--orange-9)',
                                            borderRadius: 'var(--radius-m)'
                                        }}>
                                            <Icon icon="lucide:mic" width={24} height={24} />
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mauve-12)' }}>
                                                Record
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--mauve-11)' }}>
                                                Your voice
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {showVoicePreview && selectedFile && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-s)',
                                            padding: 'var(--space-m)',
                                            background: 'var(--green-2)',
                                            border: '1px solid var(--green-6)',
                                            borderRadius: 'var(--radius-m)',
                                            marginBottom: 'var(--space-m)'
                                        }}
                                    >
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'var(--green-9)',
                                            color: 'white',
                                            borderRadius: '50%',
                                            fontWeight: 'bold'
                                        }}>
                                            ✓
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--green-11)' }}>
                                                Voice sample selected
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--green-11)' }}>
                                                {selectedFile.name}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

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