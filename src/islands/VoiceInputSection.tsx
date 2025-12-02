import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '../types/character';

interface CharacterInput {
  id: string;
  characterId: string;
  character: Character;
  text: string;
}

interface VoiceInputSectionProps {
  character: Character;
  allCharacters: Character[];
}

export default function VoiceInputSection({ character, allCharacters }: VoiceInputSectionProps) {
  const [mainText, setMainText] = useState('');
  const [additionalInputs, setAdditionalInputs] = useState<CharacterInput[]>([]);
  const [showCharacterSelect, setShowCharacterSelect] = useState(false);

  const isMultiMode = additionalInputs.length > 0;
  const totalCharacters = 1 + additionalInputs.length;

  const availableCharacters = allCharacters.filter(
    c => c.id !== character.id && !additionalInputs.some(input => input.characterId === c.id)
  );

  const handleAddCharacter = (selectedCharacter: Character) => {
    if (additionalInputs.length >= 3) {
      alert('Maximum 4 characters allowed');
      return;
    }

    const newInput: CharacterInput = {
      id: `input_${Date.now()}`,
      characterId: selectedCharacter.id,
      character: selectedCharacter,
      text: ''
    };

    setAdditionalInputs([...additionalInputs, newInput]);
    setShowCharacterSelect(false);
  };

  const handleRemoveCharacter = (inputId: string) => {
    setAdditionalInputs(additionalInputs.filter(input => input.id !== inputId));
  };

  const handleUpdateText = (inputId: string, text: string) => {
    setAdditionalInputs(
      additionalInputs.map(input =>
        input.id === inputId ? { ...input, text } : input
      )
    );
  };

  const handleGenerate = async () => {
    if (!mainText.trim()) {
      alert('Please enter text for the main character');
      return;
    }

    if (isMultiMode) {
      const emptyInputs = additionalInputs.filter(input => !input.text.trim());
      if (emptyInputs.length > 0) {
        alert('Please fill in text for all characters');
        return;
      }
    }

    // Fetch sample audios
    const mainResponse = await fetch(`/api/characters/${character.id}/audio`);
    const mainAudioBlob = await mainResponse.blob();
    const mainAudioFile = new File([mainAudioBlob], 'sample.mp3', { type: 'audio/mpeg' });

    // Build character array with all data
    const allCharacterData = [
      {
        characterId: character.id,
        text: mainText,
        audioFile: mainAudioFile
      },
      ...await Promise.all(
        additionalInputs.map(async (input) => {
          const response = await fetch(`/api/characters/${input.characterId}/audio`);
          const audioBlob = await response.blob();
          const audioFile = new File([audioBlob], 'sample.mp3', { type: 'audio/mpeg' });

          return {
            characterId: input.characterId,
            text: input.text,
            audioFile
          };
        })
      )
    ];

    // Combine all text with delimiters for display
    const combinedText = allCharacterData.map(d => d.text).join(' | ');

    // Dispatch event to open cloning modal
    window.dispatchEvent(
      new CustomEvent('open-cloning-modal', {
        detail: {
          characterId: character.id,
          text: combinedText, // Combined text for display
          audioFile: mainAudioFile,
          isMultiCharacter: isMultiMode,
          characterIds: allCharacterData.map(d => d.characterId),
          texts: allCharacterData.map(d => d.text), // Individual texts
          additionalCharacters: allCharacterData.slice(1) // Exclude main character
        }
      })
    );
  };

  return (
    <motion.div
      className="voice-input-section-fixed"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="input-container-wrapper">
        <AnimatePresence>
          {isMultiMode && (
            <motion.div
              className="multi-mode-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="banner-content">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Multi-character dialogue • {totalCharacters} characters will speak in order</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Input */}
        <div className="input-container">
          <motion.div
            className="voice-input-wrapper main-input"
            layout
            transition={{ duration: 0.3 }}
          >
            <div className="input-number">1</div>
            <img
              src={character.avatarUrl}
              alt={character.name}
              className="input-avatar"
            />
            <input
              type="text"
              value={mainText}
              onChange={(e) => setMainText(e.target.value)}
              placeholder={`What should ${character.name} say?`}
              className="voice-text-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />

            <motion.button
              className="add-character-btn"
              onClick={() => setShowCharacterSelect(!showCharacterSelect)}
              title="Add character"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              disabled={additionalInputs.length >= 3 || availableCharacters.length === 0}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </motion.button>

            <motion.button
              className="send-btn"
              onClick={handleGenerate}
              title={isMultiMode ? `Generate dialogue (${totalCharacters} characters)` : 'Clone voice'}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              layout
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
              {isMultiMode && (
                <motion.span
                  className="character-count"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  {totalCharacters}
                </motion.span>
              )}
            </motion.button>
          </motion.div>

          {/* Character Selection Dropdown */}
          <AnimatePresence>
            {showCharacterSelect && availableCharacters.length > 0 && (
              <motion.div
                className="character-select-dropdown"
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <div className="dropdown-header">Select a character to add</div>
                {availableCharacters.map((char) => (
                  <motion.button
                    key={char.id}
                    className="character-select-item"
                    onClick={() => handleAddCharacter(char)}
                    whileHover={{ backgroundColor: 'var(--mauve-5)', x: 4 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <img
                      src={char.avatarUrl}
                      alt={char.name}
                      className="character-select-avatar"
                    />
                    <span>{char.name}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Additional Character Inputs with Arrows */}
        <AnimatePresence mode="popLayout">
          {additionalInputs.map((input, index) => (
            <React.Fragment key={input.id}>
              {/* Curved Arrow */}
              <motion.div
                className="dialogue-arrow"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <svg width="60" height="70" viewBox="0 0 60 60" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path
                    d="M 20 5 C 20 5, 50 10, 50 25 C 50 45, 15 30, 25 20 C 32 12, 30 50, 30 55"
                    stroke="var(--mauve-12)"
                    strokeWidth="2.5"
                    strokeDasharray="5 3"
                    fill="none"
                  />
                  <path
                    d="M 24 48 L 30 55 L 36 48"
                    stroke="var(--mauve-12)"
                    strokeWidth="2.5"
                    fill="none"
                  />
                </svg>
              </motion.div>

              {/* Character Input */}
              <motion.div
                className="voice-input-wrapper additional-input"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                layout
              >
                <div className="input-number">{index + 2}</div>

                <motion.button
                  className="remove-character-btn"
                  onClick={() => handleRemoveCharacter(input.id)}
                  title="Remove character"
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </motion.button>

                <img
                  src={input.character.avatarUrl}
                  alt={input.character.name}
                  className="input-avatar"
                />

                <input
                  type="text"
                  value={input.text}
                  onChange={(e) => handleUpdateText(input.id, e.target.value)}
                  placeholder={`What should ${input.character.name} say?`}
                  className="voice-text-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                />
              </motion.div>
            </React.Fragment>
          ))}
        </AnimatePresence>
      </div>

      <style>{`
        .voice-input-section-fixed {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          padding: var(--space-2xs) var(--space-s);
          z-index: 100;
        }

        .input-container-wrapper {
          max-width: 900px;
          margin: 0 auto;
        }

        .multi-mode-banner {
          padding: var(--space-3xs);
          margin-bottom: var(--space-xs);
          overflow: hidden;
        }

        .banner-content {
          display: flex;
          gap: var(--space-2xs);
          color: var(--mauve-11);
          font-weight: 500;
        }

        .banner-content span {
          font-size: calc(var(--step-0) * 0.7);
        }
        
        .banner-content svg {
          width: calc(var(--step-0) * 0.7);
          height: calc(var(--step-0) * 0.7);
        }

        .input-container {
          position: relative;
        }

        .voice-input-wrapper {
          display: flex;
          align-items: center;
          gap: var(--space-2xs);
          padding: var(--space-xs);
          background: var(--mauve-2);
          border: 2px solid var(--mauve-6);
          border-radius: var(--radius-l);
          transition: all 0.3s ease;
          position: relative;
        }

        @media (min-width: 768px) {
          .voice-input-wrapper {
            gap: var(--space-xs);
            padding: var(--space-s);
          }
        }

        .voice-input-wrapper.main-input {
          border-color: var(--mauve-6);
          box-shadow: var(--shadow-box-m);
        }

        .voice-input-wrapper:focus-within {
          border-color: var(--pink-9);
          box-shadow: var(--shadow-box-m);
        }

        .additional-input {
          margin-bottom: var(--space-s);
        }

        .input-number {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--mauve-12);
          color: var(--mauve-1);
          border-radius: 50%;
          font-size: 12px;
          font-weight: 700;
          flex-shrink: 0;
        }

        @media (min-width: 768px) {
          .input-number {
            width: 28px;
            height: 28px;
            font-size: 14px;
          }
        }

        .dialogue-arrow {
          display: flex;
          justify-content: center;
          margin: -8px 0;
          overflow: hidden;
        }

        .dialogue-arrow svg {
          animation: arrowPulse 2s ease-in-out infinite;
        }

        @keyframes arrowPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .input-avatar {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          border: 2px solid var(--mauve-6);
          flex-shrink: 0;
        }

        @media (min-width: 768px) {
          .input-avatar {
            width: 44px;
            height: 44px;
          }
        }

        .voice-text-input {
          flex: 1;
          background: none;
          border: none;
          font-size: 14px;
          color: var(--mauve-12);
          outline: none;
          padding: var(--space-2xs);
          min-width: 0;
        }

        @media (min-width: 768px) {
          .voice-text-input {
            font-size: 15px;
            padding: var(--space-xs);
          }
        }

        .voice-text-input::placeholder {
          color: var(--mauve-11);
        }

        .add-character-btn,
        .send-btn {
          height: 36px;
          min-width: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2xs);
          padding: 0 var(--space-xs);
          background: var(--mauve-3);
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-full);
          color: var(--mauve-12);
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
          font-weight: 600;
        }

        @media (min-width: 768px) {
          .add-character-btn,
          .send-btn {
            height: 44px;
            min-width: 44px;
            padding: 0 var(--space-s);
          }
        }

        .send-btn {
          background: var(--pink-9);
          border-color: var(--pink-9);
          color: white;
          position: relative;
        }

        .send-btn svg {
          width: 18px;
          height: 18px;
        }

        @media (min-width: 768px) {
          .send-btn svg {
            width: 20px;
            height: 20px;
          }
        }

        .character-count {
          background: white;
          color: var(--pink-9);
          border-radius: 50%;
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
        }

        @media (min-width: 768px) {
          .character-count {
            width: 20px;
            height: 20px;
            font-size: 12px;
          }
        }

        .add-character-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .add-character-btn:hover:not(:disabled) {
          background: var(--mauve-5);
          border-color: var(--mauve-7);
        }

        .send-btn:hover {
          background: var(--pink-10);
          box-shadow: 0 4px 12px rgba(214, 64, 159, 0.3);
        }

        .remove-character-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--mauve-3);
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-m);
          color: var(--mauve-11);
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.2s;
        }

        @media (min-width: 768px) {
          .remove-character-btn {
            width: 36px;
            height: 36px;
          }
        }

        .remove-character-btn:hover {
          background: var(--red-1);
          border-color: var(--red-9);
          color: var(--red-9);
        }

        .character-select-dropdown {
          position: absolute;
          bottom: calc(100% + var(--space-s));
          left: 0;
          right: 0;
          background: var(--mauve-2);
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-l);
          padding: var(--space-2xs);
          z-index: 10;
          max-height: 280px;
          overflow-y: auto;
          box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.1);
        }

        .dropdown-header {
          padding: var(--space-xs) var(--space-s);
          font-size: 13px;
          font-weight: 600;
          color: var(--mauve-11);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .character-select-item {
          display: flex;
          align-items: center;
          gap: var(--space-s);
          width: 100%;
          padding: var(--space-2xs);
          background: none;
          border: none;
          border-radius: var(--radius-m);
          color: var(--mauve-12);
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
          font-size: 15px;
        }

        .character-select-avatar {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-m);
          border: 2px solid var(--mauve-6);
          flex-shrink: 0;
        }
      `}</style>
    </motion.div>
  );
}