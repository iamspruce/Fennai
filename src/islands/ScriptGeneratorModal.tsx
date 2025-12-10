import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { motion } from 'framer-motion';
import type { Character } from '@/types/character';
import RichTextEditor from '@/components/RichTextEditor';

interface ScriptGeneratorModalProps {
    character: Character;
    allCharacters: Character[];
    userTier: 'free' | 'pro' | 'enterprise';
    userCredits: number;
    // Removed onScriptGenerated from here as it comes from the event
}

const SCRIPT_TEMPLATES = [
    { id: 'custom', name: 'Describe what you want', prompt: '' },
    { id: 'youtube_ad', name: 'YouTube Ad (30s)', prompt: 'Create a compelling 30-second YouTube ad script' },
    { id: 'podcast_intro', name: 'Podcast Introduction', prompt: 'Write an engaging podcast episode introduction' },
    { id: 'product_demo', name: 'Product Demo', prompt: 'Create an exciting product demonstration script' },
    { id: 'tutorial', name: 'Tutorial/How-to', prompt: 'Write a clear educational tutorial script' },
    { id: 'storytelling', name: 'Storytelling Narration', prompt: 'Create a captivating story narration' },
    { id: 'sales_pitch', name: 'Sales Pitch', prompt: 'Write a persuasive sales pitch' },
    { id: 'announcement', name: 'Announcement', prompt: 'Create an important announcement script' },
    { id: 'interview', name: 'Interview Questions', prompt: 'Generate interview questions and talking points' },
    { id: 'comedy', name: 'Comedy Sketch', prompt: 'Write a funny comedy sketch or bit' },
    { id: 'motivational', name: 'Motivational Speech', prompt: 'Create an inspiring motivational speech' },
];

const CHARACTER_LIMITS = {
    free: 4,
    pro: 12,
    enterprise: Infinity,
};

