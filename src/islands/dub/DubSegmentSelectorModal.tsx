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
    const [filters, setFilters] = useState<SegmentFilter[]>([{ type: 'speaker', speakerId: '' }]);
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

    // ... (Filter logic matches original) ...
    useEffect(() => {
        if (!job?.transcript) return;
        let filtered: TranscriptSegment[] = [];
        filters.forEach(filter => {
            if (filter.type === 'speaker' && filter.speakerId) {
                filtered = [...filtered, ...job.transcript!.filter(s => s.speakerId === filter.speakerId)];
            } else if (filter.type === 'timerange' && filter.startTime !== undefined && filter.endTime !== undefined) {
                filtered = [...filtered, ...job.transcript!.filter(s => s.startTime >= filter.startTime! && s.endTime <= filter.endTime!)];
            }
        });
        const unique = Array.from(new Map(filtered.map(s => [s.startTime, s])).values()).sort((a, b) => a.startTime - b.startTime);
        const scriptText = unique.map(s => `${s.speakerId}: ${s.text}`).join('\n');
        setFilteredScript(scriptText);
    }, [filters, job]);

    const handleAddFilter = () => setFilters([...filters, { type: 'speaker', speakerId: '' }]);
    const handleRemoveFilter = (index: number) => setFilters(filters.filter((_, i) => i !== index));
    const handleFilterChange = (index: number, filter: SegmentFilter) => {
        const updated = [...filters];
        updated[index] = filter;
        setFilters(updated);
    };

    const handleTranslate = async () => {
        if (!job?.transcript) return;
        setIsTranslating(true);
        try {
            const segmentIndices: number[] = [];
            job.transcript.forEach((segment, index) => {
                filters.forEach(filter => {
                    if ((filter.type === 'speaker' && filter.speakerId === segment.speakerId) ||
                        (filter.type === 'timerange' && segment.startTime >= (filter.startTime || 0) && segment.endTime <= (filter.endTime || Infinity))) {
                        segmentIndices.push(index);
                    }
                });
            });
            await translateDubbing({ jobId, targetLanguage: job.targetLanguage || 'en', segmentIndices: [...new Set(segmentIndices)] });
            setIsOpen(false);
            window.dispatchEvent(new CustomEvent('open-dub-settings', { detail: { jobId } }));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsTranslating(false);
        }
    };

    if (!isOpen || !job) return null;
    const speakers = job.speakers || [];

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:filter" width={20} />
                        <h3 className="modal-title">Partial Translation</h3>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}><Icon icon="lucide:x" width={20} /></button>
                </div>

                <div className="modal-body">
                    {/* Intro */}
                    <div className="selector-intro">
                        <p>Define criteria to select specific parts of the script to translate.</p>
                        <button className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('open-dub-edit-script', { detail: { jobId, job, editMode: false } }))}>
                            View Full Script
                        </button>
                    </div>

                    {/* Filter Builder */}
                    <div className="filter-builder">
                        {filters.map((filter, index) => (
                            <div key={index} className="natural-filter-row">
                                <span className="filter-text">Include segments</span>
                                <select
                                    className="filter-select-inline"
                                    value={filter.type}
                                    onChange={(e) => handleFilterChange(index, { ...filter, type: e.target.value as any })}
                                >
                                    <option value="speaker">spoken by</option>
                                    <option value="timerange">between</option>
                                </select>

                                {filter.type === 'speaker' ? (
                                    <select
                                        className="filter-select-highlight"
                                        value={filter.speakerId || ''}
                                        onChange={(e) => handleFilterChange(index, { ...filter, speakerId: e.target.value })}
                                    >
                                        <option value="">Select Speaker...</option>
                                        {speakers.map((s, i) => <option key={s.id} value={s.id}>Speaker {i + 1}</option>)}
                                    </select>
                                ) : (
                                    <div className="time-range-group">
                                        <input type="number" className="time-input-inline" placeholder="0s"
                                            value={filter.startTime} onChange={(e) => handleFilterChange(index, { ...filter, startTime: parseFloat(e.target.value) })} />
                                        <span>and</span>
                                        <input type="number" className="time-input-inline" placeholder="End"
                                            value={filter.endTime} onChange={(e) => handleFilterChange(index, { ...filter, endTime: parseFloat(e.target.value) })} />
                                    </div>
                                )}

                                {filters.length > 1 && (
                                    <button className="remove-filter-btn" onClick={() => handleRemoveFilter(index)}>
                                        <Icon icon="lucide:trash-2" width={16} />
                                    </button>
                                )}
                            </div>
                        ))}

                        <button className="add-filter-btn" onClick={handleAddFilter}>
                            <Icon icon="lucide:plus-circle" width={16} /> <span>Add another criteria</span>
                        </button>
                    </div>

                    {/* Preview Card */}
                    <div className="preview-card">
                        <div className="preview-header">
                            <span className="preview-label">Selected Content Preview</span>
                            <span className="preview-count">{filteredScript.split('\n').filter(Boolean).length} segments</span>
                        </div>
                        <div className="preview-content-area">
                            <RichTextEditor
                                initialValue={filteredScript || "No segments match your filters."}
                                onChange={() => { }}
                                readOnly
                                placeholder="Preview..."
                            />
                        </div>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <div className="modal-footer-sticky">
                        <button className="btn-ghost" onClick={() => setIsOpen(false)}>Cancel</button>
                        <button className="btn-primary" onClick={handleTranslate} disabled={isTranslating || !filteredScript}>
                            {isTranslating ? 'Translating...' : 'Translate Selection'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}