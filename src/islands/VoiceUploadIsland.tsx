// islands/VoiceUploadIsland.tsx
import { motion } from "framer-motion";
import { useState } from "react";

export default function VoiceUploadIsland() {
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleFile = (file: File) => {
        if (file && file.type.startsWith("audio/") && file.size <= 10 * 1024 * 1024) {
            setFile(file);
            window.dispatchEvent(new CustomEvent("open-preview-modal", { detail: { audioBlob: file, source: "create-upload" } }));
        }
    };

    return (
        <div className="form-section">
            <label className="section-label">Give your character a voice</label>

            <motion.div
                className={`upload-area ${dragActive ? "drag-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer?.files[0]) handleFile(e.dataTransfer.files[0]);
                }}
                onClick={() => document.getElementById("voice-upload")?.click()}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
            >
                <input
                    type="file"
                    id="voice-upload"
                    accept="audio/*"
                    hidden
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />

                {!file ? (
                    <motion.div
                        className="upload-placeholder"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                    >
                        <motion.div
                            animate={{ y: [0, -10, 0] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        >
                            <svg width="64" height="64" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" fill="none">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" x2="12" y1="3" y2="15" />
                            </svg>
                        </motion.div>
                        <p>Click to upload or drag & drop</p>
                        <span>MP3, WAV, OGG • Max 10MB</span>
                    </motion.div>
                ) : (
                    <motion.div
                        className="upload-preview"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        <div className="file-info">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 18V5l12-2v13" />
                                <circle cx="6" cy="18" r="3" />
                                <circle cx="18" cy="16" r="3" />
                            </svg>
                            <div>
                                <p className="file-name">{file.name}</p>
                                <p className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <motion.button
                            type="button"
                            className="remove-file"
                            onClick={(e) => { e.stopPropagation(); setFile(null); }}
                            whileHover={{ rotate: 90 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </motion.button>
                    </motion.div>
                )}
            </motion.div>
        </div>
    );
}