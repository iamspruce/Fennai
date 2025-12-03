import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import '@/styles/modal.css';

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
        if (data?.onCancel) data.onCancel();
        setIsOpen(false);
    };

    if (!isOpen || !data) return null;

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content auth-modal-content" onClick={e => e.stopPropagation()}>

                {/* Mobile Handle */}
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <h3 className="modal-title" style={{ color: 'var(--red-9)' }}>Delete Voice</h3>
                    <button className="modal-close" onClick={handleCancel}>
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body" style={{ textAlign: 'center', paddingBottom: 'var(--space-xl)' }}>
                    <div style={{
                        width: 72, height: 72,
                        margin: 'var(--space-m) auto',
                        background: 'var(--red-3)',
                        borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--red-9)'
                    }}>
                        <Icon icon="lucide:trash-2" width={36} height={36} />
                    </div>

                    <h4 style={{ fontSize: 'var(--step-0)', fontWeight: 600, margin: '0 0 var(--space-xs)' }}>
                        Are you sure?
                    </h4>
                    <p style={{ fontSize: '14px', color: 'var(--mauve-11)', margin: '0 0 var(--space-l)', padding: '0 var(--space-m)' }}>
                        This action cannot be undone. <br />
                        <span style={{ color: 'var(--mauve-12)', fontStyle: 'italic', display: 'block', marginTop: '8px' }}>
                            "{data.voiceText.length > 40 ? data.voiceText.substring(0, 40) + '...' : data.voiceText}"
                        </span>
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <button
                            onClick={handleConfirm}
                            disabled={isDeleting}
                            className="btn btn-full"
                            style={{
                                background: 'var(--red-9)',
                                color: 'white',
                                border: 'none',
                                justifyContent: 'center',
                                padding: '14px'
                            }}
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Voice'}
                        </button>

                        <button
                            onClick={handleCancel}
                            disabled={isDeleting}
                            className="btn btn-full"
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--mauve-6)',
                                color: 'var(--mauve-11)',
                                justifyContent: 'center',
                                padding: '14px'
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}