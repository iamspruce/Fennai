// src/islands/VoiceLibraryModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import AudioPlayer from '@/components/ui/AudioPlayer';
import type { LibraryVoice, VoiceFilter } from '@/types/voiceLibrary';
import { FILTER_CATEGORIES, LANGUAGE_FLAGS } from '@/types/voiceLibrary';
import "@/styles/modal.css";

interface VoiceLibraryModalProps {
    isPro: boolean;
}

export default function VoiceLibraryModal({ isPro }: VoiceLibraryModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [voices, setVoices] = useState<LibraryVoice[]>([]);
    const [filteredVoices, setFilteredVoices] = useState<LibraryVoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeFilters, setActiveFilters] = useState<VoiceFilter>({});

    // Focus management for the custom input
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleOpen = () => {
            setIsOpen(true);
            loadVoices();
        };

        window.addEventListener('open-voice-library', handleOpen);
        return () => window.removeEventListener('open-voice-library', handleOpen);
    }, []);

    useEffect(() => {
        filterVoices();
    }, [voices, searchQuery, activeFilters]);

    const loadVoices = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/voices/library');
            const data = await response.json();
            setVoices(data.voices || []);
        } catch (error) {
            console.error('Failed to load voices:', error);
        } finally {
            setLoading(false);
        }
    };

    const filterVoices = () => {
        let filtered = voices;

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(v =>
                v.name.toLowerCase().includes(query) ||
                v.description.toLowerCase().includes(query)
            );
        }

        Object.entries(activeFilters).forEach(([key, value]) => {
            if (value) {
                if (key === 'price') {
                    filtered = filtered.filter(v =>
                        value === 'pro' ? v.isPro : !v.isPro
                    );
                } else if (key === 'language') {
                    filtered = filtered.filter(v =>
                        v.language.toLowerCase() === value.toLowerCase()
                    );
                } else {
                    filtered = filtered.filter(v =>
                        (v as any)[key]?.toLowerCase() === value.toLowerCase()
                    );
                }
            }
        });

        setFilteredVoices(filtered);
    };

    const addFilter = (category: keyof VoiceFilter, value: string) => {
        setActiveFilters(prev => ({
            ...prev,
            [category]: value.toLowerCase()
        }));
        // Reset search query if the user clicks a filter to avoid confusion
        setSearchQuery('');
    };

    const removeFilter = (category: keyof VoiceFilter) => {
        setActiveFilters(prev => {
            const updated = { ...prev };
            delete updated[category];
            return updated;
        });
    };

    const handleUseVoice = async (voice: LibraryVoice) => {
        if (voice.isPro && !isPro) {
            alert('This voice requires a Pro subscription');
            return;
        }

        try {
            const response = await fetch(voice.audioUrl);
            const blob = await response.blob();

            window.dispatchEvent(new CustomEvent('voice-file-updated', {
                detail: blob
            }));

            setIsOpen(false);
        } catch (error) {
            console.error('Failed to load voice:', error);
            alert('Failed to load voice. Please try again.');
        }
    };

    const openRecordModal = () => {
        setIsOpen(false);
        window.dispatchEvent(new Event('open-record-modal'));
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
                        <div className="icon-circle">
                            <Icon icon="lucide:library" width={20} />
                        </div>
                        <div>
                            <h3 className="modal-title">Voice Library</h3>
                            <p style={{ fontSize: '13px', color: 'var(--mauve-11)', margin: 0 }}>Find the perfect voice for your project</p>
                        </div>
                    </div>
                    <button className="modal-close" onClick={() => setIsOpen(false)}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                <div className="modal-body" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>

                    {/* Fixed Top Controls Section */}
                    <div className="controls-section">
                        {/* Search Input with Internal Chips */}
                        <div
                            className="chip-input-container"
                            onClick={() => inputRef.current?.focus()}
                        >
                            <Icon icon="lucide:search" width={18} style={{ color: 'var(--mauve-9)' }} />

                            {Object.entries(activeFilters).map(([category, value]) => (
                                <div key={category} className="input-chip">
                                    <span>{value}</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeFilter(category as keyof VoiceFilter);
                                        }}
                                    >
                                        <Icon icon="lucide:x" width={12} />
                                    </button>
                                </div>
                            ))}

                            <input
                                ref={inputRef}
                                type="text"
                                className="ghost-input"
                                placeholder={Object.keys(activeFilters).length === 0 ? "Search by name or description..." : "Add more text..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Grouped Filters */}
                        <div className="filter-scroll-container">
                            {Object.entries(FILTER_CATEGORIES).map(([category, options]) => (
                                <div key={category} className="filter-category-group">
                                    <span className="category-label">{category}</span>
                                    <div className="category-options">
                                        {options.map((option) => {
                                            const isActive = activeFilters[category as keyof VoiceFilter]?.toLowerCase() === option.toLowerCase();
                                            return (
                                                <button
                                                    key={option}
                                                    className={`filter-pill ${isActive ? 'active' : ''}`}
                                                    onClick={() => addFilter(category as keyof VoiceFilter, option)}
                                                >
                                                    {option}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Scrollable Voice Grid */}
                    <div className="results-area">
                        {loading ? (
                            <div className="loading-state">
                                <Icon icon="lucide:loader-2" width={32} className="spinner" />
                                <p>Loading voices...</p>
                            </div>
                        ) : filteredVoices.length > 0 ? (
                            <div className="voices-grid">
                                {filteredVoices.map((voice) => (
                                    <div key={voice.id} className="voice-card">
                                        <div className="voice-card-header">
                                            <div className="voice-info">
                                                <h4 className="voice-name">
                                                    {voice.name}
                                                    {voice.isPro && <span className="pro-badge">PRO</span>}
                                                </h4>
                                                <div className="voice-tags">
                                                    <span>{voice.gender}</span>
                                                    <span className="dot">•</span>
                                                    <span>{voice.language}</span>
                                                </div>
                                            </div>
                                            <span className="voice-flag">
                                                {LANGUAGE_FLAGS[voice.languageCode] || '🌐'}
                                            </span>
                                        </div>

                                        <p className="voice-desc">{voice.description}</p>

                                        <div className="voice-actions">
                                            <div className="player-wrapper">
                                                <AudioPlayer audioUrl={voice.audioUrl} />
                                            </div>
                                            <button
                                                className="btn-use"
                                                onClick={() => handleUseVoice(voice)}
                                                disabled={voice.isPro && !isPro}
                                            >
                                                Use
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-icon-circle">
                                    <Icon icon="lucide:mic-off" width={32} />
                                </div>
                                <h4>No voices found</h4>
                                <p>Try adjusting filters or record your own voice.</p>
                                <button className="btn btn-primary-outline" onClick={openRecordModal}>
                                    Record Voice
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                .icon-circle {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background: var(--orange-3);
                    color: var(--orange-9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .controls-section {
                    padding: var(--space-xs) var(--space-2xs);
                    border-bottom: 1px solid var(--mauve-4);
                    background: var(--mauve-1);
                    flex-shrink: 0;
                }

                .filter-scroll-container {
                    display: flex;
                    gap: var(--space-m);
                    overflow-x: auto;
                    padding: var(--space-2xs) 0 var(--space-2xs) 0;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                .filter-scroll-container::-webkit-scrollbar {
                    display: none;
                }

                .filter-category-group {
                    display: flex;
                    align-items: center;
                    background: var(--mauve-3);
                    border-radius: var(--radius-full);
                    padding: 4px;
                    flex-shrink: 0;
                    border: 1px solid var(--mauve-5);
                }

                .category-label {
                    font-size: 11px;
                    text-transform: uppercase;
                    font-weight: 600;
                    color: var(--mauve-9);
                    padding: 0 12px;
                    letter-spacing: 0.05em;
                }

                .category-options {
                    display: flex;
                    gap: 2px;
                }

                .filter-pill {
                    padding: 6px 14px;
                    border-radius: var(--radius-full);
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--mauve-11);
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }

                .filter-pill:hover {
                    color: var(--mauve-12);
                    background: var(--mauve-4);
                }

                .filter-pill.active {
                    background: var(--orange-9);
                    color: white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                .results-area {
                    flex: 1;
                    padding: var(--space-l);
                    background: var(--mauve-2);
                }

            .loading-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: var(--space-s);
            }

                .voices-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: var(--space-m);
                }

                .voice-card {
                    background: var(--mauve-1);
                    border: 1px solid var(--mauve-4);
                    border-radius: var(--radius-m);
                    padding: var(--space-m);
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .voice-card:hover {
                    border-color: var(--mauve-6);
                    box-shadow: var(--shadow-box-s);
                    transform: translateY(-2px);
                }

                .voice-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: var(--space-s);
                }

                .voice-name {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--mauve-12);
                    margin: 0 0 4px 0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .pro-badge {
                    font-size: 9px;
                    font-weight: 800;
                    background: linear-gradient(135deg, #FF0080, #7928CA);
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    letter-spacing: 0.05em;
                }

                .voice-tags {
                    font-size: 12px;
                    color: var(--mauve-10);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .dot { color: var(--mauve-6); }

                .voice-desc {
                    font-size: 13px;
                    color: var(--mauve-11);
                    line-height: 1.5;
                    margin-bottom: var(--space-m);
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }

                .voice-actions {
                    display: flex;
                    align-items: center;
                    gap: var(--space-s);
                    margin-top: auto;
                }
                
                .player-wrapper {
                    flex: 1;
                }

                .btn-use {
                    padding: 8px 16px;
                    background: var(--mauve-12);
                    color: var(--mauve-1);
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: opacity 0.2s;
                }
                .btn-use:hover { opacity: 0.9; }
                .btn-use:disabled { opacity: 0.5; cursor: not-allowed; }

                .empty-state {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    text-align: center;
                    color: var(--mauve-11);
                }
                .empty-icon-circle {
                    width: 64px;
                    height: 64px;
                    background: var(--mauve-3);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: var(--space-m);
                    color: var(--mauve-9);
                }
                
                .btn-primary-outline {
                    margin-top: var(--space-m);
                    padding: 8px 20px;
                    border: 1px solid var(--mauve-6);
                    background: var(--mauve-12);
                    color: var(--mauve-1);
                    border-radius: var(--radius-m);
                    font-weight: 600;
                    cursor: pointer;
                }
            `}</style>
        </div>
    );
}