import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "../../styles/VoiceDropzone.css";

export default function VoiceDropzone() {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);

    // Dispatch event to main Astro script
    const dispatchFile = (uploadedFile: File | null) => {
        setFile(uploadedFile);
        window.dispatchEvent(
            new CustomEvent("voice-file-updated", { detail: uploadedFile })
        );

        // Trigger the preview modal logic if file exists (Optional hook into your existing logic)
        if (uploadedFile) {
            window.dispatchEvent(new CustomEvent("trigger-preview-logic", { detail: uploadedFile }));
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.[0]) dispatchFile(e.dataTransfer.files[0]);
    };

    return (
        <motion.div
            className={`dropzone ${isDragging ? "active" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("voice-upload-hidden")?.click()}
            animate={isDragging ? { scale: 1.02, backgroundColor: "var(--pink-2)" } : { scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
        >
            <AnimatePresence mode="wait">
                {!file ? (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="dropzone-content"
                    >
                        <div className="icon-wrapper">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>
                        </div>
                        <p>Click to upload or drag and drop</p>
                        <span>MP3, WAV, or OGG (max 10MB)</span>
                    </motion.div>
                ) : (
                    <motion.div
                        key="filled"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="file-preview"
                    >
                        <div className="file-info">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                            <span>{file.name}</span>
                        </div>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); dispatchFile(null); }}
                            className="remove-btn"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"></path></svg>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Hidden input for the click handler */}
            <input
                type="file"
                id="voice-upload-hidden"
                hidden
                accept="audio/*"
                onChange={(e) => e.target.files?.[0] && dispatchFile(e.target.files[0])}
            />
        </motion.div>
    );
}