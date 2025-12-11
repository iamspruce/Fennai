import { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Character } from '@/types/character';
import RichTextEditor from '@/components/RichTextEditor';

interface ScriptGeneratorModalProps {
    character: Character;
    allCharacters: Character[];
    userTier: 'free' | 'pro' | 'enterprise';
    userCredits: number;
}

const SCRIPT_TEMPLATES = [
    { id: 'custom', name: 'Custom Script', prompt: '', icon: 'lucide:wand-2' },
    { id: 'youtube_ad', name: 'YouTube Ad (30s)', prompt: 'Create a compelling 30-second YouTube ad script', icon: 'lucide:video' },
    { id: 'podcast_intro', name: 'Podcast Introduction', prompt: 'Write an engaging podcast episode introduction', icon: 'lucide:mic' },
    { id: 'product_demo', name: 'Product Demo', prompt: 'Create an exciting product demonstration script', icon: 'lucide:package' },
    { id: 'tutorial', name: 'Tutorial/How-to', prompt: 'Write a clear educational tutorial script', icon: 'lucide:book-open' },
    { id: 'storytelling', name: 'Storytelling Narration', prompt: 'Create a captivating story narration', icon: 'lucide:book' },
    { id: 'sales_pitch', name: 'Sales Pitch', prompt: 'Write a persuasive sales pitch', icon: 'lucide:trending-up' },
    { id: 'announcement', name: 'Announcement', prompt: 'Create an important announcement script', icon: 'lucide:megaphone' },
    { id: 'interview', name: 'Interview Questions', prompt: 'Generate interview questions and talking points', icon: 'lucide:message-circle' },
    { id: 'comedy', name: 'Comedy Sketch', prompt: 'Write a funny comedy sketch or bit', icon: 'lucide:laugh' },
    { id: 'motivational', name: 'Motivational Speech', prompt: 'Create an inspiring motivational speech', icon: 'lucide:zap' },
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
    const [showTemplateMenu, setShowTemplateMenu] = useState(false);
    const [showCharacterMenu, setShowCharacterMenu] = useState(false);

    const onGenerateRef = useRef<((script: { mainText: string; additionalInputs?: any[] }) => void) | null>(null);
    const templateMenuRef = useRef<HTMLDivElement>(null);
    const characterMenuRef = useRef<HTMLDivElement>(null);
    const maxCharacters = CHARACTER_LIMITS[userTier];

    // Close menus when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
                setShowTemplateMenu(false);
            }
            if (characterMenuRef.current && !characterMenuRef.current.contains(event.target as Node)) {
                setShowCharacterMenu(false);
            }
        };

        if (showTemplateMenu || showCharacterMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showTemplateMenu, showCharacterMenu]);

    // Event listener
    useEffect(() => {
        const handleOpen = (e: CustomEvent) => {
            setIsOpen(true);

            if (e.detail?.onScriptGenerated) {
                onGenerateRef.current = e.detail.onScriptGenerated;
            }

            if (e.detail?.currentText) {
                setContext(e.detail.currentText);
            }

            loadDraftFromStorage();
        };

        window.addEventListener('open-script-generator', handleOpen as EventListener);
        return () => window.removeEventListener('open-script-generator', handleOpen as EventListener);
    }, []);

    // LocalStorage persistence
    const saveDraftToStorage = useCallback(() => {
        const draft = {
            mode,
            template,
            context,
            characterIds: selectedCharacters.map(c => c.id),
            timestamp: Date.now()
        };
        try {
            localStorage.setItem(`fennai_draft_script_${character.id}`, JSON.stringify(draft));
        } catch (e) {
            console.error('Failed to save draft:', e);
        }
    }, [mode, template, context, selectedCharacters, character.id]);

    const loadDraftFromStorage = () => {
        const saved = localStorage.getItem(`fennai_draft_script_${character.id}`);
        if (saved) {
            try {
                const draft = JSON.parse(saved);

                // Only load draft if it's less than 24 hours old
                const hoursSinceSave = (Date.now() - (draft.timestamp || 0)) / (1000 * 60 * 60);
                if (hoursSinceSave > 24) {
                    localStorage.removeItem(`fennai_draft_script_${character.id}`);
                    return;
                }

                setMode(draft.mode || 'single');
                setTemplate(draft.template || 'custom');
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
        if (isOpen) {
            const timeoutId = setTimeout(saveDraftToStorage, 500);
            return () => clearTimeout(timeoutId);
        }
    }, [isOpen, saveDraftToStorage]);

    const handleAddCharacter = useCallback((char: Character) => {
        if (selectedCharacters.length >= maxCharacters) {
            setError(`Maximum ${maxCharacters} characters allowed for ${userTier} tier`);
            setTimeout(() => setError(''), 3000);
            return;
        }
        if (!selectedCharacters.find(c => c.id === char.id)) {
            setSelectedCharacters([...selectedCharacters, char]);
        }
        setShowCharacterMenu(false);
    }, [selectedCharacters, maxCharacters, userTier]);

    const handleRemoveCharacter = useCallback((charId: string) => {
        if (selectedCharacters.length === 1) return;
        setSelectedCharacters(selectedCharacters.filter(c => c.id !== charId));
    }, [selectedCharacters]);

    // Generate example text based on template and characters
    const getExampleText = useCallback(() => {
        const selectedTemplate = SCRIPT_TEMPLATES.find(t => t.id === template);
        if (!selectedTemplate || template === 'custom') return '';

        if (mode === 'single') {
            // Single character examples
            const examples: Record<string, string> = {
                youtube_ad: `Hey everyone! Today I'm excited to share something amazing with you.\n\n[Your product/service] has completely changed the way I [solve problem]. In just 30 seconds, let me show you why thousands of people are already loving it.\n\nWhat makes it special? [Key benefit 1], [Key benefit 2], and best of all, [Key benefit 3].\n\nReady to try it yourself? Check the link in the description and use code AWESOME for 20% off. Don't wait – this offer ends soon!\n\nThanks for watching, and I'll see you in the next video!`,
                podcast_intro: `Welcome back to [Podcast Name]! I'm your host, ${selectedCharacters[0].name}, and today we have an incredible episode lined up for you.\n\nWe're diving deep into [topic], and trust me, you won't want to miss this. Whether you're [target audience description], this episode has something valuable for everyone.\n\nBefore we jump in, a quick thank you to our sponsors [Sponsor name] – making this podcast possible.\n\nAlright, let's get started!`,
                product_demo: `Hi there! ${selectedCharacters[0].name} here, and I'm thrilled to walk you through [Product Name].\n\nLet me show you how easy it is to [main function]. First, you'll notice [feature 1]. Then, with just one click, you can [feature 2].\n\nBut here's where it gets really exciting – [unique selling point]. No other product does this quite like we do.\n\nWatch as I [demonstrate key feature]. See how simple that was? And you can do this too!\n\nReady to get started? Let's make it happen!`,
                tutorial: `Hello everyone! In this tutorial, I'll teach you how to [skill/topic] step by step.\n\nBy the end of this guide, you'll be able to [desired outcome]. Don't worry if you're a complete beginner – I'll explain everything clearly.\n\nStep 1: [First step description]\nStep 2: [Second step description]\nStep 3: [Third step description]\n\nLet's take it one step at a time, and remember – practice makes perfect!`,
                storytelling: `Imagine this: [Setting the scene with vivid details].\n\nThis is where our story begins. [Character name] had no idea that this ordinary day would change everything.\n\nAs [he/she/they] walked through [location], something caught [his/her/their] attention. [Describe the inciting incident].\n\nWhat happened next? Well, that's where things get interesting...`,
                sales_pitch: `Let me ask you something – are you tired of [pain point]?\n\nI used to struggle with this too, until I discovered [solution]. And now, I want to share it with you.\n\nHere's what makes [product/service] different: [Benefit 1], [Benefit 2], and [Benefit 3]. Real results that you can see immediately.\n\nDon't just take my word for it – [social proof or testimonial reference].\n\nReady to transform your [area of life]? Let's make it happen today.`,
                announcement: `Attention everyone! I have some exciting news to share with you.\n\n[Main announcement – be clear and direct about what's happening].\n\nThis means [explain the impact or what this means for your audience].\n\nHere's what you need to know: [Key detail 1], [Key detail 2], and [Key detail 3].\n\nWe're thrilled about this development and can't wait to see [positive outcome]. Stay tuned for more updates!`,
                interview: `Today, we're exploring [topic] with some thought-provoking questions.\n\nQuestion 1: What inspired you to [relevant topic]?\n\nQuestion 2: Can you walk us through your process when [specific scenario]?\n\nQuestion 3: What's the biggest challenge you've faced, and how did you overcome it?\n\nQuestion 4: What advice would you give to someone just starting out?\n\nQuestion 5: Where do you see [industry/field] heading in the next few years?`,
                comedy: `So, let me tell you what happened to me the other day... [Set up the scenario]\n\n[Character does something relatable but funny]\n\nAnd I'm standing there thinking, "Really? This is my life now?"\n\n[Build to the punchline with exaggeration]\n\nI mean, who does that?! [Final joke or callback]\n\nBut seriously folks, [wrap up with a relatable observation].`,
                motivational: `Look, I know things are tough right now. We all face moments when we want to give up.\n\nBut here's what I want you to remember: [Core message of resilience].\n\nEvery person who achieved greatness faced the same doubts you're facing. The difference? They kept going.\n\nYou have everything you need inside you right now. [Specific encouragement related to audience].\n\nSo today, I'm challenging you to [specific action]. Take that first step. Believe in yourself.\n\nBecause your future self is counting on the decision you make right now. Let's do this!`
            };
            return examples[template] || '';
        } else {
            // Dialogue examples with character names
            const char1 = selectedCharacters[0]?.name || 'Character 1';
            const char2 = selectedCharacters[1]?.name || 'Character 2';
            const char3 = selectedCharacters[2]?.name || 'Character 3';

            const dialogueExamples: Record<string, string> = {
                youtube_ad: `${char1}: Hey ${char2}, have you heard about [Product Name]?\n\n${char2}: No, what is it?\n\n${char1}: It's this amazing [product category] that helps you [key benefit]. I've been using it for a week and I'm obsessed!\n\n${char2}: Really? What makes it so special?\n\n${char1}: Well, [feature 1], [feature 2], and it's super affordable. Use code SAVE20 for a discount!\n\n${char2}: I'm checking it out right now. Thanks for sharing!`,
                podcast_intro: `${char1}: Welcome everyone to another episode of [Podcast Name]! I'm ${char1}.\n\n${char2}: And I'm ${char2}! Today we're talking about [topic], and we've got so much to cover.\n\n${char1}: This is going to be good. ${char2}, want to kick us off?\n\n${char2}: Absolutely! So here's what's fascinating about [topic]...`,
                product_demo: `${char1}: Alright ${char2}, I'm going to show you something that'll blow your mind.\n\n${char2}: I'm ready! What is it?\n\n${char1}: Watch this. [Demonstrates feature]. See how easy that was?\n\n${char2}: Wow, that's incredible! Can it also [question about functionality]?\n\n${char1}: Great question! Yes, it can. Let me show you...`,
                interview: `${char1}: Thanks for joining us today! Let's dive right in.\n\n${char2}: Happy to be here!\n\n${char1}: First question – what got you started in [field]?\n\n${char2}: Well, it all began when [backstory]. I realized that [key insight].\n\n${char1}: That's fascinating. And how did you overcome [challenge]?\n\n${char2}: It wasn't easy, but [solution and lesson learned].`,
                comedy: `${char1}: So I went to the store yesterday...\n\n${char2}: Oh no, what happened?\n\n${char1}: I asked for [specific item], and the guy looks at me like I'm speaking another language!\n\n${char2}: Classic! Did you get it though?\n\n${char1}: After pointing at it for five minutes, yes! ${char2}, am I the problem?\n\n${char2}: Maybe just a little bit!`,
                storytelling: `${char1}: It was a dark and stormy night...\n\n${char2}: Oh, here we go again with the clichés!\n\n${char1}: Shh, let me tell the story! Anyway, ${char3} and I were walking through the forest when...\n\n${char3}: When we heard something rustling in the bushes!\n\n${char2}: This better not be another "it was just a squirrel" story.\n\n${char1}: Just wait for it...`,
                sales_pitch: `${char1}: ${char2}, I found the solution to our [problem]!\n\n${char2}: Really? Tell me more.\n\n${char1}: It's called [Product], and it delivers [key benefits].\n\n${char2}: How much does it cost?\n\n${char1}: That's the best part – it's only [price], and it comes with [bonus/guarantee].\n\n${char2}: I'm interested. Where do I sign up?`,
                announcement: `${char1}: Everyone, we have a major announcement!\n\n${char2}: This is big news, ${char1}. Should we tell them?\n\n${char1}: Yes! We're excited to announce [announcement].\n\n${char2}: This means [impact], and we couldn't be more thrilled!\n\n${char1}: We'll be sharing more details soon. Stay tuned!`,
                tutorial: `${char1}: Today, I'm teaching ${char2} how to [skill].\n\n${char2}: I've always wanted to learn this!\n\n${char1}: Great! First, you need to [step 1]. ${char2}, give it a try.\n\n${char2}: Like this?\n\n${char1}: Perfect! Now, [step 2]. See how it all comes together?\n\n${char2}: This is easier than I thought!`,
                motivational: `${char1}: ${char2}, I know you're going through a tough time.\n\n${char2}: Yeah, I'm struggling to stay motivated.\n\n${char1}: Listen, everyone faces moments like this. But you're stronger than you think.\n\n${char2}: You really believe that?\n\n${char1}: Absolutely. Remember when you [past achievement]? You did that! You can do this too.\n\n${char2}: Thanks, ${char1}. I needed to hear that.`
            };
            return dialogueExamples[template] || '';
        }
    }, [template, mode, selectedCharacters]);

    // Update context when template or mode changes
    useEffect(() => {
        if (template !== 'custom') {
            const example = getExampleText();
            setContext(example);
        }
    }, [template, mode, selectedCharacters, getExampleText]);

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

        localStorage.removeItem(`fennai_draft_script_${character.id}`);
        setIsOpen(false);
        setGeneratedScript('');
        setContext('');
        setError('');
    };

    const handleClose = () => {
        setIsOpen(false);
        setGeneratedScript('');
        setError('');
    };

    const selectedTemplate = SCRIPT_TEMPLATES.find(t => t.id === template) || SCRIPT_TEMPLATES[0];
    const availableCharacters = allCharacters.filter(
        c => !selectedCharacters.find(sc => sc.id === c.id)
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="modal-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleClose}
                >
                    <motion.div
                        className="modal-content modal-wide"
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-handle-bar">
                            <div className="modal-handle-pill"></div>
                        </div>

                        <div className="modal-header">
                            <div className="modal-title-group">
                                <div className="icon-wrapper">
                                    <Icon icon="lucide:sparkles" width={20} height={20} />
                                </div>
                                <h3 className="modal-title">AI Script Generator</h3>
                                <div className="credits-badge">
                                    <Icon icon="lucide:coins" width={14} />
                                    <span>{userCredits}</span>
                                </div>
                            </div>
                            <button className="modal-close" onClick={handleClose} aria-label="Close modal">
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
                                            <span>Single</span>
                                        </button>
                                        <button
                                            className={`mode-btn ${mode === 'dialogue' ? 'active' : ''}`}
                                            onClick={() => setMode('dialogue')}
                                        >
                                            <Icon icon="lucide:users" width={18} />
                                            <span>Dialogue</span>
                                        </button>
                                    </div>

                                    {/* Character Selector (Dialogue Mode) */}
                                    <AnimatePresence>
                                        {mode === 'dialogue' && (
                                            <motion.div
                                                className="character-selector-section"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                            >
                                                <label className="form-label">
                                                    <Icon icon="lucide:users" width={16} />
                                                    Characters in dialogue
                                                </label>
                                                <div className="selected-characters">
                                                    {selectedCharacters.map((char, idx) => (
                                                        <motion.div
                                                            key={char.id}
                                                            className="selected-char-avatar"
                                                            style={{ marginLeft: idx > 0 ? '-12px' : 0, zIndex: selectedCharacters.length - idx }}
                                                            initial={{ scale: 0, x: -20 }}
                                                            animate={{ scale: 1, x: 0 }}
                                                            exit={{ scale: 0, x: -20 }}
                                                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                                        >
                                                            <img src={char.avatarUrl} alt={char.name} />
                                                            <div className="char-name-tooltip">{char.name}</div>
                                                            {selectedCharacters.length > 1 && (
                                                                <button
                                                                    className="remove-char-btn"
                                                                    onClick={() => handleRemoveCharacter(char.id)}
                                                                    aria-label={`Remove ${char.name}`}
                                                                >
                                                                    <Icon icon="lucide:x" width={12} />
                                                                </button>
                                                            )}
                                                        </motion.div>
                                                    ))}
                                                    {selectedCharacters.length < maxCharacters && availableCharacters.length > 0 && (
                                                        <div className="add-char-dropdown">
                                                            <button className="add-char-btn" aria-label="Add character">
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
                                                    <Icon icon="lucide:info" width={14} />
                                                    {selectedCharacters.length} / {maxCharacters === Infinity ? '∞' : maxCharacters} characters ({userTier} tier)
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* iOS-Style Template Selector */}
                                    <div className="form-group">
                                        <label className="form-label">
                                            <Icon icon="lucide:layout-template" width={16} />
                                            Script template
                                        </label>
                                        <div className="ios-select-wrapper" ref={templateMenuRef}>
                                            <button
                                                className="ios-select-button"
                                                onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                                            >
                                                <div className="ios-select-content">
                                                    <Icon icon={selectedTemplate.icon} width={18} />
                                                    <span>{selectedTemplate.name}</span>
                                                </div>
                                                <Icon
                                                    icon="lucide:chevron-down"
                                                    width={18}
                                                    className={showTemplateMenu ? 'rotate-180' : ''}
                                                />
                                            </button>
                                            <AnimatePresence>
                                                {showTemplateMenu && (
                                                    <motion.div
                                                        className="ios-select-menu"
                                                        initial={{ opacity: 0, y: -10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -10 }}
                                                        transition={{ duration: 0.2 }}
                                                    >
                                                        {SCRIPT_TEMPLATES.map((t) => (
                                                            <button
                                                                key={t.id}
                                                                className={`ios-select-item ${template === t.id ? 'selected' : ''}`}
                                                                onClick={() => {
                                                                    setTemplate(t.id);
                                                                    setShowTemplateMenu(false);
                                                                }}
                                                            >
                                                                <div className="ios-select-item-content">
                                                                    <Icon icon={t.icon} width={18} />
                                                                    <div className="ios-select-item-text">
                                                                        <span className="item-name">{t.name}</span>
                                                                        {t.prompt && (
                                                                            <span className="item-description">{t.prompt}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {template === t.id && (
                                                                    <Icon icon="lucide:check" width={18} className="check-icon" />
                                                                )}
                                                            </button>
                                                        ))}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>

                                    {/* Context Input */}
                                    <div className="form-group">
                                        <label className="form-label">
                                            <Icon icon="lucide:pen-line" width={16} />
                                            {template === 'custom' ? 'Describe your script' : 'Edit example or add details'}
                                        </label>
                                        <RichTextEditor
                                            initialValue={context}
                                            onChange={setContext}
                                            placeholder={
                                                template === 'custom'
                                                    ? 'E.g., "A fun introduction to my gaming channel where I review indie games"'
                                                    : 'Edit the example above or add your own details...'
                                            }
                                        />
                                        {template !== 'custom' && (
                                            <p className="hint-text">
                                                <Icon icon="lucide:lightbulb" width={14} />
                                                Tip: Edit the example above to match your needs, or add more context
                                            </p>
                                        )}
                                    </div>

                                    <AnimatePresence>
                                        {error && (
                                            <motion.div
                                                className="error-banner"
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                            >
                                                <Icon icon="lucide:alert-circle" width={18} />
                                                <span>{error}</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Generate Button */}
                                    <button
                                        className="btn btn-primary btn-full"
                                        onClick={handleGenerate}
                                        disabled={isGenerating || userCredits < 1}
                                    >
                                        {isGenerating ? (
                                            <>
                                                <Icon icon="lucide:loader-2" width={18} className="spin" />
                                                Generating magic...
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
                                <>
                                    {/* Generated Script Preview */}
                                    <motion.div
                                        className="generated-script-preview"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                    >
                                        <div className="preview-header">
                                            <div className="success-badge">
                                                <Icon icon="lucide:check-circle" width={20} />
                                                <h4>Script Generated Successfully</h4>
                                            </div>
                                            <button
                                                className="copy-btn"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(generatedScript);
                                                }}
                                                title="Copy to clipboard"
                                            >
                                                <Icon icon="lucide:copy" width={16} />
                                            </button>
                                        </div>
                                        <div className="script-content">
                                            {generatedScript.split('\n').map((line, idx) => (
                                                <p key={idx}>{line || '\u00A0'}</p>
                                            ))}
                                        </div>
                                    </motion.div>

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
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: var(--space-m, 16px);
          }

          .modal-content {
            background: var(--mauve-1, #fff);
            border-radius: var(--radius-l, 16px);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .modal-wide {
            max-width: 700px;
          }

          .modal-handle-bar {
            padding: var(--space-xs, 8px) 0;
            display: flex;
            justify-content: center;
          }

          .modal-handle-pill {
            width: 40px;
            height: 4px;
            background: var(--mauve-7, #ccc);
            border-radius: 2px;
          }

          .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-s, 12px) var(--space-m, 16px);
            border-bottom: 1px solid var(--mauve-5, #e8e8e8);
          }

          .modal-title-group {
            display: flex;
            align-items: center;
            gap: var(--space-xs, 8px);
          }

          .icon-wrapper {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, var(--orange-9, #ff6b35) 0%, var(--orange-10, #ff5722) 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
          }

          .modal-title {
            font-size: var(--step-1, 18px);
            font-weight: 700;
            color: var(--mauve-12, #000);
            margin: 0;
          }

          .credits-badge {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            background: var(--orange-3, #fff3e0);
            border: 1px solid var(--orange-7, #ffb74d);
            border-radius: 12px;
            font-size: 13px;
            font-weight: 600;
            color: var(--orange-11, #e65100);
          }

          .modal-close {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: transparent;
            border: none;
            color: var(--mauve-11, #666);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
          }

          .modal-close:hover {
            background: var(--mauve-4, #f0f0f0);
            color: var(--mauve-12, #000);
          }

          .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-m, 16px);
          }

          .mode-toggle {
            display: flex;
            gap: var(--space-2xs, 4px);
            padding: 4px;
            background: var(--mauve-3, #f5f5f5);
            border-radius: 12px;
            margin-bottom: var(--space-m, 16px);
          }

          .mode-btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2xs, 6px);
            padding: var(--space-xs, 10px) var(--space-s, 12px);
            background: transparent;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 14px;
            color: var(--mauve-11, #666);
            cursor: pointer;
            transition: all 0.2s;
          }

          .mode-btn.active {
            background: var(--mauve-1, #fff);
            color: var(--orange-11, #e65100);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }

          .character-selector-section {
            margin-bottom: var(--space-m, 16px);
            padding: var(--space-m, 16px);
            background: var(--mauve-2, #fafafa);
            border: 1px solid var(--mauve-5, #e8e8e8);
            border-radius: 12px;
          }

          .selected-characters {
            display: flex;
            align-items: center;
            margin: var(--space-xs, 8px) 0;
          }

          .selected-char-avatar {
            position: relative;
            width: 52px;
            height: 52px;
            border-radius: 50%;
            border: 3px solid var(--mauve-1, #fff);
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s;
          }

          .selected-char-avatar:hover {
            transform: translateY(-2px);
            z-index: 100 !important;
          }

          .selected-char-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .char-name-tooltip {
            position: absolute;
            bottom: -30px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--mauve-12, #000);
            color: white;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 12px;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
          }

          .selected-char-avatar:hover .char-name-tooltip {
            opacity: 1;
          }

          .remove-char-btn {
            position: absolute;
            top: -4px;
            right: -4px;
            width: 22px;
            height: 22px;
            background: var(--red-9, #e53935);
            border: 2px solid var(--mauve-1, #fff);
            border-radius: 50%;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
            opacity: 0;
          }

          .selected-char-avatar:hover .remove-char-btn {
            opacity: 1;
          }

          .remove-char-btn:hover {
            background: var(--red-10, #d32f2f);
            transform: scale(1.1);
          }

          .add-char-dropdown {
            position: relative;
            margin-left: 8px;
          }

          .add-char-btn {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: var(--mauve-4, #f0f0f0);
            border: 2px dashed var(--mauve-7, #ccc);
            color: var(--mauve-11, #666);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
          }

          .add-char-btn:hover {
            background: var(--mauve-5, #e8e8e8);
            border-color: var(--orange-9, #ff6b35);
            color: var(--orange-9, #ff6b35);
            transform: scale(1.05);
          }

          .add-char-menu {
            display: block;
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            background: var(--mauve-1, #fff);
            border: 1px solid var(--mauve-6, #ddd);
            border-radius: 12px;
            padding: var(--space-2xs, 4px);
            min-width: 220px;
            z-index: 10;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
          }

          .add-char-dropdown:hover .add-char-menu {
            display: block;
          }

          .add-char-item {
            display: flex;
            align-items: center;
            gap: var(--space-xs, 8px);
            width: 100%;
            padding: var(--space-xs, 8px);
            background: transparent;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
            text-align: left;
          }

          .add-char-item:hover {
            background: var(--mauve-3, #f5f5f5);
          }

          .add-char-item img {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 2px solid var(--mauve-5, #e8e8e8);
          }

          .add-char-item span {
            font-weight: 500;
            color: var(--mauve-12, #000);
          }

          .char-limit-hint {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--mauve-11, #666);
            margin-top: var(--space-xs, 8px);
          }

          .hint-text {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--mauve-11, #666);
            margin-top: var(--space-2xs, 6px);
            padding: var(--space-xs, 8px);
            background: var(--blue-2, #e3f2fd);
            border-radius: 8px;
            border: 1px solid var(--blue-6, #90caf9);
          }

          .form-group {
            margin-bottom: var(--space-m, 16px);
          }

          .form-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            font-weight: 600;
            color: var(--mauve-12, #000);
            margin-bottom: var(--space-xs, 8px);
          }

          /* iOS-Style Select */
          .ios-select-wrapper {
            position: relative;
          }

          .ios-select-button {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            background: var(--mauve-2, #fafafa);
            border: 1px solid var(--mauve-6, #ddd);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 15px;
          }

          .ios-select-button:hover {
            background: var(--mauve-3, #f5f5f5);
            border-color: var(--mauve-7, #ccc);
          }

          .ios-select-button:active {
            transform: scale(0.98);
          }

          .ios-select-content {
            display: flex;
            align-items: center;
            gap: var(--space-xs, 10px);
            color: var(--mauve-12, #000);
            font-weight: 500;
          }

          .ios-select-button svg:last-child {
            transition: transform 0.3s;
            color: var(--mauve-10, #999);
          }

          .ios-select-button svg:last-child.rotate-180 {
            transform: rotate(180deg);
          }

          .ios-select-menu {
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            right: 0;
            background: var(--mauve-1, #fff);
            border: 1px solid var(--mauve-6, #ddd);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
            z-index: 100;
            max-height: 400px;
            overflow-y: auto;
          }

          .ios-select-item {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: transparent;
            border: none;
            border-bottom: 1px solid var(--mauve-4, #f0f0f0);
            cursor: pointer;
            transition: background 0.15s;
            text-align: left;
          }

          .ios-select-item:last-child {
            border-bottom: none;
          }

          .ios-select-item:hover {
            background: var(--mauve-2, #fafafa);
          }

          .ios-select-item.selected {
            background: var(--orange-2, #fff3e0);
          }

          .ios-select-item-content {
            display: flex;
            align-items: flex-start;
            gap: var(--space-xs, 10px);
            flex: 1;
          }

          .ios-select-item-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .item-name {
            font-weight: 600;
            font-size: 14px;
            color: var(--mauve-12, #000);
          }

          .item-description {
            font-size: 12px;
            color: var(--mauve-11, #666);
            line-height: 1.4;
          }

          .check-icon {
            color: var(--orange-9, #ff6b35);
            flex-shrink: 0;
          }

          .error-banner {
            display: flex;
            align-items: center;
            gap: var(--space-xs, 8px);
            padding: var(--space-s, 12px);
            background: var(--red-3, #ffebee);
            border: 1px solid var(--red-7, #ef5350);
            border-radius: 12px;
            color: var(--red-11, #c62828);
            margin-bottom: var(--space-m, 16px);
            font-size: 14px;
          }

          .generated-script-preview {
            margin-bottom: var(--space-m, 16px);
          }

          .preview-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-s, 12px);
          }

          .success-badge {
            display: flex;
            align-items: center;
            gap: var(--space-xs, 8px);
            color: var(--green-11, #2e7d32);
          }

          .success-badge h4 {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
          }

          .copy-btn {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            background: var(--mauve-3, #f5f5f5);
            border: 1px solid var(--mauve-6, #ddd);
            color: var(--mauve-11, #666);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
          }

          .copy-btn:hover {
            background: var(--mauve-4, #f0f0f0);
            color: var(--mauve-12, #000);
          }

          .script-content {
            background: var(--mauve-2, #fafafa);
            border: 1px solid var(--mauve-5, #e8e8e8);
            border-radius: 12px;
            padding: var(--space-m, 16px);
            max-height: 400px;
            overflow-y: auto;
          }

          .script-content p {
            margin: var(--space-xs, 8px) 0;
            line-height: 1.7;
            color: var(--mauve-12, #000);
            font-size: 14px;
          }

          .action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-xs, 8px);
          }

          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-xs, 8px);
            padding: var(--space-s, 14px);
            border-radius: 12px;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            position: relative;
          }

          .btn-primary {
            background: linear-gradient(135deg, var(--orange-9, #ff6b35) 0%, var(--orange-10, #ff5722) 100%);
            color: white;
            box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
          }

          .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(255, 107, 53, 0.4);
          }

          .btn-primary:active:not(:disabled) {
            transform: translateY(0);
          }

          .btn-secondary {
            background: var(--mauve-3, #f5f5f5);
            color: var(--mauve-12, #000);
            border: 1px solid var(--mauve-6, #ddd);
          }

          .btn-secondary:hover {
            background: var(--mauve-4, #f0f0f0);
          }

          .btn-full {
            width: 100%;
          }

          .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .btn-badge {
            padding: 2px 8px;
            background: rgba(255, 255, 255, 0.25);
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
          }

          .spin {
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          
        `}</style>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}