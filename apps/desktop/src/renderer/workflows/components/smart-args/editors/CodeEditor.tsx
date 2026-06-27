/**
 * CodeEditor - Rich code editor wrapper
 */
import React from 'react';
import { RichCodeEditor } from '../../RichCodeEditor';

interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  placeholder?: string;
}

export function CodeEditor({ value, onChange, language, placeholder }: CodeEditorProps) {
  return (
    <div className="rounded-xl overflow-hidden shadow-sm">
      <RichCodeEditor
        value={String(value || '')}
        onChange={onChange}
        language={language || 'text'}
        placeholder={placeholder || `Enter ${language || 'code'} here...`}
        className="min-h-[200px]"
      />
    </div>
  );
}
