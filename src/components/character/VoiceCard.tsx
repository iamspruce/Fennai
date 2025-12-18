// src/components/character/VoiceCard.tsx
import React, { useEffect, useState } from "react";
import AudioPlayer from "@/components/ui/AudioPlayer";
import { getVoiceFromIndexedDB, deleteVoiceFromIndexedDB } from "@/lib/db/indexdb";
import { truncateText } from "@/lib/utils/validation";
import "@/styles/voice-card.css"

// REFINED ICONS: Thinner strokes (1.5) and rounded caps for iOS look
const DownloadIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>;
const DeleteIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>;
const CloudIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>;
const DeviceIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>;
const ChevronIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;

interface VoiceCardProps {
    voice: any;
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

    const storageType = voice.storageType || 'local-only';

    // Parse multi-character dialogue
    const parseDialogue = () => {
        if (!voice.isMultiCharacter || !voice.characterIds) {
            return [{ characterId: voice.characterId, text: voice.text }];
        }
        if (voice.dialogues && Array.isArray(voice.dialogues)) return voice.dialogues;

        const dialogues: Array<{ characterId: string; text: string }> = [];
        const parts = voice.text.split(/\s*[|•]\s*/);
        voice.characterIds.forEach((charId: string, idx: number) => {
            dialogues.push({ characterId: charId, text: parts[idx] || voice.text });
        });
        return dialogues;
    };

    const dialogues = parseDialogue();
    // Slightly less truncation for cleaner look
    const displayText = voice.isMultiCharacter
        ? `${dialogues.length} Messages` // iOS style summary
        : truncateText(voice.text, 140);

    useEffect(() => {
        const loadAudio = async () => {
            setIsLoading(true);
            setError(null);
            if (storageType === 'cloud' && voice.audioUrl) {
                setAudioSource({ audioUrl: voice.audioUrl });
                setIsLoading(false);
                return;
            }
            if (storageType === 'local-only') {
                try {
                    const record = await getVoiceFromIndexedDB(voice.id);
                    if (!record?.audioBlob) { setError('local-only-missing'); setIsLoading(false); return; }
                    setAudioSource({ audioBlob: record.audioBlob });
                    setIsLoading(false);
                } catch (err) { setError('local-only-missing'); setIsLoading(false); }
            }
        };
        loadAudio();
    }, [voice.id, voice.audioUrl, storageType]);

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
            } else { return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `voice_${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) { alert("Download failed"); }
        finally { setIsDownloading(false); }
    };

    const handleDelete = async () => {
        if (isDeleting) return;
        window.dispatchEvent(new CustomEvent('open-delete-modal', {
            detail: {
                id: voice.id,
                itemText: voice.text,
                title: 'Delete Voice',
                description: 'This action cannot be undone. This voice will be permanently removed.',
                itemLabel: 'Delete Voice',
                onConfirm: async () => {
                    setIsDeleting(true);
                    try {
                        const response = await fetch("/api/voices/delete", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ voiceId: voice.id }),
                        });
                        if (!response.ok) throw new Error("Server delete failed");
                        if (storageType === 'local-only') await deleteVoiceFromIndexedDB(voice.id);
                        window.location.reload();
                    } catch (error) { setIsDeleting(false); }
                },
                onCancel: () => { }
            }
        }));
    };

    if (error === 'local-only-missing') return null;

    return (
        <div
            className={`voice-card visible ${isDeleting ? 'deleting' : ''}`}
            data-voice-id={voice.id}
        >
            <div className="voice-top">
                <div className="voice-header-content">
                    {/* Badge moved above text for hierarchy */}
                    {storageType === 'cloud' ? (
                        <span className="storage-badge cloud">
                            <CloudIcon /> <span>iCloud</span>
                        </span>
                    ) : (
                        <span className="storage-badge local">
                            <DeviceIcon /> <span>On Device</span>
                        </span>
                    )}

                    <p className="voice-summary-text">
                        {voice.isMultiCharacter ? (
                            <span style={{ color: "#8E8E93" }}>Group Chat • </span>
                        ) : null}
                        {voice.isMultiCharacter ? truncateText(voice.text, 80) : displayText}
                    </p>
                </div>

                <div className="voice-avatars">
                    {voice.isMultiCharacter && voice.characterIds ? (
                        <>
                            {voice.characterIds.slice(0, 3).map((rawId: any, idx: number) => { // Limit to 3 for clean facepile
                                const charId = typeof rawId === 'object' ? (rawId.characterId || rawId.id || '') : rawId;
                                if (!charId) return null;
                                const char = allCharacters.find((c: any) => c.id === charId || c.characterId === charId) ||
                                    (mainCharacter.id === charId || mainCharacter.characterId === charId ? mainCharacter : null);

                                return char ? (
                                    <img
                                        key={`${charId}-${idx}`}
                                        src={char.avatarUrl}
                                        alt={char.name}
                                        className="voice-avatar"
                                        style={{ zIndex: 10 - idx, marginLeft: idx > 0 ? "-12px" : "0" }}
                                    />
                                ) : null;
                            })}
                            {voice.characterIds.length > 3 && (
                                <div className="avatar-overflow" style={{ zIndex: 5, marginLeft: "-12px" }}>
                                    +{voice.characterIds.length - 3}
                                </div>
                            )}
                        </>
                    ) : (
                        <img src={mainCharacter.avatarUrl} alt={mainCharacter.name} className="voice-avatar" />
                    )}
                </div>
            </div>

            {/* iOS Style Threaded Conversation */}
            {voice.isMultiCharacter && dialogues.length > 1 && (
                <div className="dialogue-section">
                    <button
                        className="expand-toggle"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <span>{isExpanded ? "Hide conversation" : "View conversation"}</span>
                        <span className={`chevron ${isExpanded ? 'expanded' : ''}`}>
                            <ChevronIcon />
                        </span>
                    </button>

                    {isExpanded && (
                        <div className="dialogue-list">
                            {dialogues.map((dialogue: any, idx: number) => {
                                const char = allCharacters.find(c => c.id === dialogue.characterId) || mainCharacter;
                                if (!char) return null;

                                return (
                                    <div key={`${dialogue.characterId}-${idx}`} className="dialogue-item">
                                        <img src={char.avatarUrl} className="dialogue-avatar-small" alt="" />
                                        <div className="dialogue-bubble">
                                            <span className="dialogue-name">{char.name}</span>
                                            <p className="dialogue-text">{dialogue.text}</p>
                                        </div>
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
                        <span style={{ fontSize: "13px", color: "#8E8E93" }}>Loading...</span>
                    ) : !audioSource ? (
                        <span style={{ color: "#FF3B30", fontSize: "13px" }}>Unavailable</span>
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
                            className={`action-btn ${isDownloading ? "downloading" : ""}`}
                            onClick={handleDownload}
                            disabled={isDownloading || isLoading}
                            title="Download"
                        >
                            <DownloadIcon />
                        </button>
                    )}
                    <button
                        className={`action-btn delete ${isDeleting ? "deleting" : ""}`}
                        onClick={handleDelete}
                        disabled={isDeleting}
                        title="Delete"
                    >
                        <DeleteIcon />
                    </button>
                </div>
            </div>
        </div>
    );
}