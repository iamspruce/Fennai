import { useState, useEffect } from 'react';

interface DeleteConfirmationProps {
    voiceId: string;
    voiceText: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function DeleteConfirmationModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState<DeleteConfirmationProps | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const handleOpen = (e: CustomEvent<DeleteConfirmationProps>) => {
            setData(e.detail);
            setIsOpen(true);
            setIsDeleting(false);
        };

        window.addEventListener('open-delete-modal', handleOpen as EventListener);
        return () => window.removeEventListener('open-delete-modal', handleOpen as EventListener);
    }, []);

    const handleConfirm = async () => {
        if (!data) return;

        setIsDeleting(true);
        try {
            await data.onConfirm();
            setIsOpen(false);
        } catch (error) {
            console.error('Delete failed:', error);
            setIsDeleting(false);
        }
    };

    const handleCancel = () => {
        if (data?.onCancel) {
            data.onCancel();
        }
        setIsOpen(false);
    };

    if (!isOpen || !data) return null;

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 style={{ margin: 0, fontSize: 'var(--step-1)', fontWeight: 600 }}>
                        Delete Voice
                    </h3>
                    <button className="modal-close" onClick={handleCancel}>
                        ×
                    </button>
                </div>

                <div style={{ padding: 'var(--space-m)', textAlign: 'center' }}>
                    <div style={{ marginBottom: 'var(--space-l)' }}>
                        <div style={{
                            width: 64, height: 64, margin: '0 auto var(--space-m)',
                            background: 'var(--red-4)', borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <svg width="32" height="32" fill="none" stroke="var(--red-11)" strokeWidth="2.5" viewBox="0 0 24 24">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <p style={{ fontSize: 'var(--step-0)', marginBottom: 'var(--space-s)' }}>
                            Are you sure you want to delete this voice?
                        </p>
                        <p style={{ fontSize: 'var(--step--1)', color: 'var(--mauve-11)', fontStyle: 'italic' }}>
                            "{data.voiceText}"
                        </p>
                    </div>

                    <div className="modal-actions">
                        <button onClick={handleCancel} disabled={isDeleting} className="btn">
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isDeleting}
                            style={{ background: 'var(--red-9)', color: 'white' }}
                            className="btn"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Voice'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}