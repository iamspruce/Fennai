// src/islands/DubSegmentSelectorModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { DubbingJob, TranscriptSegment, SegmentFilter } from '@/types/dubbing';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { translateDubbing } from '@/lib/api/apiClient';

export default function DubSegmentSelectorModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [jobId, setJobId] = useState('');
    const [job, setJob] = useState<DubbingJob | null>(null);
    const [filters, setFilters] = useState<SegmentFilter[]>([
        { type: 'speaker', speakerId: '' }
    ]);
    const [filteredScript, setFilteredScript] = useState('');
    const [isTranslating, setIsTranslating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setJobId(e.detail.jobId);
            setJob(e.detail.job);
            setIsOpen(true);
        };
        window.addEventListener('open-dub-segment-selector', handleOpen as EventListener);
        return () => window.removeEventListener('open-dub-segment-selector', handleOpen as EventListener);
    }, []);

    // Update filtered script when filters change
    useEffect(() => {
        if (!job?.transcript) return;

        let filtered: TranscriptSegment[] = [];

        filters.forEach(filter => {
            if (filter.type === 'speaker' && filter.speakerId) {
                const segments = job.transcript!.filter(s => s.speakerId === filter.speakerId);
                filtered = [...filtered, ...segments];
            } else if (filter.type === 'timerange' && filter.startTime !== undefined && filter.endTime !== undefined) {
                const segments = job.transcript!.filter(
                    s => s.startTime >= filter.startTime! && s.endTime <= filter.endTime!
                );
                filtered = [...filtered, ...segments];
            }
        });

        // Remove duplicates and sort by time
        const unique = Array.from(new Map(filtered.map(s => [s.startTime, s])).values())
            .sort((a, b) => a.startTime - b.startTime);

        const scriptText = unique.map(s => `${s.speakerId}: ${s.text}`).join('\n');
        setFilteredScript(scriptText);
    }, [filters, job]);

    const handleAddFilter = () => {
        setFilters([...filters, { type: 'speaker', speakerId: '' }]);
    };

    const handleRemoveFilter = (index: number) => {
        setFilters(filters.filter((_, i) => i !== index));
    };

    const handleFilterChange = (index: number, filter: SegmentFilter) => {
        const updated = [...filters];
        updated[index] = filter;
        setFilters(updated);
    };

    const handleViewFullScript = () => {
        window.dispatchEvent(
            new CustomEvent('open-dub-edit-script', {
                detail: { jobId, job, editMode: false }
            })
        );
    };

    const handleTranslate = async () => {
        if (!job?.transcript) return;

        setIsTranslating(true);
        setError(null);

        try {
            // Get segment indices that match filters
            const segmentIndices: number[] = [];

            job.transcript.forEach((segment, index) => {
                filters.forEach(filter => {
                    if (filter.type === 'speaker' && filter.speakerId === segment.speakerId) {
                        segmentIndices.push(index);
                    } else if (
                        filter.type === 'timerange' &&
                        segment.startTime >= (filter.startTime || 0) &&
                        segment.endTime <= (filter.endTime || Infinity)
                    ) {
                        segmentIndices.push(index);
                    }
                });
            });

            // Call translation API
            await translateDubbing({
                jobId,
                targetLanguage: job.targetLanguage || 'en',
                segmentIndices: [...new Set(segmentIndices)]
            });

            // Close modal and return to settings
            setIsOpen(false);
            window.dispatchEvent(
                new CustomEvent('open-dub-settings', {
                    detail: { jobId }
                })
            );

        } catch (err: any) {
            console.error('Translation failed:', err);
            setError(err.message || 'Translation failed');
        } finally {
            setIsTranslating(false);
        }
    };

    if (!isOpen || !job) return null;

    const speakers = job.speakers || [];

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:filter" width={20} />
                        <h3 className="modal-title">Select Segments to Translate</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {/* Filters */}
                    <div className="filters-section">
                        <div className="filters-header">
                            <h4>Filters</h4>
                            <button className="btn-text" onClick={handleViewFullScript}>
                                <Icon icon="lucide:file-text" width={16} />
                                View Full Script
                            </button>
                        </div>

                        {filters.map((filter, index) => (
                            <div key={index} className="filter-row">
                                <select
                                    value={filter.type}
                                    onChange={(e) => handleFilterChange(index, {
                                        ...filter,
                                        type: e.target.value as 'speaker' | 'timerange'
                                    })}
                                    className="filter-type-select"
                                >
                                    <option value="speaker">Select everything speaker said</option>
                                    <option value="timerange">Select from start time to end time</option>
                                </select>

                                {filter.type === 'speaker' ? (
                                    <select
                                        value={filter.speakerId || ''}
                                        onChange={(e) => handleFilterChange(index, {
                                            ...filter,
                                            speakerId: e.target.value
                                        })}
                                        className="filter-value-select"
                                    >
                                        <option value="">Choose speaker...</option>
                                        {speakers.map((speaker, idx) => (
                                            <option key={speaker.id} value={speaker.id}>
                                                Speaker {idx + 1}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="timerange-inputs">
                                        <input
                                            type="number"
                                            placeholder="Start (seconds)"
                                            value={filter.startTime || ''}
                                            onChange={(e) => handleFilterChange(index, {
                                                ...filter,
                                                startTime: parseFloat(e.target.value)
                                            })}
                                            className="time-input"
                                        />
                                        <span>to</span>
                                        <input
                                            type="number"
                                            placeholder="End (seconds)"
                                            value={filter.endTime || ''}
                                            onChange={(e) => handleFilterChange(index, {
                                                ...filter,
                                                endTime: parseFloat(e.target.value)
                                            })}
                                            className="time-input"
                                        />
                                    </div>
                                )}

                                {filters.length > 1 && (
                                    <button
                                        className="btn-icon-danger"
                                        onClick={() => handleRemoveFilter(index)}
                                    >
                                        <Icon icon="lucide:x" width={16} />
                                    </button>
                                )}
                            </div>
                        ))}

                        <button className="btn btn-secondary" onClick={handleAddFilter}>
                            <Icon icon="lucide:plus" width={18} />
                            Add Filter
                        </button>
                    </div>

                    {/* Filtered Script Preview */}
                    <div className="script-preview-section">
                        <h4>Selected Segments</h4>
                        <RichTextEditor
                            initialValue={filteredScript}
                            onChange={() => { }}
                            readOnly
                            placeholder="No segments selected"
                        />
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="error-message">
                            <Icon icon="lucide:alert-circle" width={16} />
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="action-buttons">
                        <button
                            className="btn btn-secondary"
                            onClick={() => setIsOpen(false)}
                        >
                            Discard
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleTranslate}
                            disabled={isTranslating || !filteredScript}
                        >
                            {isTranslating ? (
                                <>
                                    <Icon icon="lucide:loader-2" width={18} className="spin" />
                                    Translating...
                                </>
                            ) : (
                                <>Translate Only These</>
                            )}
                        </button>
                    </div>
                </div>

                <style>{`
          .filters-section {
            margin-bottom: var(--space-m);
          }

          .filters-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: var(--space-s);
          }

          .filters-header h4 {
            font-size: var(--step-0);
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0;
          }

          .filter-row {
            display: flex;
            gap: var(--space-xs);
            margin-bottom: var(--space-xs);
            align-items: center;
          }

          .filter-type-select,
          .filter-value-select {
            padding: var(--space-xs);
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-12);
            font-size: 14px;
          }

          .filter-type-select {
            flex: 2;
          }

          .filter-value-select {
            flex: 1;
          }

          .timerange-inputs {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            flex: 1;
          }

          .time-input {
            width: 100px;
            padding: var(--space-xs);
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-12);
            font-size: 14px;
          }

          .btn-icon-danger {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--red-3);
            border: 1px solid var(--red-7);
            border-radius: var(--radius-m);
            color: var(--red-9);
            cursor: pointer;
          }

          .script-preview-section {
            margin-bottom: var(--space-m);
          }

          .script-preview-section h4 {
            font-size: var(--step-0);
            font-weight: 600;
            color: var(--mauve-12);
            margin-bottom: var(--space-s);
          }

          .error-message {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            padding: var(--space-s);
            background: var(--red-3);
            border: 1px solid var(--red-6);
            border-radius: var(--radius-m);
            color: var(--red-11);
            font-size: 14px;
            margin-bottom: var(--space-m);
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