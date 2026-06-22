import React, { useCallback, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';

interface CodeCopyButtonProps {
  /** The exact code text to place on the clipboard. */
  code: string;
}

/**
 * Copy button for fenced code blocks. Flips to a "Copied" check for ~2s so the
 * click has visible feedback (the bare clipboard write looked like a no-op).
 */
export const CodeCopyButton: React.FC<CodeCopyButtonProps> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[CodeBlock] copy failed:', err);
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-[10px] font-medium uppercase tracking-wider',
        copied
          ? 'text-emerald-500'
          : 'text-theme-muted hover:text-theme-fg hover:bg-theme-active',
      )}
      title={copied ? 'Copied to clipboard' : 'Copy code'}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

export default CodeCopyButton;
