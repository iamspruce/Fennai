// src/components/dubbing/DubbingVideoCard.tsx
import { Icon } from '@iconify/react';
import type { DubbingJob } from '@/types/dubbing';

interface DubbingVideoCardProps {
    job: DubbingJob;
    onPlay?: (jobId: string) => void;
    onDelete?: (jobId: string) => void;
}

export default function DubbingVideoCard({ job, onPlay, onDelete }: DubbingVideoCardProps) {
    const formatDate = (ts: any) => {
        const d = ts?.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="dub-card-container completed" onClick={() => onPlay?.(job.id)}>
            {/* The Stack effect visual layers */}
            <div className="card-layer-bg second" />
            <div className="card-layer-bg first" />

            <div className="card-primary">
                <div className="card-preview">
                    <Icon
                        icon={job.mediaType === 'video' ? "lucide:video" : "lucide:music"}
                        width={32}
                    />
                    <div className="badge success">Dubbed</div>
                </div>

                <div className="card-body">
                    <h4 className="card-title" title={job.fileName}>{job.fileName || 'Untitled'}</h4>
                    <div className="card-meta">
                        <span>
                            {Math.floor((job.duration || 0) / 60)}:{((job.duration || 0) % 60).toString().padStart(2, '0')} • {formatDate(job.createdAt)}
                        </span>
                    </div>
                </div>

                <div className="card-hover-actions">
                    <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); onDelete?.(job.id); }} title="Delete">
                        <Icon icon="lucide:trash-2" width={16} />
                    </button>
                    <button className="icon-btn play" onClick={(e) => { e.stopPropagation(); onPlay?.(job.id); }} title="Play">
                        <Icon icon="lucide:play" width={18} />
                    </button>
                </div>
            </div>

            <style>{`
                .dub-card-container {
                    position: relative;
                    width: 100%;
                    cursor: pointer;
                    padding-bottom: 12px;
                }

                .card-layer-bg {
                    position: absolute;
                    inset: 0 4px 0 4px;
                    background: var(--mauve-2);
                    border: 1px solid var(--mauve-6);
                    border-radius: var(--radius-l);
                    transition: transform 0.3s ease;
                }

                .card-layer-bg.first { transform: translateY(6px) scale(0.98); z-index: 1; opacity: 0.8; }
                .card-layer-bg.second { transform: translateY(12px) scale(0.96); z-index: 0; opacity: 0.4; }

                .dub-card-container:hover .card-layer-bg.first { transform: translateY(8px) scale(0.97); }
                .dub-card-container:hover .card-layer-bg.second { transform: translateY(16px) scale(0.94); }

                .card-primary {
                    position: relative;
                    z-index: 2;
                    background: white;
                    border: 1px solid var(--mauve-6);
                    border-radius: var(--radius-l);
                    overflow: hidden;
                    aspect-ratio: 16 / 10;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }

                .dub-card-container:hover .card-primary {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
                }

                .card-preview {
                    flex: 1;
                    background: var(--mauve-2);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--mauve-8);
                    position: relative;
                }

                .badge {
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    padding: 4px 8px;
                    border-radius: 6px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .badge.success { background: var(--orange-9); color: white; }

                .card-body {
                    padding: 12px;
                    border-top: 1px solid var(--mauve-4);
                }

                .card-title {
                    margin: 0 0 4px 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--mauve-12);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .card-meta {
                    font-size: 12px;
                    color: var(--mauve-11);
                }


                .card-hover-actions {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                    z-index: 10;
                }

                .dub-card-container:hover .card-hover-actions {
                    opacity: 1;
                }

                .icon-btn {
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    background: white;
                    border: 1px solid var(--mauve-6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    color: var(--mauve-11);
                }

                .icon-btn:hover { transform: scale(1.1); color: var(--mauve-12); }
                .icon-btn.delete:hover { background: var(--red-9); color: white; border-color: var(--red-9); box-shadow: 0 4px 12px var(--red-4); }
                .icon-btn.play:hover { background: var(--orange-9); color: white; border-color: var(--orange-9); box-shadow: 0 4px 12px var(--orange-4); }


                @media (max-width: 768px) {
                    .card-hover-actions { opacity: 1; }
                }
            `}</style>
        </div>
    );
}
