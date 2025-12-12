import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '@/types/character';
import RichTextEditor from '@/components/RichTextEditor';
import { generateScript } from '@/lib/api/apiClient';

// --- Configuration & Types ---

interface ScriptGeneratorModalProps {
    character: Character;
    allCharacters: Character[];
    userTier: 'free' | 'pro' | 'enterprise';
    userCredits: number;
}

const SCRIPT_TEMPLATES = [
    { id: 'custom', name: 'Custom Script', prompt: '', icon: 'lucide:wand-2' },
    { id: 'youtube_ad', name: 'YouTube Ad', prompt: 'Create a compelling YouTube ad script', icon: 'lucide:video' },
    { id: 'podcast_intro', name: 'Podcast Intro', prompt: 'Write an engaging podcast episode introduction', icon: 'lucide:mic' },
    { id: 'product_demo', name: 'Product Demo', prompt: 'Create an exciting product demonstration script', icon: 'lucide:package' },
    { id: 'tutorial', name: 'Tutorial/How-to', prompt: 'Write a clear educational tutorial script', icon: 'lucide:book-open' },
    { id: 'storytelling', name: 'Storytelling', prompt: 'Create a captivating story narration', icon: 'lucide:book' },
    { id: 'sales_pitch', name: 'Sales Pitch', prompt: 'Write a persuasive sales pitch', icon: 'lucide:trending-up' },
    { id: 'interview', name: 'Interview', prompt: 'Generate interview questions and talking points', icon: 'lucide:message-circle' },
    { id: 'comedy', name: 'Comedy Sketch', prompt: 'Write a funny comedy sketch or bit', icon: 'lucide:laugh' },
    { id: 'motivational', name: 'Motivational', prompt: 'Create an inspiring motivational speech', icon: 'lucide:zap' },
];

const TONES = ['Professional', 'Casual', 'Funny', 'Dramatic', 'Empathetic', 'Sarcastic'];
const LENGTHS = ['Short (<30s)', 'Medium (1-2m)', 'Long (3m+)'];

const CHARACTER_LIMITS = { free: 4, pro: 12, enterprise: Infinity };

