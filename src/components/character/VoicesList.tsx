// src/islands/VoicesList.tsx
import { useState, useEffect } from 'react';
import VoiceCard from '@/components/character/VoiceCard';
import { getVoiceFromIndexedDB } from '@/lib/db/indexdb';
import VoicesHeader from './VoicesHeader';

interface VoicesListProps {
    cloudVoices: any[];
    localOnlyIds: string[];
    mainCharacter: any;
    allCharacters: any[];
}

export default function VoicesList({
    cloudVoices,
    localOnlyIds,
    mainCharacter,
    allCharacters
}: VoicesListProps) {
    const [availableLocalVoices, setAvailableLocalVoices] = useState<any[]>([]);
    const [isCheckingLocal, setIsCheckingLocal] = useState(true);

    useEffect(() => {
        const checkLocalVoices = async () => {
            if (localOnlyIds.length === 0) {
                setIsCheckingLocal(false);
                return;
            }

            try {


                // Check which local-only voices actually exist in IndexedDB
                const available = [];

                for (const voiceId of localOnlyIds) {
                    try {
                        const record = await getVoiceFromIndexedDB(voiceId);

                        if (record?.audioBlob) {
                            available.push({
                                id: record.id,
                                characterId: record.characterId,
                                text: record.text,
                                storageType: 'local-only',
                                isMultiCharacter: record.isMultiCharacter,
                                characterIds: record.characterIds,
                                dialogues: record.dialogues,
                                duration: record.duration,
                                createdAt: new Date(record.createdAt),
                            });
                        }
                    } catch (err) {
                        // Voice doesn't exist locally, skip it

                    }
                }


                setAvailableLocalVoices(available);
            } catch (err) {
                console.error('[VoicesList] Error checking local voices:', err);
            } finally {
                setIsCheckingLocal(false);
            }
        };

        checkLocalVoices();
    }, [localOnlyIds]);

    // Combine and sort all available voices by creation date (newest first)
    const allAvailableVoices = [
        ...cloudVoices,
        ...availableLocalVoices
    ].sort((a, b) => {
        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return dateB.getTime() - dateA.getTime();
    });


    if (isCheckingLocal) {
        return (
            <div className="voices-loading">
                <div className="spinner" />
                <p>Loading your voices...</p>
                <style>{`
                    .voices-loading {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: var(--space-m);
                        padding: var(--space-xl) var(--space-m);
                        color: var(--mauve-11);
                    }
                    .voices-loading .spinner {
                        width: 40px;
                        height: 40px;
                        border: 4px solid var(--mauve-6);
                        border-top: 4px solid var(--orange-9);
                        border-radius: 50%;
                        animation: spinVoices 1s linear infinite;
                    }
                    @keyframes spinVoices {
                        to { transform: rotate(360deg); }
                    }
                    .voices-loading p {
                        margin: 0;
                        font-size: 0.95rem;
                    }
                `}</style>
            </div>
        );
    }

    if (allAvailableVoices.length === 0) {
        return (
            <div className="no-voices">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.3, marginBottom: '16px' }}>
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                </svg>
                <p>No voices yet. Generate your first one below!</p>
                <style>{`
                    .no-voices {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                        padding: var(--space-xl) var(--space-m);
                        color: var(--mauve-11);
                    }
                    .no-voices p {
                        margin: 0;
                        font-size: 0.95rem;
                    }
                `}</style>
            </div>
        );
    }

    return (
        <>
            <VoicesHeader totalVoices={allAvailableVoices.length} />
            <div className="voices-list">
                {allAvailableVoices.map((voice) => (
                    <VoiceCard
                        key={voice.id}
                        voice={voice}
                        mainCharacter={mainCharacter}
                        allCharacters={allCharacters}
                    />
                ))}
            </div>
            <style>{`
                .voices-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: var(--space-m);
                    padding: 0 var(--space-xs);
                }
                .voices-header h2 {
                    margin: 0;
                    font-size: 1.25rem;
                    font-weight: 600;
                    color: var(--mauve-12);
                }
                .voices-breakdown {
                    display: flex;
                    align-items: center;
                    gap: var(--space-xs);
                    font-size: 0.85rem;
                    color: var(--mauve-11);
                }
                .breakdown-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .breakdown-item.cloud {
                    color: var(--blue-11);
                }
                .breakdown-item.local {
                    color: var(--mauve-11);
                }
                .breakdown-divider {
                    color: var(--mauve-8);
                }
                .voices-list {
                    display: grid;
                    gap: var(--space-m);
                }
                @media (max-width: 768px) {
                    .voices-header {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: var(--space-xs);
                    }
                }
            `}</style>
        </>
    );
}