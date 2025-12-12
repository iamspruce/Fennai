import { Icon } from '@iconify/react';
import { useState, useEffect } from 'react';

interface VoiceOptionsProps {
    hasError?: boolean;
}

type SourceType = 'upload' | 'library' | 'record';

interface SelectionState {
    type: SourceType;
    filename: string;
}

export default function VoiceOptions({ hasError }: VoiceOptionsProps) {
    const [selection, setSelection] = useState<SelectionState | null>(null);

    // Listen for file updates to update the UI cards
    useEffect(() => {
        const handleFileUpdate = (e: CustomEvent) => {
            const detail = e.detail;
            const file = detail.file || detail; // Support both {file, source} and legacy File
            const source = detail.source || 'upload'; // Default to upload if source missing

            if (file) {
                setSelection({
                    type: source as SourceType,
                    filename: file.name
                });
            } else {
                setSelection(null);
            }
        };

        window.addEventListener('voice-file-updated', handleFileUpdate as EventListener);
        return () => window.removeEventListener('voice-file-updated', handleFileUpdate as EventListener);
    }, []);

    const handleUploadClick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file) {
                // Dispatch with explicit source 'upload'
                window.dispatchEvent(new CustomEvent('voice-file-updated', {
                    detail: { file, source: 'upload' }
                }));
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

    // Helper to render card content based on selection state
    const renderCardContent = (
        type: SourceType,
        icon: string,
        defaultTitle: string,
        defaultDesc: string
    ) => {
        const isSelected = selection?.type === type;

        return (
            <>
                <div className={`voice-option-icon ${isSelected ? 'selected' : ''}`}>
                    <Icon
                        icon={isSelected ? "lucide:check-circle" : icon}
                        width={32}
                        height={32}
                    />
                </div>
                {isSelected ? (
                    <>
                        <h4 className="selected-text">Selected</h4>
                        <p className="selected-filename">{selection.filename}</p>
                    </>
                ) : (
                    <>
                        <h4>{defaultTitle}</h4>
                        <p>{defaultDesc}</p>
                    </>
                )}
            </>
        );
    };

    return (
        <div className={`voice-options ${hasError ? 'has-error' : ''}`}>
            {/* Upload Card */}
            <button
                type="button"
                className={`voice-option-card ${selection?.type === 'upload' ? 'active-selection' : ''}`}
                onClick={handleUploadClick}
            >
                {renderCardContent(
                    'upload',
                    'lucide:upload',
                    'Upload from computer',
                    'Select an audio file from your device'
                )}
            </button>

            {/* Library Card */}
            <button
                type="button"
                className={`voice-option-card ${selection?.type === 'library' ? 'active-selection' : ''}`}
                onClick={handleLibraryClick}
            >
                {renderCardContent(
                    'library',
                    'lucide:library',
                    'Pick from our library',
                    'Browse professional voice samples'
                )}
            </button>

            {/* Record Card */}
            <button
                type="button"
                className={`voice-option-card ${selection?.type === 'record' ? 'active-selection' : ''}`}
                onClick={handleRecordClick}
            >
                {renderCardContent(
                    'record',
                    'lucide:mic',
                    'Record your own voice',
                    'Create a custom voice recording'
                )}
            </button>

            <style>{`
                .voice-options {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: var(--space-m);
                    padding: var(--space-xs);
                    border-radius: var(--radius-l);
                    transition: box-shadow 0.3s ease;
                }
                
                .voice-options.has-error {
                    box-shadow: 0 0 0 2px var(--red-9);
                    background: rgba(239, 68, 68, 0.05);
                }

                .voice-option-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: var(--space-s);
                    padding: var(--space-l);
                    background: var(--mauve-2);
                    border: 2px solid var(--mauve-6);
                    border-radius: var(--radius-m);
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: center;
                    min-height: 180px; /* Ensure consistent height */
                }

                .voice-option-card:hover {
                    border-color: var(--orange-7);
                    background: var(--orange-2);
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-box-m);
                }

                /* Active Selection Styling (Green) */
                .voice-option-card.active-selection {
                    background: var(--green-2);
                    border-color: var(--green-9);
                    box-shadow: var(--shadow-box-s);
                }

                .voice-option-icon {
                    width: 64px;
                    height: 64px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--orange-3);
                    color: var(--orange-9);
                    border-radius: var(--radius-m);
                    transition: all 0.3s ease;
                }

                .voice-option-card:hover .voice-option-icon {
                    background: var(--orange-4);
                    color: var(--orange-10);
                }

                /* Active Selection Icon */
                .voice-option-icon.selected {
                    background: var(--green-9);
                    color: white;
                }
                
                .voice-option-card.active-selection:hover .voice-option-icon.selected {
                    background: var(--green-10);
                }

                .voice-option-card h4 {
                    font-size: var(--step-0);
                    font-weight: 600;
                    color: var(--mauve-12);
                    margin: 0;
                }
                
                .voice-option-card .selected-text {
                    color: var(--green-11);
                }

                .voice-option-card p {
                    font-size: 14px;
                    color: var(--mauve-11);
                    margin: 0;
                }
                
                .voice-option-card .selected-filename {
                    color: var(--green-11);
                    font-weight: 500;
                    word-break: break-all;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }

                @media (max-width: 768px) {
                    .voice-options {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
    );
}