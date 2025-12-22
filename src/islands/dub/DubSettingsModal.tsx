// src/islands/DubSettingsModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Character } from '@/types/character';
import type { DubbingJob, VoiceMapEntry } from '@/types/dubbing';
import { SUPPORTED_LANGUAGES } from '@/types/dubbing';
import { cloneDubbing, transcribeDubbing } from '@/lib/api/apiClient';
import AudioPlayer from '@/components/ui/AudioPlayer';

interface DubSettingsModalProps {
    allCharacters: Character[];
}

export default function DubSettingsModal({ allCharacters }: DubSettingsModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [targetLanguage, setTargetLanguage] = useState('');
    const [translateAll, setTranslateAll] = useState(false);
    const [voiceMapping, setVoiceMapping] = useState<Record<string, VoiceMapEntry>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(null);
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    const [showAllLanguages, setShowAllLanguages] = useState(false);

    // Listen to job status
    useEffect(() => {
        if (!jobId) return;

        const unsubscribe = onSnapshot(
            doc(db, 'dubbingJobs', jobId),
            (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as DubbingJob;
                    setJob(data);

                    // Auto-initialize voice mapping if not already set
                    if (data.status === 'transcribing_done') {
                        if (data.voiceMapping && Object.keys(data.voiceMapping).length > 0 && Object.keys(voiceMapping).length === 0) {
                            setVoiceMapping(data.voiceMapping);
                        } else if (Object.keys(voiceMapping).length === 0) {
                            initializeVoiceMapping(data);
                        }
                    }

                    // Restore language settings if available
                    if (data.targetLanguage && !targetLanguage) {
                        setTargetLanguage(data.targetLanguage);
                    }
                    if (data.translateAll !== undefined && translateAll === false) {
                        setTranslateAll(data.translateAll);
                    }

                    // Auto-redirect to review modal when cloning starts
                    if (data.status === 'cloning' || data.status === 'translating' || data.status === 'merging') {
                        setIsOpen(false);
                        window.dispatchEvent(
                            new CustomEvent('open-dub-review', {
                                detail: { jobId }
                            })
                        );
                    }
                }
            }
        );

        return () => unsubscribe();
    }, [jobId, isOpen, voiceMapping, targetLanguage, translateAll, defaultCharacterId]);

    // Open modal handler
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            if (e.detail.defaultCharacterId) {
                setDefaultCharacterId(e.detail.defaultCharacterId);
            }
            setJobId(e.detail.jobId);
            setIsOpen(true);
        };
        window.addEventListener('open-dub-settings', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-settings', handleOpen as EventListener);
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (openDropdownId && !(e.target as Element).closest('.ios-select-wrapper')) {
                setOpenDropdownId(null);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [openDropdownId]);

    const initializeVoiceMapping = (jobData: DubbingJob) => {
        const mapping: Record<string, VoiceMapEntry> = {};
        jobData.speakers?.forEach((speaker, idx) => {
            // Map first speaker to default character if available
            if (idx === 0 && defaultCharacterId) {
                const char = allCharacters.find(c => c.id === defaultCharacterId);
                if (char) {
                    mapping[speaker.id] = {
                        type: 'character',
                        characterId: char.id,
                        characterName: char.name,
                        characterAvatar: char.avatarUrl
                    };
                    return;
                }
            }

            mapping[speaker.id] = {
                type: 'original'
            };
        });
        setVoiceMapping(mapping);
    };

    const handleVoiceMappingChange = (speakerId: string, type: 'character' | 'original', characterId?: string) => {
        const character = allCharacters.find(c => c.id === characterId);
        setVoiceMapping({
            ...voiceMapping,
            [speakerId]: {
                type,
                characterId,
                characterName: character?.name,
                characterAvatar: character?.avatarUrl
            }
        });
    };

    const handleLanguageSelect = (langCode: string) => {
        // Toggle off if clicking same language
        setTargetLanguage(targetLanguage === langCode ? '' : langCode);
    };

    const handleTranslateSelected = () => {
        window.dispatchEvent(
            new CustomEvent('open-dub-segment-selector', {
                detail: { jobId, job }
            })
        );
    };

    const handleEditScript = () => {
        window.dispatchEvent(
            new CustomEvent('open-dub-edit-script', {
                detail: { jobId, job, editMode: true }
            })
        );
    };

    const handleContinue = async () => {
        if (!job) return;

        setIsProcessing(true);

        try {
            // Update job settings in Firestore (you might have a separate function for this)
            await updateJobSettings(jobId, {
                targetLanguage,
                translateAll,
                voiceMapping
            });

            // Start cloning via API
            const result = await cloneDubbing({ jobId });

            // Modal will close automatically when Firestore status changes to 'cloning'

        } catch (err: any) {
            console.error('Failed to start cloning:', err);
            setError(err.message || 'Failed to start voice cloning');
        } finally {
            setIsProcessing(false);
        }
    };

    // Helper function to update job settings
    const updateJobSettings = async (
        jobId: string,
        settings: { targetLanguage: string; translateAll: boolean; voiceMapping: any }
    ) => {
        const response = await fetch(`/api/dubbing/${jobId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update job settings');
        }
    };

    // Get count of characters assigned
    const assignedCharacterCount = Object.values(voiceMapping).filter(v => v.type === 'character').length;

    if (!isOpen || !job) return null;

    const detectedLang = SUPPORTED_LANGUAGES.find(l => l.code === job.detectedLanguageCode);
    const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);
    const displayedLanguages = showAllLanguages ? SUPPORTED_LANGUAGES : SUPPORTED_LANGUAGES.slice(0, 12);
    const needsTranslation = targetLanguage && targetLanguage !== job.detectedLanguageCode;

    return (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setIsOpen(false)}>
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:wand-2" width={20} />
                        <h3 className="modal-title">Dub Magic Settings ✨</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Hero Audio/Video Preview */}
                    <div className="preview-section" style={{
                        background: 'var(--mauve-12)',
                        borderRadius: 'var(--radius-m)',
                        padding: 'var(--space-s)',
                        marginBottom: 'var(--space-m)'
                    }}>
                        <AudioPlayer
                            audioUrl={job.audioUrl}
                            className="w-full"
                            waveColor="#FFA07A"
                            progressColor="#FF4500"
                        />
                    </div>

                    {/* Translation Settings */}
                    <div className="settings-section">
                        <div className="step-hero" style={{ marginBottom: 'var(--space-m)' }}>
                            <div className="hero-icon">
                                <Icon icon="lucide:languages" width={32} />
                            </div>
                            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: 'var(--mauve-12)' }}>
                                {detectedLang?.flag} We heard <strong style={{ color: 'var(--orange-9)' }}>{detectedLang?.name || 'some language magic'}</strong>!
                            </h3>
                            <p style={{ color: 'var(--mauve-11)', fontSize: '14px', margin: 0 }}>
                                Wanna remix it in another language? Pick one below, or skip this step to keep it original. 🎤
                            </p>
                        </div>

                        <div className="language-grid-modern">
                            {displayedLanguages.map(lang => (
                                <button
                                    key={lang.code}
                                    className={`lang-chip ${targetLanguage === lang.code ? 'selected' : ''}`}
                                    onClick={() => handleLanguageSelect(lang.code)}
                                    disabled={lang.code === job.detectedLanguageCode}
                                    style={lang.code === job.detectedLanguageCode ? {
                                        opacity: 0.5,
                                        cursor: 'not-allowed',
                                        background: 'var(--mauve-3)'
                                    } : {}}
                                >
                                    <span className="lang-flag">{lang.flag}</span>
                                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{lang.name}</span>
                                    {lang.code === job.detectedLanguageCode && (
                                        <span style={{
                                            fontSize: '10px',
                                            color: 'var(--mauve-10)',
                                            marginTop: '-4px'
                                        }}>
                                            (Original)
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {SUPPORTED_LANGUAGES.length > 12 && (
                            <button
                                className="link-btn"
                                onClick={() => setShowAllLanguages(!showAllLanguages)}
                                style={{ marginTop: 'var(--space-s)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center', width: '100%' }}
                            >
                                <Icon icon={showAllLanguages ? "lucide:chevron-up" : "lucide:chevron-down"} width={14} />
                                {showAllLanguages ? 'Show fewer languages' : `Show ${SUPPORTED_LANGUAGES.length - 12} more languages`}
                            </button>
                        )}

                        {needsTranslation && (
                            <div className="info-box clickable" style={{ marginTop: 'var(--space-m)' }} onClick={handleTranslateSelected}>
                                <div className="info-icon">
                                    <Icon icon="lucide:sparkles" width={18} />
                                </div>
                                <div className="info-content">
                                    <div className="info-title">
                                        Translating to {selectedLang?.flag} {selectedLang?.name}!
                                    </div>
                                    <div className="info-sub">
                                        Want to translate only specific parts? Tap here to pick segments.
                                    </div>
                                </div>
                                <Icon icon="lucide:chevron-right" width={18} style={{ color: 'var(--blue-11)' }} />
                            </div>
                        )}
                    </div>

                    {/* Voice Mapping - Redesigned */}
                    <div className="settings-section">
                        <div className="step-hero" style={{ marginBottom: 'var(--space-m)' }}>
                            <div className="hero-icon">
                                <Icon icon="lucide:mic-2" width={32} />
                            </div>
                            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: 'var(--mauve-12)' }}>
                                {job.speakers?.length === 1 ? '1 voice detected!' : `${job.speakers?.length || 0} voices in the mix!`}
                            </h3>
                            <p style={{ color: 'var(--mauve-11)', fontSize: '14px', margin: 0 }}>
                                Keep the original vibes or swap in your character's voice. It's your call! 🎭
                            </p>
                        </div>

                        {/* Quick Stats */}
                        {job.speakers && job.speakers.length > 1 && (
                            <div style={{
                                display: 'flex',
                                gap: 'var(--space-xs)',
                                marginBottom: 'var(--space-m)',
                                flexWrap: 'wrap'
                            }}>
                                <div className="input-chip">
                                    <Icon icon="lucide:users" width={12} />
                                    {job.speakers?.length} speakers
                                </div>
                                <div className="input-chip">
                                    <Icon icon="lucide:sparkles" width={12} />
                                    {assignedCharacterCount} customized
                                </div>
                                <div className="input-chip">
                                    <Icon icon="lucide:user" width={12} />
                                    {(job.speakers?.length || 0) - assignedCharacterCount} original
                                </div>
                            </div>
                        )}

                        <div className="voice-mapping-list">
                            {job.speakers?.map((speaker, idx) => {
                                const mapping = voiceMapping[speaker.id];
                                const isCharacter = mapping?.type === 'character';
                                const selectedChar = allCharacters.find(c => c.id === mapping?.characterId);

                                return (
                                    <div
                                        key={speaker.id}
                                        className="voice-card"
                                        style={{
                                            background: 'var(--mauve-2)',
                                            border: isCharacter ? '2px solid var(--orange-9)' : '1px solid var(--mauve-6)',
                                            borderRadius: 'var(--radius-m)',
                                            overflow: 'hidden',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {/* Voice Card Header */}
                                        <div className="voice-card-header">
                                            <div className="speaker-meta">
                                                <div
                                                    className="speaker-avatar-placeholder"
                                                    style={isCharacter && selectedChar?.avatarUrl ? {
                                                        backgroundImage: `url(${selectedChar.avatarUrl})`,
                                                        backgroundSize: 'cover',
                                                        backgroundPosition: 'center'
                                                    } : {}}
                                                >
                                                    {!isCharacter && (idx + 1)}
                                                </div>
                                                <div className="speaker-details">
                                                    <div className="speaker-name">
                                                        {isCharacter ? selectedChar?.name : `Speaker ${idx + 1}`}
                                                    </div>
                                                    <div className="speaker-time">
                                                        {Math.round(speaker.totalDuration)}s speaking time • {speaker.segmentCount} segments
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Voice Mode Toggle */}
                                            <div className="mode-toggle">
                                                <button
                                                    className={`mode-btn ${!isCharacter ? 'active' : ''}`}
                                                    onClick={() => handleVoiceMappingChange(speaker.id, 'original')}
                                                >
                                                    Original
                                                </button>
                                                <button
                                                    className={`mode-btn ${isCharacter ? 'active' : ''}`}
                                                    onClick={() => {
                                                        if (!isCharacter) {
                                                            setOpenDropdownId(speaker.id);
                                                        }
                                                    }}
                                                >
                                                    Clone
                                                </button>
                                            </div>
                                        </div>

                                        {/* Character Selector - Only shown when Clone is selected or dropdown is open */}
                                        {(isCharacter || openDropdownId === speaker.id) && (
                                            <div className="voice-card-body">
                                                <div className="ios-select-wrapper">
                                                    <button
                                                        className="ios-select-button dense"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenDropdownId(openDropdownId === speaker.id ? null : speaker.id);
                                                        }}
                                                    >
                                                        <div className="ios-select-content">
                                                            {selectedChar ? (
                                                                <>
                                                                    <div
                                                                        className="mini-avatar"
                                                                        style={{
                                                                            backgroundImage: selectedChar.avatarUrl ? `url(${selectedChar.avatarUrl})` : 'none',
                                                                        }}
                                                                    />
                                                                    <span>{selectedChar.name}</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Icon icon="lucide:user-plus" width={16} style={{ color: 'var(--mauve-11)' }} />
                                                                    <span style={{ color: 'var(--mauve-11)' }}>Pick a character...</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        <Icon
                                                            icon={openDropdownId === speaker.id ? "lucide:chevron-up" : "lucide:chevron-down"}
                                                            width={16}
                                                            style={{ color: 'var(--mauve-11)' }}
                                                        />
                                                    </button>

                                                    {openDropdownId === speaker.id && (
                                                        <div className="ios-select-menu">
                                                            {allCharacters.length === 0 ? (
                                                                <div style={{
                                                                    padding: '16px',
                                                                    textAlign: 'center',
                                                                    color: 'var(--mauve-11)',
                                                                    fontSize: '14px'
                                                                }}>
                                                                    <Icon icon="lucide:ghost" width={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                                                                    <p style={{ margin: 0 }}>No characters yet!</p>
                                                                    <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Create some to use their voices here.</p>
                                                                </div>
                                                            ) : (
                                                                allCharacters.map(char => (
                                                                    <button
                                                                        key={char.id}
                                                                        className={`ios-select-item ${mapping?.characterId === char.id ? 'selected' : ''}`}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleVoiceMappingChange(speaker.id, 'character', char.id);
                                                                            setOpenDropdownId(null);
                                                                        }}
                                                                    >
                                                                        <div className="ios-select-item-content">
                                                                            <div
                                                                                style={{
                                                                                    width: 32,
                                                                                    height: 32,
                                                                                    borderRadius: '8px',
                                                                                    background: 'var(--mauve-5)',
                                                                                    backgroundImage: char.avatarUrl ? `url(${char.avatarUrl})` : 'none',
                                                                                    backgroundSize: 'cover',
                                                                                    backgroundPosition: 'center'
                                                                                }}
                                                                            />
                                                                            <div>
                                                                                <div style={{ fontWeight: 500 }}>{char.name}</div>
                                                                                {char.voiceCount && char.voiceCount > 0 && (
                                                                                    <div style={{ fontSize: '12px', color: 'var(--mauve-11)' }}>
                                                                                        {char.voiceCount} voice{char.voiceCount > 1 ? 's' : ''} saved
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        {mapping?.characterId === char.id && (
                                                                            <Icon icon="lucide:check" width={18} className="check-icon" />
                                                                        )}
                                                                    </button>
                                                                ))
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Empty state if no speakers */}
                        {(!job.speakers || job.speakers.length === 0) && (
                            <div style={{
                                textAlign: 'center',
                                padding: 'var(--space-xl)',
                                color: 'var(--mauve-11)',
                                background: 'var(--mauve-2)',
                                borderRadius: 'var(--radius-m)',
                                border: '1px dashed var(--mauve-6)'
                            }}>
                                <Icon icon="lucide:user-search" width={32} style={{ marginBottom: 'var(--space-s)', opacity: 0.5 }} />
                                <p style={{ margin: 0 }}>No speakers detected yet.</p>
                                <p style={{ margin: '4px 0 0', fontSize: '13px' }}>This usually happens during processing - hang tight!</p>
                            </div>
                        )}
                    </div>

                    {/* Script Editing Card */}
                    <div className="settings-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                        <div
                            className="action-card"
                            onClick={handleEditScript}
                            style={{ marginBottom: 'var(--space-m)' }}
                        >
                            <div className="action-icon bg-blue">
                                <Icon icon="lucide:pen-line" width={20} />
                            </div>
                            <div className="action-text" style={{ flex: 1 }}>
                                <h4>Wanna tweak the script? ✏️</h4>
                                <p>Change what anyone says before we work our magic.</p>
                            </div>
                            <Icon icon="lucide:chevron-right" width={18} style={{ color: 'var(--mauve-11)' }} />
                        </div>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="error-message">
                            <Icon icon="lucide:alert-circle" width={18} />
                            <span>{error}</span>
                            <button
                                onClick={() => setError(null)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    marginLeft: 'auto',
                                    padding: '4px'
                                }}
                            >
                                <Icon icon="lucide:x" width={14} style={{ color: 'var(--red-11)' }} />
                            </button>
                        </div>
                    )}

                    {/* Summary Review */}
                    <div className="review-summary" style={{ marginBottom: 'var(--space-m)' }}>
                        <div className="summary-item">
                            <label>Media Type</label>
                            <span className="value">
                                {job.mediaType === 'video' ? '🎬 Video' : '🎵 Audio'}
                            </span>
                        </div>
                        <div className="summary-item">
                            <label>Duration</label>
                            <span className="value">{Math.round(job.duration)}s</span>
                        </div>
                        <div className="summary-item">
                            <label>Translation</label>
                            <span className="value" style={{ color: needsTranslation ? 'var(--orange-9)' : 'var(--mauve-11)' }}>
                                {needsTranslation ? `${detectedLang?.flag} → ${selectedLang?.flag}` : 'No translation'}
                            </span>
                        </div>
                        <div className="summary-item">
                            <label>Voice Cloning</label>
                            <span className="value">
                                {assignedCharacterCount > 0
                                    ? `${assignedCharacterCount} character${assignedCharacterCount > 1 ? 's' : ''}`
                                    : 'Original voices only'
                                }
                            </span>
                        </div>
                    </div>

                    {/* Continue Button */}
                    <button
                        className="btn btn-primary btn-full"
                        onClick={handleContinue}
                        disabled={isProcessing}
                        style={{
                            padding: '14px 24px',
                            fontSize: '16px',
                            fontWeight: 600,
                            borderRadius: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px'
                        }}
                    >
                        {isProcessing ? (
                            <>
                                <Icon icon="lucide:loader-2" width={20} className="spin" />
                                Warming up the magic...
                            </>
                        ) : (
                            <>
                                <Icon icon="lucide:sparkles" width={20} />
                                Let's make some magic! ✨
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}