export default function ScriptGeneratorModal({
    character,
    allCharacters,
    userTier,
    userCredits,
}: ScriptGeneratorModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<'single' | 'dialogue'>('single');
    const [template, setTemplate] = useState('custom');
    const [context, setContext] = useState('');
    const [selectedCharacters, setSelectedCharacters] = useState<Character[]>([character]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedScript, setGeneratedScript] = useState('');
    const [error, setError] = useState('');

    // Ref to store the callback function from the event
    const onGenerateRef = useRef<((script: { mainText: string; additionalInputs?: any[] }) => void) | null>(null);

    const maxCharacters = CHARACTER_LIMITS[userTier];

    // Event listener
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setIsOpen(true);

            // Capture the callback function passed from VoiceInputSection
            if (e.detail?.onScriptGenerated) {
                onGenerateRef.current = e.detail.onScriptGenerated;
            }

            // If user already typed text, use it as context
            if (e.detail?.currentText) {
                setContext(e.detail.currentText);
            }

            loadDraftFromStorage();
        };

        window.addEventListener('open-script-generator', handleOpen as EventListener);
        return () => window.removeEventListener('open-script-generator', handleOpen as EventListener);
    }, []);

    // LocalStorage persistence
    const saveDraftToStorage = () => {
        const draft = { mode, template, context, characterIds: selectedCharacters.map(c => c.id) };
        localStorage.setItem(`fennai_draft_script_${character.id}`, JSON.stringify(draft));
    };

    const loadDraftFromStorage = () => {
        const saved = localStorage.getItem(`fennai_draft_script_${character.id}`);
        if (saved) {
            try {
                const draft = JSON.parse(saved);
                setMode(draft.mode || 'single');
                setTemplate(draft.template || 'custom');
                // Only overwrite context if it's empty (prioritize passed text)
                if (!context) setContext(draft.context || '');

                if (draft.characterIds) {
                    const chars = draft.characterIds
                        .map((id: string) => allCharacters.find(c => c.id === id))
                        .filter(Boolean);
                    if (chars.length > 0) setSelectedCharacters(chars);
                }
            } catch (e) {
                console.error('Failed to load draft:', e);
            }
        }
    };

    useEffect(() => {
        if (isOpen) saveDraftToStorage();
    }, [mode, template, context, selectedCharacters]);

    const handleAddCharacter = (char: Character) => {
        if (selectedCharacters.length >= maxCharacters) {
            alert(`Maximum ${maxCharacters} characters allowed for ${userTier} tier`);
            return;
        }
        if (!selectedCharacters.find(c => c.id === char.id)) {
            setSelectedCharacters([...selectedCharacters, char]);
        }
    };

    const handleRemoveCharacter = (charId: string) => {
        if (selectedCharacters.length === 1) return;
        setSelectedCharacters(selectedCharacters.filter(c => c.id !== charId));
    };

    const handleGenerate = async () => {
        if (!context.trim() && template === 'custom') {
            setError('Please describe what you want');
            return;
        }

        if (userCredits < 1) {
            setError('Insufficient credits. Script generation costs 1 credit.');
            return;
        }

        setIsGenerating(true);
        setError('');

        try {
            const response = await fetch('/api/proxy/generate-script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    template,
                    context: context.trim(),
                    characters: selectedCharacters.map(c => ({
                        id: c.id,
                        name: c.name,
                    })),
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Script generation failed');
            }

            const data = await response.json();
            setGeneratedScript(data.script);
        } catch (err: any) {
            setError(err.message || 'Failed to generate script');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegenerate = () => {
        setGeneratedScript('');
        handleGenerate();
    };

    const handleUseScript = () => {
        if (!generatedScript || !onGenerateRef.current) return;

        if (mode === 'single') {
            onGenerateRef.current({ mainText: generatedScript });
        } else {
            // Parse dialogue script
            const lines = generatedScript.split('\n').filter(l => l.trim());
            const dialogueMap = new Map<string, string[]>();

            lines.forEach(line => {
                const match = line.match(/^(.+?):\s*(.+)$/);
                if (match) {
                    const [, charName, text] = match;
                    const char = selectedCharacters.find(c =>
                        c.name.toLowerCase().includes(charName.toLowerCase())
                    );
                    if (char) {
                        if (!dialogueMap.has(char.id)) dialogueMap.set(char.id, []);
                        dialogueMap.get(char.id)!.push(text.trim());
                    }
                }
            });

            const mainChar = selectedCharacters[0];
            const mainText = dialogueMap.get(mainChar.id)?.join(' ') || '';
            const additionalInputs = selectedCharacters.slice(1).map((char, idx) => ({
                id: `input_${Date.now()}_${idx}`,
                characterId: char.id,
                character: char,
                text: dialogueMap.get(char.id)?.join(' ') || '',
            }));

            onGenerateRef.current({ mainText, additionalInputs });
        }

        // Clear storage and close
        localStorage.removeItem(`fennai_draft_script_${character.id}`);
        setIsOpen(false);
    };

    const handleClose = () => {
        setIsOpen(false);
        setGeneratedScript('');
        setError('');
    };

    if (!isOpen) return null;

    const availableCharacters = allCharacters.filter(
        c => !selectedCharacters.find(sc => sc.id === c.id)
    );

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-wide">
                <div className="modal-handle-bar">
                    <div className="modal-handle-pill"></div>
                </div>

                <div className="modal-header">
                    <div className="modal-title-group">
                        <Icon icon="lucide:sparkles" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
                        <h3 className="modal-title">AI Script Generator</h3>
                    </div>
                    <button className="modal-close" onClick={handleClose}>
                        <Icon icon="lucide:x" width={20} height={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {!generatedScript ? (
                        <>
                            {/* Mode Toggle */}
                            <div className="mode-toggle">
                                <button
                                    className={`mode-btn ${mode === 'single' ? 'active' : ''}`}
                                    onClick={() => setMode('single')}
                                >
                                    <Icon icon="lucide:user" width={18} />
                                    Single Character
                                </button>
                                <button
                                    className={`mode-btn ${mode === 'dialogue' ? 'active' : ''}`}
                                    onClick={() => setMode('dialogue')}
                                >
                                    <Icon icon="lucide:users" width={18} />
                                    Dialogue
                                </button>
                            </div>

                            {/* Character Selector (Dialogue Mode) */}
                            {mode === 'dialogue' && (
                                <div className="character-selector-section">
                                    <label className="form-label">Characters in dialogue</label>
                                    <div className="selected-characters">
                                        {selectedCharacters.map((char, idx) => (
                                            <motion.div
                                                key={char.id}
                                                className="selected-char-avatar"
                                                style={{ marginLeft: idx > 0 ? '-12px' : 0, zIndex: selectedCharacters.length - idx }}
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                            >
                                                <img src={char.avatarUrl} alt={char.name} />
                                                {selectedCharacters.length > 1 && (
                                                    <button
                                                        className="remove-char-btn"
                                                        onClick={() => handleRemoveCharacter(char.id)}
                                                    >
                                                        <Icon icon="lucide:x" width={12} />
                                                    </button>
                                                )}
                                            </motion.div>
                                        ))}
                                        {selectedCharacters.length < maxCharacters && availableCharacters.length > 0 && (
                                            <div className="add-char-dropdown">
                                                <button className="add-char-btn">
                                                    <Icon icon="lucide:plus" width={18} />
                                                </button>
                                                <div className="add-char-menu">
                                                    {availableCharacters.map(char => (
                                                        <button
                                                            key={char.id}
                                                            className="add-char-item"
                                                            onClick={() => handleAddCharacter(char)}
                                                        >
                                                            <img src={char.avatarUrl} alt={char.name} />
                                                            <span>{char.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <p className="char-limit-hint">
                                        {selectedCharacters.length} / {maxCharacters === Infinity ? '∞' : maxCharacters} characters
                                    </p>
                                </div>
                            )}

                            {/* Template Selector */}
                            <div className="form-group">
                                <label className="form-label">Pick a template</label>
                                <select
                                    value={template}
                                    onChange={(e) => setTemplate(e.target.value)}
                                    className="form-select"
                                >
                                    {SCRIPT_TEMPLATES.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Context Input */}
                            <div className="form-group">
                                <label className="form-label">
                                    {template === 'custom' ? 'Describe what you want' : 'Additional context (optional)'}
                                </label>
                                <RichTextEditor
                                    initialValue={context}
                                    onChange={setContext}
                                    placeholder={
                                        template === 'custom'
                                            ? 'E.g., "A fun introduction to my gaming channel where I review indie games"'
                                            : 'Add any specific details, tone, or requirements...'
                                    }
                                />
                            </div>

                            {error && (
                                <div className="error-banner">
                                    <Icon icon="lucide:alert-circle" width={18} />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Generate Button */}
                            <button
                                className="btn btn-primary btn-full"
                                onClick={handleGenerate}
                                disabled={isGenerating || userCredits < 1}
                            >
                                {isGenerating ? (
                                    <>
                                        <Icon icon="lucide:loader-2" width={18} className="spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Icon icon="lucide:sparkles" width={18} />
                                        Generate Script (1 credit)
                                    </>
                                )}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Generated Script Preview */}
                            <div className="generated-script-preview">
                                <div className="preview-header">
                                    <Icon icon="lucide:check-circle" width={20} style={{ color: 'var(--green-9)' }} />
                                    <h4>Generated Script</h4>
                                </div>
                                <div className="script-content">
                                    {generatedScript.split('\n').map((line, idx) => (
                                        <p key={idx}>{line}</p>
                                    ))}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="action-buttons">
                                <button className="btn btn-secondary" onClick={handleRegenerate}>
                                    <Icon icon="lucide:refresh-cw" width={18} />
                                    Regenerate
                                </button>
                                <button className="btn btn-primary" onClick={handleUseScript}>
                                    <Icon icon="lucide:check" width={18} />
                                    Use This Script
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <style>{`
          .mode-toggle {
            display: flex;
            gap: var(--space-2xs);
            padding: 4px;
            background: var(--mauve-3);
            border-radius: var(--radius-m);
            margin-bottom: var(--space-m);
          }

          .mode-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2xs);
            padding: var(--space-xs) var(--space-s);
            background: transparent;
            border: none;
            border-radius: var(--radius-s);
            font-weight: 500;
            color: var(--mauve-11);
            cursor: pointer;
            transition: all 0.2s;
          }

          .mode-btn.active {
            background: var(--mauve-1);
            color: var(--mauve-12);
            box-shadow: var(--shadow-box-s);
          }

          .character-selector-section {
            margin-bottom: var(--space-m);
          }

          .selected-characters {
            display: flex;
            align-items: center;
            margin: var(--space-xs) 0;
          }

          .selected-char-avatar {
            position: relative;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: 3px solid var(--mauve-1);
            overflow: hidden;
          }

          .selected-char-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .remove-char-btn {
            position: absolute;
            top: -4px;
            right: -4px;
            width: 20px;
            height: 20px;
            background: var(--red-9);
            border: 2px solid var(--mauve-1);
            border-radius: 50%;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
          }

          .add-char-dropdown {
            position: relative;
            margin-left: 8px;
          }

          .add-char-btn {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: var(--mauve-4);
            border: 2px dashed var(--mauve-7);
            color: var(--mauve-11);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
          }

          .add-char-btn:hover {
            background: var(--mauve-5);
            border-color: var(--mauve-9);
          }

          .add-char-menu {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: var(--space-xs);
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            padding: var(--space-2xs);
            min-width: 200px;
            z-index: 10;
            box-shadow: var(--shadow-box-l);
          }

          .add-char-dropdown:hover .add-char-menu {
            display: block;
          }

          .add-char-item {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            width: 100%;
            padding: var(--space-2xs);
            background: transparent;
            border: none;
            border-radius: var(--radius-s);
            cursor: pointer;
            transition: background 0.2s;
          }

          .add-char-item:hover {
            background: var(--mauve-4);
          }

          .add-char-item img {
            width: 32px;
            height: 32px;
            border-radius: 50%;
          }

          .char-limit-hint {
            font-size: 13px;
            color: var(--mauve-11);
            margin-top: var(--space-2xs);
          }

          .form-group {
            margin-bottom: var(--space-m);
          }

          .form-label {
            display: block;
            font-size: 14px;
            font-weight: 600;
            color: var(--mauve-12);
            margin-bottom: var(--space-2xs);
          }

          .form-select {
            width: 100%;
            padding: var(--space-xs) var(--space-s);
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            color: var(--mauve-12);
            font-size: 14px;
            cursor: pointer;
          }

          .error-banner {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            padding: var(--space-s);
            background: var(--red-3);
            border: 1px solid var(--red-7);
            border-radius: var(--radius-m);
            color: var(--red-11);
            margin-bottom: var(--space-m);
          }

          .generated-script-preview {
            margin-bottom: var(--space-m);
          }

          .preview-header {
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            margin-bottom: var(--space-s);
          }

          .preview-header h4 {
            font-size: var(--step-0);
            font-weight: 600;
            color: var(--mauve-12);
            margin: 0;
          }

          .script-content {
            background: var(--mauve-2);
            border: 1px solid var(--mauve-6);
            border-radius: var(--radius-m);
            padding: var(--space-m);
            max-height: 400px;
            overflow-y: auto;
          }

          .script-content p {
            margin: var(--space-xs) 0;
            line-height: 1.6;
            color: var(--mauve-12);
          }

          .action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-xs);
          }

          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-xs);
            padding: var(--space-s);
            border-radius: var(--radius-m);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
          }

          .btn-primary {
            background: var(--orange-9);
            color: white;
          }

          .btn-primary:hover:not(:disabled) {
            background: var(--orange-10);
          }

          .btn-secondary {
            background: var(--mauve-3);
            color: var(--mauve-12);
            border: 1px solid var(--mauve-6);
          }

          .btn-secondary:hover {
            background: var(--mauve-4);
          }

          .btn-full {
            width: 100%;
          }

          .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .spin {
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
            </div>
        </div>
    );
}