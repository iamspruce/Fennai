// src/islands/VoiceCard.tsx - Updated with storageType handling
import React, { useEffect, useState } from "react";
import AudioPlayer from "@/islands/AudioPlayer";
import { getVoiceFromIndexedDB, deleteVoiceFromIndexedDB } from "@/lib/db/indexdb";
import { truncateText } from "@/lib/utils/validation";
import "../styles/voice-card.css"

const DownloadIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>;
const DeleteIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>;
const CloudIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>;
const HardDriveIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" x2="2" y1="12" y2="12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><line x1="6" x2="6.01" y1="16" y2="16" /><line x1="10" x2="10.01" y1="16" y2="16" /></svg>;
const ChevronIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>;

interface VoiceCardProps {
    voice: any; // Contains storageType: 'cloud' | 'local-only'
    mainCharacter: any;
    allCharacters: any[];
}

export default function VoiceCard({ voice, mainCharacter, allCharacters }: VoiceCardProps) {
    const [audioSource, setAudioSource] = useState<{ audioUrl?: string; audioBlob?: Blob } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);

    const storageType = voice.storageType || 'local-only'; // Default for backward compatibility

    // Parse multi-character dialogue
    const parseDialogue = () => {
        if (!voice.isMultiCharacter || !voice.characterIds) {
            return [{ characterId: voice.characterId, text: voice.text }];
        }

        // If dialogues are stored, use them directly
        if (voice.dialogues && Array.isArray(voice.dialogues)) {
            return voice.dialogues;
        }

        // Fallback: split by delimiter
        const dialogues: Array<{ characterId: string; text: string }> = [];
        const parts = voice.text.split(/\s*[|•]\s*/);

        voice.characterIds.forEach((charId: string, idx: number) => {
            dialogues.push({
                characterId: charId,
                text: parts[idx] || voice.text
            });
        });

        return dialogues;
    };

    const dialogues = parseDialogue();
    const displayText = voice.isMultiCharacter
        ? `${dialogues.length} characters • ${truncateText(voice.text, 80)}`
        : truncateText(voice.text, 120);

    // Load Audio from appropriate source based on storageType
    useEffect(() => {
        const loadAudio = async () => {
            setIsLoading(true);
            setError(null);

            // CLOUD: Always prioritize cloud storage if available
            if (storageType === 'cloud' && voice.audioUrl) {
                setAudioSource({ audioUrl: voice.audioUrl });
                setIsLoading(false);
                return;
            }

            // LOCAL-ONLY: Try to load from IndexedDB
            if (storageType === 'local-only') {
                try {
                    const record = await getVoiceFromIndexedDB(voice.id);

                    if (!record?.audioBlob) {
                        setError('local-only-missing');
                        setIsLoading(false);
                        return;
                    }

                    setAudioSource({ audioBlob: record.audioBlob });
                    setIsLoading(false);
                } catch (err) {
                    setError('local-only-missing');
                    setIsLoading(false);
                }
            }
        };

        loadAudio();
    }, [voice.id, voice.audioUrl, storageType]);

    // Download Handler
    const handleDownload = async () => {
        if (isDownloading || !audioSource) return;

        setIsDownloading(true);
        try {
            let blob: Blob;

            if (audioSource.audioUrl) {
                const res = await fetch(audioSource.audioUrl);
                if (!res.ok) throw new Error('Failed to fetch');
                blob = await res.blob();
            } else if (audioSource.audioBlob) {
                blob = audioSource.audioBlob;
            } else {
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${truncateText(voice.text, 30).replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            alert("Download failed");
        } finally {
            setIsDownloading(false);
        }
    };

    // Delete Handler
    const handleDelete = async () => {
        if (isDeleting) return;

        window.dispatchEvent(new CustomEvent('open-delete-modal', {
            detail: {
                voiceId: voice.id,
                voiceText: voice.text,
                onConfirm: async () => {
                    setIsDeleting(true);
                    try {
                        const response = await fetch("/api/voices/delete", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ voiceId: voice.id }),
                        });

                        if (!response.ok) throw new Error("Server delete failed");

                        // Also delete from IndexedDB if it's local-only
                        if (storageType === 'local-only') {
                            await deleteVoiceFromIndexedDB(voice.id);
                        }

                        window.location.reload();
                    } catch (error) {
                        console.error('Delete failed:', error);
                        alert("Failed to delete voice");
                        setIsDeleting(false);
                    }
                },
                onCancel: () => {
                }
            }
        }));
    };

    // CRITICAL: Hide card if local-only but no audio available
    if (error === 'local-only-missing') {
        return null;
    }

    return (
        <div
            className={`voice-card visible ${isDeleting ? 'deleting' : ''}`}
            data-voice-id={voice.id}
            data-audio-url={voice.audioUrl || ''}
            data-is-multi={voice.isMultiCharacter}
            data-storage-type={storageType}
        >
            <div className="voice-top">
                <div className="voice-text-wrapper">
                    <p className="voice-text">{displayText}</p>

                    {/* Storage Badge */}
                    {storageType === 'cloud' && (
                        <span className="storage-badge cloud" title="Available on all devices">
                            <CloudIcon />
                            <span>Cloud</span>
                        </span>
                    )}
                    {storageType === 'local-only' && (
                        <span className="storage-badge local" title="Saved on this device only">
                            <HardDriveIcon />
                            <span>Local</span>
                        </span>
                    )}
                </div>

                <div className="voice-avatars">
                    {voice.isMultiCharacter && voice.characterIds ? (
                        <>
                            {voice.characterIds.slice(0, 4).map((charId: string, idx: number) => {
                                const char = allCharacters.find((c) => c.id === charId);
                                return char ? (
                                    <img
                                        key={charId}
                                        src={char.avatarUrl}
                                        alt={char.name}
                                        className="voice-avatar"
                                        title={char.name}
                                        style={{
                                            zIndex: 10 - idx,
                                            marginLeft: idx > 0 ? "-8px" : "0"
                                        }}
                                    />
                                ) : null;
                            })}
                            {voice.characterIds.length > 4 && (
                                <div className="avatar-overflow" style={{ zIndex: 5, marginLeft: "-8px" }}>
                                    +{voice.characterIds.length - 4}
                                </div>
                            )}
                        </>
                    ) : (
                        <img src={mainCharacter.avatarUrl} alt={mainCharacter.name} className="voice-avatar" />
                    )}
                </div>
            </div>

            {/* Expandable Dialogue Section */}
            {voice.isMultiCharacter && dialogues.length > 1 && (
                <div className="dialogue-section">
                    <button
                        className="expand-toggle"
                        onClick={() => setIsExpanded(!isExpanded)}
                        aria-expanded={isExpanded}
                    >
                        <span>View dialogue breakdown</span>
                        <span className={`chevron ${isExpanded ? 'expanded' : ''}`}>
                            <ChevronIcon />
                        </span>
                    </button>

                    {isExpanded && (
                        <div className="dialogue-list">
                            {dialogues.map((dialogue: { characterId: any; text: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | null | undefined; }, idx: number) => {
                                const char = allCharacters.find(c => c.id === dialogue.characterId);
                                if (!char) return null;

                                return (
                                    <div key={`${dialogue.characterId}-${idx}`} className="dialogue-item">
                                        <div className="dialogue-header">
                                            <img
                                                src={char.avatarUrl}
                                                alt={char.name}
                                                className="dialogue-avatar"
                                            />
                                            <span className="dialogue-name">{char.name}</span>
                                            <span className="dialogue-order">#{idx + 1}</span>
                                        </div>
                                        <p className="dialogue-text">{dialogue.text}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <div className="voice-bottom">
                <div className="voice-player-wrapper">
                    {isLoading ? (
                        <span style={{ fontSize: "12px", color: "#888" }}>Loading audio...</span>
                    ) : !audioSource ? (
                        <span style={{ color: "#ef4444", fontSize: "12px" }}>Audio unavailable</span>
                    ) : (
                        <AudioPlayer
                            audioUrl={audioSource.audioUrl}
                            audioBlob={audioSource.audioBlob}
                        />
                    )}
                </div>

                <div className="voice-actions">
                    {audioSource && (
                        <button
                            className={`download-voice-btn ${isDownloading ? "downloading" : ""}`}
                            onClick={handleDownload}
                            disabled={isDownloading || isLoading}
                            title="Download audio"
                        >
                            <DownloadIcon />
                        </button>
                    )}
                    <button
                        className={`delete-voice-btn ${isDeleting ? "deleting" : ""}`}
                        onClick={handleDelete}
                        disabled={isDeleting}
                        title="Delete voice"
                    >
                        <DeleteIcon />
                    </button>
                </div>
            </div>
        </div>
    );
}