import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';

export interface RichTextProps {
  content: string;
  className?: string;
  compact?: boolean;
}

export const RichText: React.FC<RichTextProps> = ({
  content,
  className,
  compact = false
}) => {
  if (!content) return null;

  return (
    <div className={clsx(
      "prose prose-sm max-w-none dark:prose-invert",
      // Compact mode styles
      compact && "prose-p:my-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 prose-pre:my-1",
      // Custom link styles
      "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
      // Code block styles
      "prose-pre:bg-theme-hover prose-pre:text-theme-fg prose-pre:border prose-pre:border-theme/20 prose-pre:rounded-lg",
      "prose-code:text-amber-600 dark:prose-code:text-amber-400 prose-code:bg-amber-500/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
      // Blockquote
      "prose-blockquote:border-l-4 prose-blockquote:border-theme/30 prose-blockquote:bg-theme-hover/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:text-theme-muted",
      className
    )}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5">
              {props.children}
              <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
          ),
          // Override table styles for better look
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 border border-theme/20 rounded-lg">
              <table {...props} className="w-full text-sm text-left" />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead {...props} className="bg-theme-hover/50 border-b border-theme/20" />
          ),
          th: ({ node, ...props }) => (
            <th {...props} className="px-4 py-2 font-medium text-theme-muted" />
          ),
          td: ({ node, ...props }) => (
            <td {...props} className="px-4 py-2 border-t border-theme/10" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