export default function ScriptGeneratorModal({
    character,
    allCharacters,
    userTier,
    userCredits,
}: ScriptGeneratorModalProps) {
    // --- State ---
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<'single' | 'dialogue'>('single');
    const [template, setTemplate] = useState('custom');

    // Content State
    const [context, setContext] = useState('');
    const [isContextDirty, setIsContextDirty] = useState(false); // Tracks if user manually typed

    // Options
    const [selectedTone, setSelectedTone] = useState(TONES[1]);
    const [selectedLength, setSelectedLength] = useState(LENGTHS[1]);

    // Characters
    const [selectedCharacters, setSelectedCharacters] = useState<Character[]>([character]);

    // Processing State
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedScript, setGeneratedScript] = useState('');
    const [error, setError] = useState('');

    // Menus
    const [showTemplateMenu, setShowTemplateMenu] = useState(false);
    const [showCharacterMenu, setShowCharacterMenu] = useState(false);

    // Refs
    const onGenerateRef = useRef<((script: { mainText: string; additionalInputs?: any[] }) => void) | null>(null);
    const templateMenuRef = useRef<HTMLDivElement>(null);
    const characterMenuRef = useRef<HTMLDivElement>(null);
    const maxCharacters = CHARACTER_LIMITS[userTier];

    // --- Dynamic Template Generator ---
    // This function builds the text based on current inputs
    const getExampleText = useCallback(() => {
        if (template === 'custom') return '';

        const c1 = selectedCharacters[0]?.name || 'Host';
        const c2 = selectedCharacters[1]?.name || 'Guest';

        // Single Mode Examples
        if (mode === 'single') {
            const examples: Record<string, string> = {
                youtube_ad: `Hey everyone! Today I'm excited to share something amazing with you. [Product] has completely changed the way I [problem]. Check the link below!`,
                podcast_intro: `Welcome back to the show! I'm your host, ${c1}, and today we're diving deep into [topic]. Trust me, you won't want to miss this.`,
                product_demo: `Hi, ${c1} here. Watch as I demonstrate how easy it is to use [Product]. First, notice the sleek design...`,
                tutorial: `In this tutorial, I'll teach you how to [skill] step by step. Step 1: Open the settings menu...`,
                storytelling: `It was a Tuesday morning when everything changed. I was walking down the street when suddenly...`,
                sales_pitch: `Are you tired of [problem]? I was too, until I found [Solution]. Here is why it works...`,
                interview: `Today I'm asking the big questions. 1. What inspired you to start? 2. What was your biggest challenge?`,
                comedy: `So I went to the store yesterday, and you won't believe what the cashier said to me...`,
                motivational: `Don't give up. The path to success is paved with failure. You have the strength inside you.`
            };
            return examples[template] || '';
        }

        // Dialogue Mode Examples (Uses Real Names)
        else {
            const examples: Record<string, string> = {
                youtube_ad: `${c1}: Hey ${c2}, have you tried [Product]?\n\n${c2}: No, what is it?\n\n${c1}: It's a game changer for [problem].\n\n${c2}: Wow, I need to check that out!`,
                podcast_intro: `${c1}: Welcome to the podcast! I'm ${c1}.\n\n${c2}: And I'm ${c2}. Today we are talking about [topic].\n\n${c1}: Let's dive right in!`,
                product_demo: `${c1}: ${c2}, watch this. I press this button and...\n\n${c2}: Whoa! That was fast.\n\n${c1}: Exactly! That's the power of [Product].`,
                interview: `${c1}: Thanks for joining me, ${c2}.\n\n${c2}: Thanks for having me, ${c1}.\n\n${c1}: So, tell us about your new project.`,
                comedy: `${c1}: Did you eat my sandwich?\n\n${c2}: I... was protecting it.\n\n${c1}: Protecting it? In your stomach?\n\n${c2}: It was a tactical decision.`,
                storytelling: `${c1}: It was dark...\n\n${c2}: Wait, don't tell the scary part!\n\n${c1}: But that's the best part! So, the door creaked open...`,
                sales_pitch: `${c1}: I think we have a problem with sales.\n\n${c2}: I agree. What's the solution?\n\n${c1}: We need to implement [System]. It scales automatically.`,
                tutorial: `${c1}: Okay ${c2}, click the green button.\n\n${c2}: This one?\n\n${c1}: Yes! See? You're a pro already.`,
                motivational: `${c1}: I don't think I can do this, ${c2}.\n\n${c2}: Yes you can, ${c1}. Remember why you started.`
            };
            return examples[template] || '';
        }
    }, [template, mode, selectedCharacters]);

    // --- Effect: Update Text on Template/Mode/Character Change ---
    useEffect(() => {
        // Only auto-update if the user hasn't typed custom text (isContextDirty is false)
        // OR if the box is empty.
        if (!isContextDirty || context.trim() === '') {
            const newText = getExampleText();
            if (newText) setContext(newText);
        }
    }, [template, mode, selectedCharacters, getExampleText, isContextDirty]);


    // --- Character Management ---
    const handleAddCharacter = useCallback((char: Character) => {
        if (selectedCharacters.length >= maxCharacters) {
            setError(`Limit reached for ${userTier} tier`);
            setTimeout(() => setError(''), 3000);
            return;
        }
        if (!selectedCharacters.find(c => c.id === char.id)) {
            setSelectedCharacters(prev => [...prev, char]);
            // Reset dirty state so template updates with new name
            setIsContextDirty(false);
        }
        setShowCharacterMenu(false);
    }, [selectedCharacters, maxCharacters, userTier]);

    const handleRemoveCharacter = useCallback((charId: string) => {
        if (selectedCharacters.length === 1) return;
        setSelectedCharacters(prev => prev.filter(c => c.id !== charId));
        // Reset dirty state so template updates to remove name
        setIsContextDirty(false);
    }, [selectedCharacters]);


    // --- Standard Modal Logic ---
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setIsOpen(true);
            if (e.detail?.onScriptGenerated) onGenerateRef.current = e.detail.onScriptGenerated;
            if (e.detail?.currentText) {
                setContext(e.detail.currentText);
                setIsContextDirty(true); // Treat passed text as dirty so we don't overwrite it
            }
        };
        window.addEventListener('open-script-generator', handleOpen as EventListener);
        return () => window.removeEventListener('open-script-generator', handleOpen as EventListener);
    }, []);

    const handleContextChange = (newText: string) => {
        setContext(newText);
        // If user types significantly, mark as dirty to stop auto-updates
        if (newText.length > 5 && newText !== getExampleText()) {
            setIsContextDirty(true);
        }
    };

    const handleGenerate = async () => {
        if (!context.trim() && template === 'custom') {
            setError('Please describe what you want');
            return;
        }
        if (userCredits < 1) {
            setError('Insufficient credits.');
            return;
        }

        setIsGenerating(true);
        setError('');

        try {
            const result = await generateScript({
                mode,
                template,
                context, // Send CLEAN context
                characters: selectedCharacters.map(c => ({ id: c.id, name: c.name })),
                tone: selectedTone,
                length: selectedLength,
            });

            setGeneratedScript(result.script);

        } catch (err: any) {
            console.error('Script generation error:', err);
            setError(err.message || 'Failed to generate script');
        } finally {
            setIsGenerating(false);
        }
    };



    const handleUseScript = () => {
        if (!generatedScript || !onGenerateRef.current) return;

        if (mode === 'single') {
            onGenerateRef.current({ mainText: generatedScript });
        } else {
            const lines = generatedScript.split('\n').filter(l => l.trim());
            const dialogueMap = new Map<string, string[]>();
            const dialogueRegex = /^(\*\*?|\[)?(.*?)(?:\*\*?|\]|\))?:\s*(.+)$/;
            let currentSpeakerId = selectedCharacters[0].id;

            lines.forEach(line => {
                const match = line.match(dialogueRegex);
                if (match) {
                    const extractedName = match[2].toLowerCase();
                    const text = match[3];
                    const char = selectedCharacters.find(c =>
                        extractedName.includes(c.name.toLowerCase()) ||
                        c.name.toLowerCase().includes(extractedName)
                    );

                    if (char) {
                        currentSpeakerId = char.id;
                        if (!dialogueMap.has(char.id)) dialogueMap.set(char.id, []);
                        dialogueMap.get(char.id)!.push(text.trim());
                    } else {
                        if (!dialogueMap.has(currentSpeakerId)) dialogueMap.set(currentSpeakerId, []);
                        dialogueMap.get(currentSpeakerId)!.push(line);
                    }
                } else {
                    if (dialogueMap.has(currentSpeakerId)) {
                        dialogueMap.get(currentSpeakerId)!.push(`(${line})`);
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
        handleClose();
    };

    const handleClose = () => {
        setIsOpen(false);
        setGeneratedScript('');
        setError('');
    };

    const selectedTemplate = SCRIPT_TEMPLATES.find(t => t.id === template) || SCRIPT_TEMPLATES[0];
    const availableCharacters = allCharacters.filter(c => !selectedCharacters.find(sc => sc.id === c.id));

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={handleClose}>
                    <motion.div
                        className="modal-content modal-wide"
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="modal-handle-bar"><div className="modal-handle-pill"></div></div>
                        <div className="modal-header">
                            <div className="modal-title-group">
                                <div className="icon-wrapper">
                                    <Icon icon="lucide:sparkles" width={20} />
                                </div>
                                <h3 className="modal-title">AI Script Generator</h3>
                                <div className={`credits-badge ${userCredits < 1 ? 'low-credits' : ''}`}>
                                    <Icon icon="lucide:coins" width={14} />
                                    <span>{userCredits}</span>
                                </div>
                            </div>
                            <button className="modal-close" onClick={handleClose}><Icon icon="lucide:x" width={20} /></button>
                        </div>

                        <div className="modal-body">
                            {!generatedScript ? (
                                <>
                                    {/* Mode Toggle */}
                                    <div className="mode-toggle">
                                        <button className={`mode-btn ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
                                            <Icon icon="lucide:user" width={18} /><span>Single</span>
                                        </button>
                                        <button className={`mode-btn ${mode === 'dialogue' ? 'active' : ''}`} onClick={() => setMode('dialogue')}>
                                            <Icon icon="lucide:users" width={18} /><span>Dialogue</span>
                                        </button>
                                    </div>

                                    {/* Character Selector (Dialogue Mode) */}
                                    <AnimatePresence>
                                        {mode === 'dialogue' && (
                                            <motion.div className="character-selector-section" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                                                <label className="form-label"><Icon icon="lucide:users" width={16} />Characters</label>
                                                <div className="selected-characters">
                                                    {selectedCharacters.map((char, idx) => (
                                                        <motion.div
                                                            key={char.id}
                                                            className="selected-char-avatar"
                                                            style={{ marginLeft: idx > 0 ? '-12px' : 0, zIndex: 10 - idx }}
                                                            initial={{ scale: 0 }}
                                                            animate={{ scale: 1 }}
                                                        >
                                                            <img src={char.avatarUrl} alt={char.name} title={char.name} />
                                                            {/* Fixed: Added e.stopPropagation to ensure click is registered */}
                                                            {selectedCharacters.length > 1 && (
                                                                <button
                                                                    className="remove-char-btn"
                                                                    onClick={(e) => { e.stopPropagation(); handleRemoveCharacter(char.id); }}
                                                                >
                                                                    <Icon icon="lucide:x" width={10} />
                                                                </button>
                                                            )}
                                                        </motion.div>
                                                    ))}

                                                    {selectedCharacters.length < maxCharacters && availableCharacters.length > 0 && (
                                                        <div className="add-char-dropdown">
                                                            <button className="add-char-btn"><Icon icon="lucide:plus" width={18} /></button>
                                                            <div className="add-char-menu">
                                                                {availableCharacters.map(char => (
                                                                    <button key={char.id} className="add-char-item" onClick={() => handleAddCharacter(char)}>
                                                                        <img src={char.avatarUrl} alt={char.name} /><span>{char.name}</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Template Selector */}
                                    <div className="form-group">
                                        <label className="form-label"><Icon icon="lucide:layout-template" width={16} />Script template</label>
                                        <div className="ios-select-wrapper" ref={templateMenuRef}>
                                            <button className="ios-select-button" onClick={() => setShowTemplateMenu(!showTemplateMenu)}>
                                                <div className="ios-select-content">
                                                    <Icon icon={selectedTemplate.icon} width={18} /><span>{selectedTemplate.name}</span>
                                                </div>
                                                <Icon icon="lucide:chevron-down" width={18} className={showTemplateMenu ? 'rotate-180' : ''} />
                                            </button>
                                            <AnimatePresence>
                                                {showTemplateMenu && (
                                                    <motion.div className="ios-select-menu" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                                                        {SCRIPT_TEMPLATES.map((t) => (
                                                            <button key={t.id} className={`ios-select-item ${template === t.id ? 'selected' : ''}`} onClick={() => { setTemplate(t.id); setShowTemplateMenu(false); }}>
                                                                <div className="ios-select-item-content">
                                                                    <Icon icon={t.icon} width={18} />
                                                                    <div className="ios-select-item-text">
                                                                        <span className="item-name">{t.name}</span>
                                                                        {t.prompt && <span className="item-description">{t.prompt}</span>}
                                                                    </div>
                                                                </div>
                                                                {template === t.id && <Icon icon="lucide:check" width={18} className="check-icon" />}
                                                            </button>
                                                        ))}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>

                                    {/* Tone & Length */}
                                    <div className="form-row-split">
                                        <div className="form-group half">
                                            <label className="form-label"><Icon icon="lucide:music" width={16} />Tone</label>
                                            <div className="scrollable-pills">
                                                {TONES.map(t => (
                                                    <button key={t} className={`pill ${selectedTone === t ? 'active' : ''}`} onClick={() => setSelectedTone(t)}>{t}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="form-group half">
                                            <label className="form-label"><Icon icon="lucide:clock" width={16} />Length</label>
                                            <div className="scrollable-pills">
                                                {LENGTHS.map(l => (
                                                    <button key={l} className={`pill ${selectedLength === l ? 'active' : ''}`} onClick={() => setSelectedLength(l)}>{l.split(' ')[0]}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Context Input */}
                                    <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                        <label className="form-label">
                                            <Icon icon="lucide:pen-line" width={16} />
                                            Script Details
                                        </label>
                                        <div className="editor-wrapper">
                                            <RichTextEditor
                                                initialValue={context}
                                                onChange={handleContextChange}
                                                placeholder="Enter your script topic..."
                                            />
                                            {/* Allow user to reset text if they want the template back */}
                                            {isContextDirty && (
                                                <button
                                                    className="clear-text-btn"
                                                    onClick={() => {
                                                        setIsContextDirty(false);
                                                        setContext(getExampleText());
                                                    }}
                                                >
                                                    Reset to Template
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {error && (
                                            <motion.div className="error-banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                                                <Icon icon="lucide:alert-circle" width={18} /><span>{error}</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <button className="btn btn-primary btn-full" onClick={handleGenerate} disabled={isGenerating || userCredits < 1}>
                                        {isGenerating ? (
                                            <>
                                                <Icon icon="lucide:loader-2" width={18} className="spin" />
                                                <span>Generating...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Icon icon="lucide:sparkles" width={18} />
                                                Generate Script
                                                <div className="btn-badge">1 credit</div>
                                            </>
                                        )}
                                    </button>
                                </>
                            ) : (
                                /* --- Generated Preview State --- */
                                <>
                                    <motion.div className="generated-script-preview" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                                        <div className="preview-header">
                                            <div className="success-badge">
                                                <Icon icon="lucide:check-circle" width={20} /><h4>Script Ready</h4>
                                            </div>
                                            <div className="preview-actions">
                                                <span className="word-count">{generatedScript.split(' ').length} words</span>
                                                <button className="copy-btn" onClick={() => navigator.clipboard.writeText(generatedScript)}>
                                                    <Icon icon="lucide:copy" width={16} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="script-content">
                                            {generatedScript.split('\n').map((line, idx) => (
                                                <p key={idx} className={line.includes(':') ? 'dialogue-line' : 'action-line'}>
                                                    {line || '\u00A0'}
                                                </p>
                                            ))}
                                        </div>
                                    </motion.div>
                                    <div className="action-buttons">
                                        <button className="btn btn-secondary" onClick={() => setGeneratedScript('')}><Icon icon="lucide:arrow-left" width={18} />Back</button>
                                        <button className="btn btn-secondary" onClick={handleGenerate}><Icon icon="lucide:refresh-cw" width={18} />Retry</button>
                                        <button className="btn btn-primary" onClick={handleUseScript}><Icon icon="lucide:check" width={18} />Use Script</button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Styles */}
                        <style>{`
                            /* --- Credits Badge --- */
                            .credits-badge { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--orange-3, #fff3e0); border: 1px solid var(--orange-7, #ffb74d); border-radius: 12px; font-size: 13px; font-weight: 600; color: var(--orange-11, #e65100); }
                            .credits-badge.low-credits { background: var(--red-3, #ffebee); border-color: var(--red-7, #ef5350); color: var(--red-11, #c62828); }

                            /* --- Mode Toggle --- */
                            .mode-toggle { display: flex; gap: 4px; padding: 4px; background: var(--mauve-3, #f5f5f5); border-radius: 12px; margin-bottom: 16px; flex-shrink: 0; }
                            .mode-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: transparent; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; color: var(--mauve-11, #666); cursor: pointer; transition: all 0.2s; }
                            .mode-btn.active { background: var(--mauve-1, #fff); color: var(--orange-11, #e65100); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

                            /* --- Form Elements --- */
                            .form-group { margin-bottom: 16px; position: relative; }
                            .form-label { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--mauve-12, #000); margin-bottom: 8px; }
                            .form-row-split { display: flex; gap: 12px; margin-bottom: 16px; }
                            .form-group.half { flex: 1; min-width: 0; }
                            
                            /* --- Tone/Length Pills --- */
                            .scrollable-pills { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; -ms-overflow-style: none; scrollbar-width: none; }
                            .scrollable-pills::-webkit-scrollbar { display: none; }
                            .pill { white-space: nowrap; padding: 6px 12px; border-radius: 16px; border: 1px solid var(--mauve-6, #ddd); background: var(--mauve-1, #fff); color: var(--mauve-11, #666); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
                            .pill:hover { background: var(--mauve-3, #f5f5f5); }
                            .pill.active { background: var(--orange-3, #fff3e0); border-color: var(--orange-9, #ff6b35); color: var(--orange-11, #e65100); }

                            /* --- Rich Text Editor Wrapper --- */
                            .editor-wrapper { position: relative; flex: 1; display: flex; flex-direction: column; }
                            .clear-text-btn { position: absolute; right: 0; top: -32px; font-size: 12px; color: var(--orange-9, #ff6b35); background: none; border: none; cursor: pointer; font-weight: 600; }
                            .clear-text-btn:hover { text-decoration: underline; }

                            /* --- Character Selection --- */
                            .character-selector-section { margin-bottom: 16px; padding: 12px; background: var(--mauve-2, #fafafa); border: 1px solid var(--mauve-5, #e8e8e8); border-radius: 12px; }
                            .selected-characters { display: flex; align-items: center; }
                            .selected-char-avatar { position: relative; width: 48px; height: 48px; border-radius: 50%; border: 3px solid var(--mauve-1, #fff); overflow: visible; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                            .selected-char-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
                            
                            .remove-char-btn { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; background: var(--red-9, #e53935); border: 2px solid white; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 20; }
                            .remove-char-btn:hover { transform: scale(1.1); }

                            .add-char-dropdown { position: relative; margin-left: 8px; }
                            .add-char-btn { width: 48px; height: 48px; border-radius: 50%; background: var(--mauve-4, #f0f0f0); border: 2px dashed var(--mauve-7, #ccc); color: var(--mauve-11, #666); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
                            .add-char-btn:hover { border-color: var(--orange-9, #ff6b35); color: var(--orange-9, #ff6b35); background: var(--orange-2, #fff3e0); }
                            .add-char-menu { position: absolute; top: 100%; left: 0; background: white; border: 1px solid var(--mauve-6, #ddd); border-radius: 12px; padding: 4px; min-width: 200px; z-index: 10; box-shadow: 0 5px 20px rgba(0,0,0,0.15); margin-top: 8px; }
                            .add-char-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; background: transparent; border: none; border-radius: 8px; cursor: pointer; text-align: left; }
                            .add-char-item:hover { background: var(--mauve-3, #f5f5f5); }
                            .add-char-item img { width: 32px; height: 32px; border-radius: 50%; }

                            /* --- Preview & Actions --- */
                            .generated-script-preview { flex: 1; display: flex; flex-direction: column; overflow: hidden; margin-bottom: 16px; }
                            .preview-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
                            .success-badge { display: flex; align-items: center; gap: 6px; color: var(--green-11, #2e7d32); }
                            .success-badge h4 { font-size: 16px; font-weight: 600; margin: 0; }
                            .preview-actions { display: flex; align-items: center; gap: 12px; }
                            .word-count { font-size: 12px; color: var(--mauve-10, #999); }
                            .copy-btn { width: 32px; height: 32px; border-radius: 6px; background: var(--mauve-3, #f5f5f5); border: 1px solid var(--mauve-6, #ddd); color: var(--mauve-11, #666); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
                            .copy-btn:hover { color: var(--mauve-12, #000); border-color: var(--mauve-8, #bbb); }
                            
                            .script-content { flex: 1; background: var(--mauve-2, #fafafa); border: 1px solid var(--mauve-5, #e8e8e8); border-radius: 12px; padding: 16px; overflow-y: auto; font-family: 'Courier New', Courier, monospace; }
                            .script-content p { margin: 8px 0; line-height: 1.5; font-size: 14px; }
                            .dialogue-line { color: var(--mauve-12, #000); }
                            .action-line { color: var(--mauve-11, #666); font-style: italic; }

                            .action-buttons { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; margin-top: auto; }
                            .btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; transition: all 0.2s; border: none; }
                            .btn-primary { background: linear-gradient(135deg, var(--orange-9, #ff6b35) 0%, var(--orange-10, #ff5722) 100%); color: white; box-shadow: 0 4px 12px rgba(255, 107, 53, 0.25); }
                            .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255, 107, 53, 0.35); }
                            .btn-secondary { background: var(--mauve-3, #f5f5f5); color: var(--mauve-12, #000); border: 1px solid var(--mauve-6, #ddd); }
                            .btn-secondary:hover { background: var(--mauve-4, #f0f0f0); border-color: var(--mauve-8, #bbb); }
                            .btn:disabled { opacity: 0.6; cursor: not-allowed; }
                            .btn-badge { padding: 2px 6px; background: rgba(255,255,255,0.2); border-radius: 4px; font-size: 11px; }
                            .btn-full { width: 100%; }
                            
                            .spin { animation: spin 1s linear infinite; }
                            @keyframes spin { 100% { transform: rotate(360deg); } }
                            
                            .error-banner { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--red-3, #ffebee); border: 1px solid var(--red-7, #ef5350); border-radius: 8px; color: var(--red-11, #c62828); margin-bottom: 16px; font-size: 13px; }
                        `}</style>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}