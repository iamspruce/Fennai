import { useEffect, useRef } from 'react';
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

    useEffect(() => {
        if (editorRef.current && initialValue) {
            editorRef.current.innerHTML = initialValue;
        }
    }, [initialValue]);

    const handleInput = () => {
        if (editorRef.current) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const execCommand = (command: string, value?: string) => {
        document.execCommand(command, false, value);
        editorRef.current?.focus();
    };

    return (
        <div className="rich-text-editor">
            {!readOnly && (
                <div className="editor-toolbar">
                    <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCommand('bold')}
                        title="Bold (Ctrl+B)"
                    >
                        <Icon icon="lucide:bold" width={16} />
                    </button>
                    <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCommand('italic')}
                        title="Italic (Ctrl+I)"
                    >
                        <Icon icon="lucide:italic" width={16} />
                    </button>
                </div>
            )}
            <div
                ref={editorRef}
                className={`editor-content ${readOnly ? 'readonly' : ''}`}
                contentEditable={!readOnly}
                onInput={handleInput}
                data-placeholder={placeholder}
            />

            <style>{`
        .rich-text-editor {
          border: 1px solid var(--mauve-6);
          border-radius: var(--radius-m);
          background: var(--mauve-2);
          overflow: hidden;
        }

        .editor-toolbar {
          display: flex;
          gap: 4px;
          padding: var(--space-2xs);
          border-bottom: 1px solid var(--mauve-6);
          background: var(--mauve-3);
        }

        .toolbar-btn {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-s);
          color: var(--mauve-11);
          cursor: pointer;
          transition: all 0.2s;
        }

        .toolbar-btn:hover {
          background: var(--mauve-5);
          color: var(--mauve-12);
        }

        .toolbar-btn:active {
          background: var(--mauve-6);
        }

        .editor-content {
          padding: var(--space-s);
          min-height: 120px;
          max-height: 300px;
          overflow-y: auto;
          outline: none;
          color: var(--mauve-12);
          line-height: 1.6;
          font-size: 14px;
        }

        .editor-content.readonly {
          background: var(--mauve-1);
          cursor: default;
        }

        .editor-content:empty:before {
          content: attr(data-placeholder);
          color: var(--mauve-11);
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
      `}</style>
        </div>
    );
}