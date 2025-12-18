// src/islands/DeleteConfirmationModal.tsx
import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';

interface DeleteConfirmationProps {
    id: string; // Generic ID (voiceId or jobId)
    title?: string;
    description?: string;
    itemLabel?: string;
    itemText?: string; // Preview text (voice script or file name)
    onConfirm: () => void;
    onCancel?: () => void;
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
            <div className="modal-content" onClick={e => e.stopPropagation()}>

                {/* Mobile Handle */}
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                {/* Modal Header */}
                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:trash-2" width={20} style={{ color: 'var(--red-9)' }} />
                        <h3 className="modal-title" style={{ color: 'var(--red-9)' }}>{data.title || 'Delete Item'}</h3>
                    </div>
                    <button className="modal-close" onClick={handleCancel} disabled={isDeleting}>
                        <Icon icon="lucide:x" width={20} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="modal-body">
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        padding: 'var(--space-m) 0 var(--space-xl)'
                    }}>

                        {/* Icon Circle */}
                        <div style={{
                            width: 72,
                            height: 72,
                            marginBottom: 'var(--space-m)',
                            background: 'var(--red-3)',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--red-9)'
                        }}>
                            <Icon icon="lucide:trash-2" width={36} height={36} />
                        </div>

                        {/* Title */}
                        <h4 style={{
                            fontSize: 'var(--step-0)',
                            fontWeight: 600,
                            color: 'var(--mauve-12)',
                            margin: '0 0 var(--space-xs)'
                        }}>
                            Are you sure?
                        </h4>

                        {/* Description */}
                        <p style={{
                            fontSize: '14px',
                            color: 'var(--mauve-11)',
                            margin: '0 0 var(--space-l)',
                            padding: '0 var(--space-m)',
                            lineHeight: 1.5
                        }}>
                            {data.description || 'This action cannot be undone.'}
                        </p>

                        {data.itemText && (
                            <div style={{
                                width: '100%',
                                padding: 'var(--space-s)',
                                background: 'var(--mauve-2)',
                                border: '1px solid var(--mauve-6)',
                                borderRadius: 'var(--radius-m)',
                                marginBottom: 'var(--space-l)'
                            }}>
                                <p style={{
                                    fontSize: '14px',
                                    color: 'var(--mauve-12)',
                                    fontStyle: 'italic',
                                    margin: 0,
                                    wordBreak: 'break-word'
                                }}>
                                    "{data.itemText.length > 60 ? data.itemText.substring(0, 60) + '...' : data.itemText}"
                                </p>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="action-buttons" style={{ width: '100%' }}>
                            <button
                                onClick={handleConfirm}
                                disabled={isDeleting}
                                className="btn btn-full"
                                style={{
                                    background: 'var(--red-9)',
                                    color: 'white',
                                    border: 'none',
                                    justifyContent: 'center',
                                    padding: '14px',
                                    fontWeight: 600,
                                    cursor: isDeleting ? 'not-allowed' : 'pointer',
                                    opacity: isDeleting ? 0.6 : 1
                                }}
                            >
                                {isDeleting ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{
                                            width: 16,
                                            height: 16,
                                            border: '2px solid white',
                                            borderTop: '2px solid transparent',
                                            borderRadius: '50%',
                                            animation: 'spin 0.6s linear infinite'
                                        }} />
                                        Deleting...
                                    </span>
                                ) : (data.itemLabel || 'Delete Voice')}
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
                                    padding: '14px',
                                    fontWeight: 500,
                                    cursor: isDeleting ? 'not-allowed' : 'pointer',
                                    opacity: isDeleting ? 0.6 : 1
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}