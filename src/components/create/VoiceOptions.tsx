// src/components/create/VoiceOptions.tsx
import { Icon } from '@iconify/react';

export default function VoiceOptions() {
    const handleUploadClick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file) {
                window.dispatchEvent(new CustomEvent('voice-file-updated', {
                    detail: file
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

    return (
        <div className="voice-options">
            <button
                type="button"
                className="voice-option-card"
                onClick={handleUploadClick}
            >
                <div className="voice-option-icon">
                    <Icon icon="lucide:upload" width={32} height={32} />
                </div>
                <h4>Upload from computer</h4>
                <p>Select an audio file from your device</p>
            </button>

            <button
                type="button"
                className="voice-option-card"
                onClick={handleLibraryClick}
            >
                <div className="voice-option-icon">
                    <Icon icon="lucide:library" width={32} height={32} />
                </div>
                <h4>Pick from our library</h4>
                <p>Browse professional voice samples</p>
            </button>

            <button
                type="button"
                className="voice-option-card"
                onClick={handleRecordClick}
            >
                <div className="voice-option-icon">
                    <Icon icon="lucide:mic" width={32} height={32} />
                </div>
                <h4>Record your own voice</h4>
                <p>Create a custom voice recording</p>
            </button>

            <style>{`
                .voice-options {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: var(--space-m);
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
                }

                .voice-option-card:hover {
                    border-color: var(--orange-7);
                    background: var(--orange-2);
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-box-m);
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
                }

                .voice-option-card:hover .voice-option-icon {
                    background: var(--orange-4);
                    color: var(--orange-10);
                }

                .voice-option-card h4 {
                    font-size: var(--step-0);
                    font-weight: 600;
                    color: var(--mauve-12);
                    margin: 0;
                }

                .voice-option-card p {
                    font-size: 14px;
                    color: var(--mauve-11);
                    margin: 0;
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