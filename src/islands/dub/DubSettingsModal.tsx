// src/islands/DubSettingsModal.tsx
import { useState, useEffect, useMemo } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Character } from '@/types/character';
import type { DubbingJob, VoiceMapEntry } from '@/types/dubbing';
import { SUPPORTED_LANGUAGES } from '@/types/dubbing';
import { cloneDubbing } from '@/lib/api/apiClient';
import AudioPlayer from '@/components/ui/AudioPlayer';

interface DubSettingsModalProps {
    allCharacters: Character[];
}

// Steps for the wizard flow
type Step = 'language' | 'voices' | 'review';

export default function DubSettingsModal({ allCharacters }: DubSettingsModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);

    // Wizard State
    const [currentStep, setCurrentStep] = useState<Step>('language');

    // Form State
    const [targetLanguage, setTargetLanguage] = useState('');
    const [translateAll, setTranslateAll] = useState(false);
    const [voiceMapping, setVoiceMapping] = useState<Record<string, VoiceMapEntry>>({});

    // UI State
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(null);
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

    // Derived State: Speakers
    // We attempt to get speakers from the job. If empty, we derive them from transcript segments.
    // This handles cases where clustering hasn't populated top-level speakers but transcript exists.
    const derivedSpeakers = useMemo(() => {
        if (!job) return [];

        // Priority 1: Use pre-calculated speakers if they exist
        if (job.speakers && job.speakers.length > 0) {
            return job.speakers;
        }

        // Priority 2: Derive from transcript if available
        if (job.transcript && job.transcript.length > 0) {
            const speakerMap = new Map<string, { id: string, totalDuration: number, voiceSampleUrl: string }>();

            job.transcript.forEach(segment => {
                const sid = segment.speakerId;
                const duration = segment.endTime - segment.startTime;

                if (speakerMap.has(sid)) {
                    const existing = speakerMap.get(sid)!;
                    existing.totalDuration += duration;
                } else {
                    speakerMap.set(sid, {
                        id: sid,
                        totalDuration: duration,
                        voiceSampleUrl: '', // No sample available if derived from transcript
                    });
                }
            });

            // Convert to array and sort
            return Array.from(speakerMap.values()).sort((a, b) => {
                // Try to sort by speaker number (speaker_1, speaker_2)
                const numA = parseInt(a.id.replace(/[^0-9]/g, '') || '0');
                const numB = parseInt(b.id.replace(/[^0-9]/g, '') || '0');
                if (numA === numB) return a.id.localeCompare(b.id);
                return numA - numB;
            });
        }

        return [];
    }, [job]);

    // Derived State: Languages
    const detectedLang = SUPPORTED_LANGUAGES.find(l => l.code === job?.detectedLanguageCode);
    const targetLangObj = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);
    const totalDuration = derivedSpeakers.reduce((acc, curr) => acc + curr.totalDuration, 0) || 0;

    // Listen to job status
    useEffect(() => {
        if (!jobId) return;

        const unsubscribe = onSnapshot(
            doc(db, 'dubbingJobs', jobId),
            (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data() as DubbingJob;
                    setJob(data);

                    // Restore settings
                    if (data.targetLanguage && !targetLanguage) setTargetLanguage(data.targetLanguage);
                    if (data.translateAll !== undefined && translateAll === false) setTranslateAll(data.translateAll);

                    // Auto-redirect
                    if (['cloning', 'translating', 'merging'].includes(data.status)) {
                        setIsOpen(false);
                        window.dispatchEvent(new CustomEvent('open-dub-review', { detail: { jobId } }));
                    }
                }
            }
        );
        return () => unsubscribe();
    }, [jobId, isOpen, targetLanguage, translateAll, defaultCharacterId]);

    // Effect: Initialize voice mapping when speakers are available (native or derived)
    useEffect(() => {
        if (!job) return;

        // If we have mapping from DB, use it
        if (job.voiceMapping && Object.keys(job.voiceMapping).length > 0) {
            // Only update if local is empty? Or always sync? 
            // Better to sync initially. Here we check if local is empty.
            if (Object.keys(voiceMapping).length === 0) {
                setVoiceMapping(job.voiceMapping);
            }
            return;
        }

        // Otherwise, initialize if we have speakers and it's not set
        if (derivedSpeakers.length > 0 && Object.keys(voiceMapping).length === 0) {
            const mapping: Record<string, VoiceMapEntry> = {};
            derivedSpeakers.forEach((speaker, idx) => {
                // If we have a default character, assign to first speaker
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
                mapping[speaker.id] = { type: 'original' };
            });
            setVoiceMapping(mapping);
        }
    }, [derivedSpeakers, job?.voiceMapping, defaultCharacterId, voiceMapping]); // Dependencies include derivedSpeakers

    // Open modal handler
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            if (e.detail.defaultCharacterId) setDefaultCharacterId(e.detail.defaultCharacterId);
            setJobId(e.detail.jobId);
            setIsOpen(true);
            setCurrentStep('language'); // Reset to first step
        };
        window.addEventListener('open-dub-settings', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-settings', handleOpen as EventListener);
    }, []);

    const handleVoiceMappingChange = (speakerId: string, type: 'character' | 'original', characterId?: string) => {
        const character = allCharacters.find(c => c.id === characterId);
        setVoiceMapping(prev => ({
            ...prev,
            [speakerId]: {
                type,
                characterId,
                characterName: character?.name,
                characterAvatar: character?.avatarUrl
            }
        }));
        setOpenDropdownId(null);
    };

    const handleEditScript = () => {
        window.dispatchEvent(new CustomEvent('open-dub-edit-script', { detail: { jobId, job, editMode: true } }));
    };

    const handleTranslateSelected = () => {
        window.dispatchEvent(new CustomEvent('open-dub-segment-selector', { detail: { jobId, job } }));
    };

    const handleFinalSubmit = async () => {
        if (!job) return;
        setIsProcessing(true);
        try {
            // Fallback to detected language if no target is selected (optional selection)
            const finalTargetLanguage = targetLanguage || job.detectedLanguageCode;

            await updateJobSettings(jobId, { targetLanguage: finalTargetLanguage, translateAll, voiceMapping });
            await cloneDubbing({ jobId });

            // Update local storage status so ResumeJobModal knows we're beyond transcribing
            const activeJobStr = localStorage.getItem('activeJob');
            if (activeJobStr) {
                const activeJob = JSON.parse(activeJobStr);
                if (activeJob.jobId === jobId) {
                    localStorage.setItem('activeJob', JSON.stringify({
                        ...activeJob,
                        status: 'cloning'
                    }));
                }
            }

            // Immediately trigger the review modal to avoid waiting for onSnapshot
            // This ensures a snappy transition as soon as the API call succeeds
            setIsOpen(false);
            window.dispatchEvent(new CustomEvent('open-dub-review', { detail: { jobId } }));
        } catch (err: any) {
            console.error('Failed to start cloning:', err);
            const msg = err.message || 'Failed to start voice cloning';
            setError(msg);
            setIsProcessing(false);

            window.dispatchEvent(new CustomEvent('show-alert', {
                detail: {
                    title: 'Cloning Failed',
                    message: msg,
                    type: 'error',
                    details: `Error: ${err.name || 'Unknown'}\nMessage: ${err.message || 'No message'}\nStack: ${err.stack || 'No stack'}`
                }
            }));
        }
    };

    const updateJobSettings = async (jobId: string, settings: any) => {
        const response = await fetch(`/api/dubbing/${jobId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        if (!response.ok) throw new Error('Failed to update job settings');
    };

    if (!isOpen || !job) return null;

    // Wizard Navigation Helpers
    const goNext = () => {
        if (currentStep === 'language') setCurrentStep('voices');
        else if (currentStep === 'voices') setCurrentStep('review');
    };
    const goBack = () => {
        if (currentStep === 'voices') setCurrentStep('language');
        else if (currentStep === 'review') setCurrentStep('voices');
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar"><div className="modal-handle-pill"></div></div>

                {/* Header with Progress Steps */}
                <div className="modal-header-wizard">
                    <div className="wizard-step-indicator">
                        <div className={`step-dot ${['language', 'voices', 'review'].includes(currentStep) ? 'active' : ''}`} />
                        <div className={`step-line ${['voices', 'review'].includes(currentStep) ? 'active' : ''}`} />
                        <div className={`step-dot ${['voices', 'review'].includes(currentStep) ? 'active' : ''}`} />
                        <div className={`step-line ${['review'].includes(currentStep) ? 'active' : ''}`} />
                        <div className={`step-dot ${currentStep === 'review' ? 'active' : ''}`} />
                    </div>
                    <button className="modal-close-simple" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* --- STEP 1: LANGUAGE --- */}
                    {currentStep === 'language' && (
                        <div className="wizard-step fade-in">
                            <div className="step-hero">
                                <Icon icon="lucide:languages" width={32} className="hero-icon" />
                                <h3>Target Language</h3>
                                <p>Original language detected was <strong>{detectedLang?.name || 'Unknown'}</strong>. Do you want to translate it to another language?</p>
                            </div>

                            <div className="preview-mini-wrapper">
                                <AudioPlayer audioUrl={job.audioUrl} className="w-full" waveColor="#FFA07A" progressColor="#FF4500" />
                            </div>

                            <div className="language-grid-modern">
                                {SUPPORTED_LANGUAGES.slice(0, 12).map(lang => {
                                    const isDisabled = lang.code === detectedLang?.code;
                                    const isSelected = targetLanguage === lang.code;
                                    return (
                                        <button
                                            key={lang.code}
                                            className={`lang-chip ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            onClick={() => {
                                                if (isDisabled) return;
                                                // Toggle logic: if clicked again, deselect
                                                setTargetLanguage(prev => prev === lang.code ? '' : lang.code);
                                            }}
                                            disabled={isDisabled}
                                            style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                                        >
                                            <span className="lang-flag">{lang.flag || '🏳️'}</span>
                                            {lang.name}
                                        </button>
                                    );
                                })}
                            </div>

                            {targetLanguage && (
                                <div className="info-box clickable" onClick={handleTranslateSelected}>
                                    <div className="info-icon"><Icon icon="lucide:split" /></div>
                                    <div className="info-content">
                                        <div className="info-title">Are you sure you want to translate the full audio to {targetLangObj?.name}?</div>
                                        <div className="info-sub">Tap to translate segments</div>
                                    </div>
                                    <Icon icon="lucide:chevron-right" className="chevron" />
                                </div>
                            )}
                        </div>
                    )}

                    {/* --- STEP 2: VOICES --- */}
                    {currentStep === 'voices' && (
                        <div className="wizard-step fade-in">
                            <div className="step-hero">
                                <Icon icon="lucide:mic-2" width={32} className="hero-icon" />
                                <h3>Voice Assignment</h3>
                                <p>Found <strong>{derivedSpeakers.length} speakers</strong>. Assign AI voices or keep original.</p>
                            </div>

                            <div className="voice-mapping-list">
                                {derivedSpeakers.length === 0 && (
                                    <div className="empty-state">
                                        <p>No speakers detected in the audio.</p>
                                    </div>
                                )}
                                {derivedSpeakers.map((speaker, idx) => (
                                    <div key={speaker.id} className="voice-card">
                                        <div className="voice-card-header">
                                            <div className="speaker-meta">
                                                <div className="speaker-avatar-placeholder">S{idx + 1}</div>
                                                <div className="speaker-details">
                                                    <span className="speaker-name">Speaker {idx + 1}</span>
                                                    <span className="speaker-time">{Math.round(speaker.totalDuration)}s duration</span>
                                                </div>
                                            </div>

                                            {/* Segmented Control for Mode */}
                                            <div className="mode-toggle">
                                                <button
                                                    className={`mode-btn ${voiceMapping[speaker.id]?.type === 'original' ? 'active' : ''}`}
                                                    onClick={() => handleVoiceMappingChange(speaker.id, 'original')}
                                                >
                                                    Original
                                                </button>
                                                <button
                                                    className={`mode-btn ${voiceMapping[speaker.id]?.type === 'character' ? 'active' : ''}`}
                                                    onClick={() => {
                                                        // Auto-select first char if none selected
                                                        if (!voiceMapping[speaker.id]?.characterId && allCharacters.length > 0) {
                                                            handleVoiceMappingChange(speaker.id, 'character', allCharacters[0].id);
                                                        } else {
                                                            handleVoiceMappingChange(speaker.id, 'character', voiceMapping[speaker.id]?.characterId);
                                                        }
                                                    }}
                                                >
                                                    Custom
                                                </button>
                                            </div>
                                        </div>

                                        {/* Dropdown only appears if Custom is selected */}
                                        {voiceMapping[speaker.id]?.type === 'character' && (
                                            <div className="voice-card-body">
                                                <div className="ios-select-wrapper">
                                                    <button
                                                        className="ios-select-button dense"
                                                        onClick={() => setOpenDropdownId(openDropdownId === speaker.id ? null : speaker.id)}
                                                    >
                                                        <div className="ios-select-content">
                                                            {voiceMapping[speaker.id]?.characterId ? (
                                                                <>
                                                                    <div className="mini-avatar"
                                                                        style={{ backgroundImage: `url(${voiceMapping[speaker.id]?.characterAvatar || ''})` }} />
                                                                    {voiceMapping[speaker.id]?.characterName}
                                                                </>
                                                            ) : <span>Select Character...</span>}
                                                        </div>
                                                        <Icon icon="lucide:chevron-down" width={16} />
                                                    </button>

                                                    {openDropdownId === speaker.id && (
                                                        <div className="ios-select-menu">
                                                            {allCharacters.map(char => (
                                                                <button
                                                                    key={char.id}
                                                                    className={`ios-select-item ${voiceMapping[speaker.id]?.characterId === char.id ? 'selected' : ''}`}
                                                                    onClick={() => handleVoiceMappingChange(speaker.id, 'character', char.id)}
                                                                >
                                                                    <div className="ios-select-item-content">
                                                                        <div className="mini-avatar" style={{ backgroundImage: `url(${char.avatarUrl})` }} />
                                                                        {char.name}
                                                                    </div>
                                                                    {voiceMapping[speaker.id]?.characterId === char.id && <Icon icon="lucide:check" className="check-icon" />}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* --- STEP 3: REVIEW --- */}
                    {currentStep === 'review' && (
                        <div className="wizard-step fade-in">
                            <div className="step-hero">
                                <Icon icon="lucide:check-circle-2" width={32} className="hero-icon" />
                                <h3>Ready to Clone?</h3>
                                <p>Are you ready to dub this video to <strong>{targetLangObj?.name || detectedLang?.name || 'Original Language'}</strong>?</p>
                            </div>

                            <div className="review-summary">
                                <div className="summary-item">
                                    <label>Language</label>
                                    <div className="value">
                                        {targetLangObj ? (
                                            <>
                                                {targetLangObj.flag} {targetLangObj.name}
                                            </>
                                        ) : (
                                            <>
                                                {detectedLang?.flag} {detectedLang?.name || 'Original'}
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="summary-item">
                                    <label>Duration</label>
                                    <div className="value">{Math.round(totalDuration)} seconds</div>
                                </div>
                                <div className="summary-item">
                                    <label>Voices</label>
                                    <div className="value">
                                        {Object.values(voiceMapping).filter(v => v.type === 'character').length} Custom,
                                        {' '}{Object.values(voiceMapping).filter(v => v.type === 'original').length} Original
                                    </div>
                                </div>
                            </div>

                            <div className="action-card" onClick={handleEditScript}>
                                <div className="action-icon bg-blue"><Icon icon="lucide:file-edit" /></div>
                                <div className="action-text">
                                    <h4>Do you want to change what any of the speaker said?</h4>
                                    <p>Tap to edit script</p>
                                </div>
                                <Icon icon="lucide:chevron-right" className="chevron" />
                            </div>

                            {error && (
                                <div className="error-message">
                                    <Icon icon="lucide:alert-circle" width={18} />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="modal-footer-wizard">
                    {currentStep !== 'language' && (
                        <button className="btn-ghost" onClick={goBack}>
                            Back
                        </button>
                    )}

                    {currentStep !== 'review' ? (
                        <button
                            className="btn-primary-wizard"
                            onClick={goNext}
                            disabled={false}
                        >
                            Next Step
                        </button>
                    ) : (
                        <button
                            className="btn-primary-wizard finish"
                            onClick={handleFinalSubmit}
                            disabled={isProcessing}
                        >
                            {isProcessing ? <Icon icon="lucide:loader-2" className="spin" /> : 'Start Dubbing'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}