import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '@iconify/react';

interface RichTextEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export default function RichTextEditor({
  initialValue,
  onChange,
  placeholder = 'Start typing...',
  readOnly = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const isInitialMount = useRef(true);

  // Initialize content only once
  useEffect(() => {
    if (editorRef.current && initialValue && isInitialMount.current) {
      editorRef.current.innerHTML = initialValue;
      isInitialMount.current = false;
    }
  }, [initialValue]);

  // Update active formats on selection change
  const updateActiveFormats = useCallback(() => {
    const formats = new Set<string>();
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('insertOrderedList')) formats.add('ol');
    if (document.queryCommandState('insertUnorderedList')) formats.add('ul');
    setActiveFormats(formats);
  }, []);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
      updateActiveFormats();
    }
  }, [onChange, updateActiveFormats]);

  const handleKeyUp = useCallback(() => {
    updateActiveFormats();
  }, [updateActiveFormats]);

  const handleMouseUp = useCallback(() => {
    updateActiveFormats();
  }, [updateActiveFormats]);

  const execCommand = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateActiveFormats();
    handleInput();
  }, [handleInput, updateActiveFormats]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          execCommand('bold');
          break;
        case 'i':
          e.preventDefault();
          execCommand('italic');
          break;
        case 'u':
          e.preventDefault();
          execCommand('underline');
          break;
      }
    }
  }, [execCommand]);

  const toolbarButtons = [
    { command: 'bold', icon: 'lucide:bold', title: 'Bold (Ctrl+B)', key: 'bold' },
    { command: 'italic', icon: 'lucide:italic', title: 'Italic (Ctrl+I)', key: 'italic' },
    { command: 'underline', icon: 'lucide:underline', title: 'Underline (Ctrl+U)', key: 'underline' },
    { command: 'insertUnorderedList', icon: 'lucide:list', title: 'Bullet List', key: 'ul' },
    { command: 'insertOrderedList', icon: 'lucide:list-ordered', title: 'Numbered List', key: 'ol' },
    { command: 'formatBlock', icon: 'lucide:heading-2', title: 'Heading', key: 'h2', value: 'h2' },
  ];

  return (
    <div className="rich-text-editor">
      {!readOnly && (
        <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
          {toolbarButtons.map((btn) => (
            <button
              key={btn.key}
              type="button"
              className={`toolbar-btn ${activeFormats.has(btn.key) ? 'active' : ''}`}
              onClick={() => execCommand(btn.command, btn.value)}
              title={btn.title}
              aria-label={btn.title}
              aria-pressed={activeFormats.has(btn.key)}
            >
              <Icon icon={btn.icon} width={16} />
            </button>
          ))}
          <div className="toolbar-divider" />
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => {
              if (editorRef.current) {
                editorRef.current.innerHTML = '';
                onChange('');
              }
            }}
            title="Clear formatting"
            aria-label="Clear all content"
          >
            <Icon icon="lucide:trash-2" width={16} />
          </button>
        </div>
      )}
      <div
        ref={editorRef}
        className={`editor-content ${readOnly ? 'readonly' : ''}`}
        contentEditable={!readOnly}
        onInput={handleInput}
        onKeyUp={handleKeyUp}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        role="textbox"
        aria-label="Rich text editor"
        aria-multiline="true"
        aria-readonly={readOnly}
        suppressContentEditableWarning
      />
      <style>{`
        .rich-text-editor {
          border: 1px solid var(--mauve-6, #e0e0e0);
          border-radius: var(--radius-m, 8px);
          background: var(--mauve-2, #fafafa);
          overflow: hidden;
        }
        .editor-toolbar {
          display: flex;
          gap: 4px;
          padding: var(--space-2xs, 8px);
          border-bottom: 1px solid var(--mauve-6, #e0e0e0);
          background: var(--mauve-3, #f5f5f5);
          flex-wrap: wrap;
        }
        .toolbar-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-s, 4px);
          color: var(--mauve-11, #666);
          cursor: pointer;
          transition: all 0.2s;
        }
        .toolbar-btn:hover {
          background: var(--mauve-5, #e8e8e8);
          color: var(--mauve-12, #000);
        }
        .toolbar-btn:active,
        .toolbar-btn.active {
          background: var(--mauve-6, #ddd);
          color: var(--mauve-12, #000);
        }
        .toolbar-btn:focus-visible {
          outline: 2px solid var(--mauve-8, #999);
          outline-offset: 2px;
        }
        .toolbar-divider {
          width: 1px;
          background: var(--mauve-6, #e0e0e0);
          margin: 4px 4px;
        }
        .editor-content {
          padding: var(--space-s, 12px);
          min-height: 120px;
          max-height: 300px;
          overflow-y: auto;
          outline: none;
          color: var(--mauve-12, #000);
          line-height: 1.6;
          font-size: 14px;
        }
        .editor-content.readonly {
          background: var(--mauve-1, #fff);
          cursor: default;
        }
        .editor-content:empty:before {
          content: attr(data-placeholder);
          color: var(--mauve-11, #999);
          pointer-events: none;
        }
        .editor-content:focus {
          outline: none;
        }
        .editor-content b,
        .editor-content strong {
          font-weight: 700;
        }
        .editor-content i,
        .editor-content em {
          font-style: italic;
        }
        .editor-content u {
          text-decoration: underline;
        }
        .editor-content h2 {
          font-size: 1.5em;
          font-weight: 600;
          margin: 0.5em 0;
        }
        .editor-content ul,
        .editor-content ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
        }
        .editor-content li {
          margin: 0.25em 0;
        }
      `}</style>
    </div>
  );
}