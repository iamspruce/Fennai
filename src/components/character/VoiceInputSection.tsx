import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '@/types/character';
import { Icon } from '@iconify/react';

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
  const mainInputRef = useRef<HTMLTextAreaElement>(null);

  const isMultiMode = additionalInputs.length > 0;
  const totalCharacters = 1 + additionalInputs.length;

  const availableCharacters = allCharacters.filter(
    c => c.id !== character.id && !additionalInputs.some(input => input.characterId === c.id)
  );

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    if (mainInputRef.current) adjustHeight(mainInputRef.current);
  }, [mainText]);

  // ==================== Handlers ====================

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

  const handleGenerate = () => {
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

    const allCharacterData = [
      { characterId: character.id, text: mainText },
      ...additionalInputs.map((input) => ({
        characterId: input.characterId,
        text: input.text
      }))
    ];

    const combinedText = allCharacterData.map(d => d.text).join(' | ');

    window.dispatchEvent(
      new CustomEvent('open-cloning-modal', {
        detail: {
          characterId: character.id,
          text: combinedText,
          isMultiCharacter: isMultiMode,
          characterIds: allCharacterData.map(d => d.characterId),
          texts: allCharacterData.map(d => d.text)
        }
      })
    );
  };

  const handleOpenScriptGenerator = () => {
    window.dispatchEvent(
      new CustomEvent('open-script-generator', {
        detail: {
          character,
          allCharacters,
          currentText: mainText,
          onScriptGenerated: (script: { mainText: string; additionalInputs?: CharacterInput[] }) => {
            setMainText(script.mainText);
            if (script.additionalInputs) setAdditionalInputs(script.additionalInputs);
          }
        }
      })
    );
  };

  const handleOpenDubbing = () => {
    window.dispatchEvent(
      new CustomEvent('open-dubbing-modal', {
        detail: { character, allCharacters }
      })
    );
  };

  const handleOpenCreateModal = () => {
    setShowCharacterSelect(false);
    window.dispatchEvent(new CustomEvent('open-create-character-modal'));
  };

  return (
    <>
      <motion.div
        className="voice-input-section-fixed"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="input-container-wrapper">

          <div className="input-container">
            <motion.div className="voice-input-surface" layout>

              <div className="input-top-area">
                <div className="avatar-stack">
                  <div className="input-number">1</div>
                  <img src={character.avatarUrl} alt={character.name} className="input-avatar" />
                </div>
                <textarea
                  ref={mainInputRef}
                  value={mainText}
                  onChange={(e) => setMainText(e.target.value)}
                  placeholder={`What should ${character.name} say?`}
                  className="voice-textarea"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                />
              </div>

              <div className="input-toolbar">
                <div className="tools-left">
                  <button className="tool-btn" onClick={handleOpenScriptGenerator} title="AI Script">
                    <Icon icon="lucide:sparkles" width={18} />
                    <span className="tool-label">Script</span>
                  </button>
                  <button className="tool-btn" onClick={handleOpenDubbing} title="Dubbing">
                    <Icon icon="lucide:video" width={18} />
                    <span className="tool-label">Dub</span>
                  </button>
                  <button
                    className="tool-btn"
                    onClick={() => setShowCharacterSelect(!showCharacterSelect)}
                    disabled={additionalInputs.length >= 3}
                    title="Add Character"
                  >
                    <Icon icon="lucide:user-plus" width={18} />
                    <span className="tool-label">Add</span>
                  </button>
                </div>

                <motion.button className="send-btn" onClick={handleGenerate} whileTap={{ scale: 0.95 }}>
                  <Icon icon="lucide:send" width={18} />
                  {isMultiMode && <span className="count-badge">{totalCharacters}</span>}
                </motion.button>
              </div>
            </motion.div>

            {/* Character Selection Dropdown */}
            <AnimatePresence>
              {showCharacterSelect && (
                <motion.div
                  className="character-select-dropdown"
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                >
                  <div className="dropdown-header">Add to dialogue</div>

                  <div className="dropdown-list">
                    {availableCharacters.length > 0 ? (
                      availableCharacters.map((char) => (
                        <motion.button
                          key={char.id}
                          className="character-select-item"
                          onClick={() => handleAddCharacter(char)}
                        >
                          <img src={char.avatarUrl} alt={char.name} className="character-select-avatar" />
                          <span>{char.name}</span>
                        </motion.button>
                      ))
                    ) : (
                      <div className="empty-state">No other characters available</div>
                    )}
                  </div>

                  <div className="dropdown-divider"></div>

                  <motion.button
                    className="character-select-item create-new-btn"
                    onClick={handleOpenCreateModal}
                  >
                    <div className="create-icon-wrapper">
                      <Icon icon="lucide:plus" width={16} />
                    </div>
                    <span>Create New Character</span>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Additional Inputs */}
          <AnimatePresence>
            {additionalInputs.map((input, index) => (
              <React.Fragment key={input.id}>
                <motion.div
                  className="dialogue-connector"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: '20px', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <div className="connector-line"></div>
                </motion.div>
                <motion.div
                  className="voice-input-surface additional-surface"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  layout
                >
                  <div className="input-top-area">
                    <div className="avatar-stack">
                      <div className="input-number">{index + 2}</div>
                      <img src={input.character.avatarUrl} alt={input.character.name} className="input-avatar" />
                    </div>
                    <textarea
                      value={input.text}
                      onChange={(e) => {
                        handleUpdateText(input.id, e.target.value);
                        adjustHeight(e.target);
                      }}
                      placeholder={`Next line for ${input.character.name}...`}
                      className="voice-textarea"
                      rows={1}
                    />
                    <button className="remove-btn" onClick={() => handleRemoveCharacter(input.id)}>
                      <Icon icon="lucide:x" width={16} />
                    </button>
                  </div>
                </motion.div>
              </React.Fragment>
            ))}
          </AnimatePresence>
        </div>

        <style>{`
          /* ... Previous container/surface styles ... */
          .voice-input-section-fixed {
            position: fixed; bottom: 0; left: 0; right: 0;
            padding: 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom));
            z-index: 100;
            background: linear-gradient(to top, var(--mauve-1) 85%, transparent);
            pointer-events: none;
          }
          .input-container-wrapper { max-width: 800px; margin: 0 auto; pointer-events: auto; display: flex; flex-direction: column; }
          .voice-input-surface {
            background: var(--mauve-3); border: 1px solid var(--mauve-6); border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden; transition: all 0.2s;
            display: flex; flex-direction: column;
          }
          .voice-input-surface:focus-within {
            border-color: var(--orange-9); box-shadow: 0 4px 25px rgba(214, 64, 159, 0.12); background: var(--mauve-1);
          }
          .input-top-area { display: flex; align-items: flex-start; padding: 12px 12px 4px 12px; gap: 10px; }
          .avatar-stack { position: relative; width: 32px; height: 32px; flex-shrink: 0; margin-top: 2px; }
          .input-avatar { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 1px solid var(--mauve-6); }
          .input-number {
            position: absolute; top: -4px; right: -4px; width: 14px; height: 14px;
            background: var(--mauve-12); color: var(--mauve-1); font-size: 9px; font-weight: bold;
            border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 2;
          }
          .voice-textarea {
            flex: 1; border: none; background: transparent; font-size: 16px; line-height: 1.4;
            color: var(--mauve-12); padding: 6px 0; min-height: 24px; resize: none; outline: none; font-family: inherit;
          }
          .input-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 8px 8px; }
          .tools-left { display: flex; align-items: center; gap: 4px; }
          .tool-btn {
            display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 8px;
            border: none; background: transparent; color: var(--mauve-11); font-size: 13px; font-weight: 500;
            cursor: pointer; transition: background 0.2s;
          }
          .tool-btn:hover { background: var(--mauve-4); color: var(--mauve-12); }
          .tool-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .tool-label { display: none; }
          @media (min-width: 480px) { .tool-label { display: block; } }
          .send-btn {
            width: 36px; height: 36px; border-radius: 50%; background: var(--orange-9); color: white; border: none;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer;
            position: relative; box-shadow: 0 2px 8px rgba(214, 64, 159, 0.4);
          }
          .count-badge {
            position: absolute; top: -2px; right: -2px; background: white; color: var(--orange-9);
            font-size: 10px; font-weight: bold; width: 14px; height: 14px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
          }
          .dialogue-connector { display: flex; justify-content: center; align-items: center; width: 40px; margin-left: 12px; }
          .connector-line { width: 2px; height: 100%; background: var(--mauve-6); }
          .remove-btn { background: transparent; border: none; color: var(--mauve-8); padding: 4px; cursor: pointer; display: flex; align-items: center; }
          .remove-btn:hover { color: var(--red-9); }

          /* === Dropdown Styles === */
          .character-select-dropdown {
             position: absolute; bottom: 100%; left: 0; right: 0; margin-bottom: 8px;
             background: var(--mauve-3); border: 1px solid var(--mauve-6); border-radius: 12px;
             padding: 8px 0; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); z-index: 50;
             max-height: 60vh; display: flex; flex-direction: column;
             max-width: 900px;
margin: 0 auto;
          }
          .dropdown-header { padding: 4px 12px; font-size: 11px; text-transform: uppercase; color: var(--mauve-9); font-weight: 600; }
          .dropdown-list { overflow-y: auto; max-height: 200px; padding: 0 8px; }
          .dropdown-divider { height: 1px; background: var(--mauve-5); margin: 6px 0; }
          .character-select-item {
             display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px;
             background: transparent; border: none; border-radius: 8px; color: var(--mauve-12);
             cursor: pointer; text-align: left; font-size: 14px;
          }
          .character-select-item:hover { background: var(--mauve-4); }
          .character-select-avatar { width: 32px; height: 32px; border-radius: 50%; }
          
          .create-new-btn { color: var(--orange-9); font-weight: 500; margin: 0 8px; width: auto; }
          .create-new-btn:hover { background: var(--orange-3); }
          .create-icon-wrapper {
             width: 32px; height: 32px; border-radius: 50%; border: 1px dashed var(--orange-8);
             display: flex; align-items: center; justify-content: center; color: var(--orange-9);
          }
          .empty-state { padding: 12px; text-align: center; color: var(--mauve-9); font-size: 13px; font-style: italic; }
        `}</style>
      </motion.div>
    </>
  );
}