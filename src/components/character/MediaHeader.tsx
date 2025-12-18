// src/components/character/MediaHeader.tsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getVoiceFromIndexedDB } from '@/lib/db/indexdb';

interface MediaHeaderProps {
  totalVoices: number;
  totalDubbing?: number;
}

export default function MediaHeader({ totalVoices, totalDubbing = 0 }: MediaHeaderProps) {
  const [showFilter, setShowFilter] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'single' | 'multi'>('all');
  const [isDownloading, setIsDownloading] = useState(false);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowFilter(false);
    if (showFilter) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showFilter]);

  const handleDownloadMultiple = async () => {
    if (isDownloading) return;
    setIsDownloading(true);

    const voiceCards = document.querySelectorAll('.voice-card.visible');
    const downloads: Array<{
      voiceId: string;
      audioUrl?: string;
      title: string;
    }> = [];

    voiceCards.forEach((card) => {
      const voiceId = card.getAttribute('data-voice-id');
      const audioUrl = card.getAttribute('data-audio-url') || undefined;
      const text = card.querySelector('.voice-text')?.textContent || 'voice';
      if (voiceId) {
        downloads.push({ voiceId, audioUrl, title: text.trim() });
      }
    });

    if (downloads.length === 0) {
      alert('No visible voices to download');
      setIsDownloading(false);
      return;
    }

    for (let i = 0; i < downloads.length; i++) {
      const { voiceId, audioUrl, title } = downloads[i];
      try {
        let blob: Blob;

        if (audioUrl) {
          const res = await fetch(audioUrl);
          if (!res.ok) throw new Error('Failed to fetch');
          blob = await res.blob();
        } else {
          const record = await getVoiceFromIndexedDB(voiceId);
          if (!record?.audioBlob) {
            console.warn(`No local audio for voice ${voiceId}`);
            continue;
          }
          blob = record.audioBlob;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-z0-9]/gi, '_').slice(0, 30) || 'voice'}_${i + 1}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Small delay to avoid browser blocking
        if (i < downloads.length - 1) {
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (err) {
        console.error(`Failed to download voice ${i + 1}:`, err);
      }
    }

    setIsDownloading(false);
  };

  const applyFilter = (filter: 'all' | 'single' | 'multi') => {
    setSelectedFilter(filter);
    const cards = document.querySelectorAll('.voice-card');

    cards.forEach((card) => {
      const isMulti = card.getAttribute('data-is-multi') === 'true';
      const shouldShow =
        filter === 'all' ||
        (filter === 'single' && !isMulti) ||
        (filter === 'multi' && isMulti);

      (card as HTMLElement).style.display = shouldShow ? 'flex' : 'none';
      // Update visibility class for download logic
      card.classList.toggle('visible', shouldShow);
    });

    setShowFilter(false);
  };

  const visibleCount = document.querySelectorAll('.voice-card.visible').length;
  const totalMedia = totalVoices + totalDubbing;

  return (
    <div className="media-header">
      <div className="media-summary">
        <h2>
          Media <span className="count">({visibleCount > 0 ? visibleCount : totalMedia})</span>
        </h2>
        {totalDubbing > 0 && (
          <div className="media-breakdown">
            <span className="breakdown-item">{totalVoices} voices</span>
            <span className="breakdown-divider">•</span>
            <span className="breakdown-item dubbed">{totalDubbing} dubbed</span>
          </div>
        )}
        {selectedFilter !== 'all' && (
          <button className="clear-filter" onClick={() => applyFilter('all')}>
            Clear filter
          </button>
        )}
      </div>

      <motion.div className="media-header-actions">
        <motion.button
          className={`header-btn download-all ${isDownloading ? 'loading' : ''}`}
          onClick={handleDownloadMultiple}
          disabled={isDownloading || visibleCount === 0}
          whileHover={{ scale: visibleCount > 0 ? 1.05 : 1 }}
          whileTap={{ scale: visibleCount > 0 ? 0.95 : 1 }}
          title={visibleCount > 0 ? `Download ${visibleCount} voice(s)` : 'No voices to download'}
        >
          {isDownloading ? (
            <span className="spinner" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          )}
          <span className="btn-text">Download All</span>
        </motion.button>

        <div className="filter-wrapper">
          <motion.button
            className={`header-btn filter-toggle ${showFilter ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowFilter(!showFilter);
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span className="btn-text">
              {selectedFilter === 'all' ? 'Filter' : selectedFilter === 'single' ? 'Single' : 'Multi'}
            </span>
          </motion.button>

          <AnimatePresence>
            {showFilter && (
              <motion.div
                className="filter-dropdown"
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
              >
                {(['all', 'single', 'multi'] as const).map((filter) => (
                  <motion.button
                    key={filter}
                    className={`filter-option ${selectedFilter === filter ? 'selected' : ''}`}
                    onClick={() => applyFilter(filter)}
                    whileHover={{ backgroundColor: 'var(--mauve-5)' }}
                  >
                    <span>
                      {filter === 'all' ? 'All Media' : filter === 'single' ? 'Single Character' : 'Multi-Character'}
                    </span>
                    {selectedFilter === filter && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <style>{`
        .media-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-l);
          flex-wrap: wrap;
          gap: var(--space-s);
        }

        .media-summary {
          display: flex;
          align-items: center;
          gap: var(--space-m);
        }

        .media-summary h2 {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--mauve-12);
          margin: 0;
        }

        .count {
          font-weight: normal;
          color: var(--mauve-11);
          font-size: 1.1rem;
        }

        .clear-filter {
          background: none;
          border: none;
          color: var(--orange-10);
          font-size: 0.9rem;
          cursor: pointer;
          text-decoration: underline;
        }

        .media-breakdown {
          display: flex;
          align-items: center;
          gap: var(--space-2xs);
          font-size: 0.85rem;
          color: var(--mauve-11);
        }

        .breakdown-item {
          font-weight: 500;
        }

        .breakdown-item.dubbed {
          color: var(--orange-11);
        }

        .breakdown-divider {
          color: var(--mauve-8);
        }

        .media-header-actions {
          display: flex;
          gap: var(--space-xs);
        }

        .header-btn {
          display: flex;
          align-items: center;
          gap: var(--space-2xs);
          padding: var(--space-xs) var(--space-s);
          background: var(--mauve-3);
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-m);
          color: var(--mauve-12);
          font-size: 0.95rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .header-btn:hover {
          background: var(--mauve-4);
          border-color: var(--mauve-7);
        }

        .header-btn.active {
          background: var(--mauve-5);
          border-color: var(--mauve-8);
        }

        .header-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .header-btn.loading {
          pointer-events: none;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top: 2px solid currentColor;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .filter-wrapper {
          position: relative;
        }

        .filter-dropdown {
          position: absolute;
          top: calc(100% + var(--space-xs));
          right: 0;
          background: var(--mauve-2);
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-m);
          padding: var(--space-2xs);
          min-width: 200px;
          z-index: 100;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
        }

        .filter-option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: var(--space-xs) var(--space-s);
          background: none;
          border: none;
          border-radius: var(--radius-s);
          color: var(--mauve-12);
          font-size: 0.95rem;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-option:hover {
          background: var(--mauve-5);
        }

        .filter-option.selected {
          color: var(--orange-11);
          font-weight: 600;
        }

        .filter-option svg {
          color: var(--orange-10);
        }

        @media (max-width: 640px) {
          .media-header {
            flex-direction: column;
            align-items: stretch;
          }

          .media-header-actions {
            justify-content: stretch;
          }

          .header-btn {
            justify-content: center;
          }

          .btn-text {
            display: none;
          }

          .filter-dropdown {
            right: auto;
            left: 50%;
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}