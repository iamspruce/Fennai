// src/islands/DubSettingsModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
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
    }, [jobId, isOpen, voiceMapping, targetLanguage, translateAll]);

    // Open modal handler
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setIsOpen(true);
        };
        window.addEventListener('open-dub-settings', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-settings', handleOpen as EventListener);
    }, []);

    const initializeVoiceMapping = (jobData: DubbingJob) => {
        const mapping: Record<string, VoiceMapEntry> = {};
        jobData.speakers?.forEach(speaker => {
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
        // This could be a Firestore update or an API call
        // For now, assuming you update via Firestore directly:
        const jobRef = doc(db, 'dubbingJobs', jobId);
        await updateDoc(jobRef, settings);
    };


    if (!isOpen || !job) return null;

    const detectedLang = SUPPORTED_LANGUAGES.find(l => l.code === job.detectedLanguageCode);

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:settings" width={20} />
                        <h3 className="modal-title">Dubbing Settings</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Audio/Video Preview */}
                    <div className="preview-section">
                        <AudioPlayer
                            audioUrl={job.audioUrl}
                            className="w-full"
                            waveColor="#FFA07A"
                            progressColor="#FF4500"
                        />
                    </div>

                    {/* Translation Settings */}
                    <div className="settings-section">
                        <h4 className="section-title">
                            The language spoken in this {job.mediaType} is <strong>{detectedLang?.name}</strong>.
                            Do you want to translate the audio to another language?
                        </h4>

                        <div className="language-grid">
                            {SUPPORTED_LANGUAGES.slice(0, 12).map(lang => (
                                <button
                                    key={lang.code}
                                    className={`language-card ${targetLanguage === lang.code ? 'selected' : ''}`}
                                    onClick={() => setTargetLanguage(lang.code)}
                                >
                                    {lang.name}
                                </button>
                            ))}
                        </div>

                        {targetLanguage && (
                            <div className="translation-hint">
                                <Icon icon="lucide:info" width={18} />
                                <span>
                                    The entire audio will be translated to <strong>{SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name}</strong>.
                                    Are you sure about this?
                                </span>
                                <button
                                    className="btn-text"
                                    onClick={handleTranslateSelected}
                                >
                                    Translate only selected segments instead
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Voice Mapping */}
                    <div className="settings-section">
                        <h4 className="section-title">
                            Your {job.mediaType} has {job.speakers?.length} speaker(s).
                            Do you want to keep the original voice or use your character(s) custom voices?
                        </h4>

                        <div className="voice-mapping-list">
                            {job.speakers?.map((speaker, idx) => (
                                <div key={speaker.id} className="voice-mapping-item">
                                    <div className="speaker-info">
                                        <div className="speaker-badge">Speaker {idx + 1}</div>
                                        <div className="speaker-stats">
                                            {Math.round(speaker.totalDuration)}s • {speaker.segmentCount} segments
                                        </div>
                                    </div>

                                    <div className="voice-selector">
                                        <button
                                            className={`voice-option ${voiceMapping[speaker.id]?.type === 'original' ? 'selected' : ''}`}
                                            onClick={() => handleVoiceMappingChange(speaker.id, 'original')}
                                        >
                                            <Icon icon="lucide:user" width={18} />
                                            Original Voice
                                        </button>

                                        <div className="voice-option-or">or</div>

                                        <select
                                            className="character-select"
                                            value={voiceMapping[speaker.id]?.characterId || ''}
                                            onChange={(e) => handleVoiceMappingChange(speaker.id, 'character', e.target.value)}
                                        >
                                            <option value="">Select Character...</option>
                                            {allCharacters.map(char => (
                                                <option key={char.id} value={char.id}>
                                                    {char.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Script Editing */}
                    <div className="settings-section">
                        <h4 className="section-title">
                            Do you want to change anything the character(s) said?
                        </h4>
                        <button className="btn btn-secondary" onClick={handleEditScript}>
                            <Icon icon="lucide:edit" width={18} />
                            Edit Script
                        </button>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="error-message">
                            <Icon icon="lucide:alert-circle" width={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Continue Button */}
                    <button
                        className="btn btn-primary btn-full"
                        onClick={handleContinue}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <Icon icon="lucide:loader-2" width={18} className="spin" />
                                Starting...
                            </>
                        ) : (
                            <>Continue with these settings</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}