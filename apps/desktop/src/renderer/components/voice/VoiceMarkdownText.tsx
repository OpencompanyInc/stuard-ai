import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface VoiceMarkdownTextProps {
  text: string;
}

const inlineMarkdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold not-italic">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.92em] not-italic">
      {children}
    </code>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ol: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  li: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  br: () => ' ',
};

function normalizeVoiceMarkdown(input: string): string {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n');
}

export function VoiceMarkdownText({ text }: VoiceMarkdownTextProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inlineMarkdownComponents}
    >
      {normalizeVoiceMarkdown(text)}
    </ReactMarkdown>
  );
}
