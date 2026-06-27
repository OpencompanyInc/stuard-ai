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
      "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline",
      // Code block styles
      "prose-pre:bg-neutral-100 prose-pre:text-neutral-800 prose-pre:border prose-pre:border-neutral-200 prose-pre:rounded-lg",
      "prose-code:text-amber-600 prose-code:bg-amber-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
      // Blockquote
      "prose-blockquote:border-l-4 prose-blockquote:border-blue-200 prose-blockquote:bg-blue-50/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:not-italic prose-blockquote:text-neutral-600",
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
            <div className="overflow-x-auto my-2 border border-neutral-200 rounded-lg">
              <table {...props} className="w-full text-sm text-left" />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead {...props} className="bg-neutral-50 border-b border-neutral-200" />
          ),
          th: ({ node, ...props }) => (
            <th {...props} className="px-4 py-2 font-medium text-neutral-600" />
          ),
          td: ({ node, ...props }) => (
            <td {...props} className="px-4 py-2 border-t border-neutral-100" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
