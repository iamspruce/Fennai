// src/islands/DubEditScriptModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { db } from '@/lib/firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import type { DubbingJob, TranscriptSegment } from '@/types/dubbing';

export default function DubEditScriptModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editedTranscript, setEditedTranscript] = useState<TranscriptSegment[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setJob(e.detail.job);
            setEditMode(e.detail.editMode);
            setEditedTranscript(e.detail.job?.transcript || []);
            setIsOpen(true);
        };
        window.addEventListener('open-dub-edit-script', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-edit-script', handleOpen as EventListener);
    }, []);

    const handleTextChange = (index: number, newText: string) => {
        const updated = [...editedTranscript];
        updated[index].text = newText;
        setEditedTranscript(updated);
    };

    const handleSave = async () => {
        if (!jobId) return;

        setIsSaving(true);

        try {
            const jobRef = doc(db, 'dubbingJobs', jobId);
            await updateDoc(jobRef, {
                transcript: editedTranscript,
                scriptEdited: true,
                updatedAt: new Date()
            });

            setIsOpen(false);

            // Return to settings modal
            window.dispatchEvent(
                new CustomEvent('open-dub-settings', {
                    detail: { jobId }
                })
            );

        } catch (err) {
            console.error('Failed to save script:', err);
            alert('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !job) return null;

    const speakers = job.speakers || [];
    const speakerColors = [
        'var(--blue-9)',
        'var(--green-9)',
        'var(--pink-9)',
        'var(--orange-9)',
        'var(--purple-9)',
        'var(--cyan-9)',
    ];

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon={editMode ? 'lucide:edit' : 'lucide:file-text'} width={20} />
                        <h3 className="modal-title">
                            {editMode ? 'Edit Script' : 'View Script'}
                        </h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="script-editor">
                        {editedTranscript.map((segment, index) => {
                            const speakerIdx = speakers.findIndex(s => s.id === segment.speakerId);
                            const speakerColor = speakerColors[speakerIdx % speakerColors.length];

                            return (
                                <div key={index} className="script-segment">
                                    <div
                                        className="speaker-label"
                                        style={{
                                            backgroundColor: `${speakerColor}15`,
                                            color: speakerColor,
                                            borderColor: speakerColor
                                        }}
                                    >
                                        {segment.speakerId.replace('speaker_', 'Speaker ')}
                                    </div>

                                    {editMode ? (
                                        <textarea
                                            value={segment.text}
                                            onChange={(e) => handleTextChange(index, e.target.value)}
                                            className="segment-textarea"
                                            rows={2}
                                        />
                                    ) : (
                                        <p className="segment-text">{segment.text}</p>
                                    )}

                                    <div className="segment-meta">
                                        {segment.translatedText && (
                                            <span className="translation-badge">
                                                <Icon icon="lucide:languages" width={14} />
                                                Translated
                                            </span>
                                        )}
                                        <span className="time-badge">
                                            {segment.startTime.toFixed(1)}s - {segment.endTime.toFixed(1)}s
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {editMode && (
                        <div className="action-buttons">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setIsOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSave}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <>
                                        <Icon icon="lucide:loader-2" width={18} className="spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Icon icon="lucide:save" width={18} />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                <style>{`
          .script-editor {
            max-height: 500px;
            overflow-y: auto;
            margin-bottom: var(--space-m);
          }

          .script-segment {
            padding: var(--space-s);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            margin-bottom: var(--space-s);
            background: var(--mauve-2);
          }

          .speaker-label {
            display: inline-block;
            padding: 4px 12px;
            border-radius: var(--radius-full);
            font-size: 13px;
            font-weight: 600;
            margin-bottom: var(--space-xs);
            border: 1px solid;
          }

          .segment-textarea {
            width: 100%;
            padding: var(--space-xs);
            background: var(--mauve-1);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-12);
            font-size: 14px;
            line-height: 1.5;
            resize: vertical;
            font-family: inherit;
          }

          .segment-text {
            margin: var(--space-xs) 0;
            color: var(--mauve-12);
            line-height: 1.6;
          }

          .segment-meta {
            display: flex;
            gap: var(--space-xs);
            margin-top: var(--space-xs);
          }

          .translation-badge,
          .time-badge {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            background: var(--mauve-4);
            border-radius: var(--radius-s);
            font-size: 12px;
            color: var(--mauve-11);
          }

          .translation-badge {
            background: var(--blue-4);
            color: var(--blue-11);
          }

          .action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-s);
          }
        `}</style>
            </div>
        </div>
    );
}