import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CreateCharacterModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleOpen = () => setIsOpen(true);
        window.addEventListener('open-create-character-modal', handleOpen);
        return () => window.removeEventListener('open-create-character-modal', handleOpen);
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setAvatarPreview(url);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setIsSubmitting(true);

        try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            if (fileInputRef.current?.files?.[0]) {
                formData.append('avatar', fileInputRef.current.files[0]);
            }

            // Replace this with your actual API endpoint for creating a character
            const response = await fetch('/api/characters/create', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Failed to create character');

            // Refresh to load new character data
            window.location.reload();

        } catch (error) {
            console.error(error);
            alert('Failed to create character');
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="modal-overlay" onClick={() => setIsOpen(false)}>
                <motion.div
                    className="modal-content"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="modal-header">
                        <h3>Create New Character</h3>
                        <button className="close-btn" onClick={() => setIsOpen(false)}>
                            <Icon icon="lucide:x" width={20} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="avatar-upload-section">
                            <div
                                className="avatar-preview"
                                onClick={() => fileInputRef.current?.click()}
                                style={{ backgroundImage: avatarPreview ? `url(${avatarPreview})` : 'none' }}
                            >
                                {!avatarPreview && <Icon icon="lucide:camera" width={24} className="camera-icon" />}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileChange}
                                hidden
                            />
                            <button type="button" className="text-btn" onClick={() => fileInputRef.current?.click()}>
                                Upload Avatar
                            </button>
                        </div>

                        <div className="form-group">
                            <label>Character Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Naruto Uzumaki"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Description (Optional)</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief personality description..."
                                rows={3}
                            />
                        </div>

                        <button type="submit" className="submit-btn" disabled={isSubmitting}>
                            {isSubmitting ? 'Creating...' : 'Create Character'}
                        </button>
                    </form>

                </motion.div>
            </div>

        </AnimatePresence>
    );
}