import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { clsx } from 'clsx';
import { prepareMarkdownForDisplay } from './markdownText';

function openExternal(href: string) {
  if (!href || /^(javascript|vbscript):/i.test(href)) return;
  try {
    (window as any).desktopAPI?.openExternal?.(href);
    if (!(window as any).desktopAPI?.openExternal) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  } catch {
    try {
      window.open(href, '_blank', 'noopener,noreferrer');
    } catch { /* ignore */ }
  }
}

export function RunDetailMarkdown({
  content,
  className,
  tone = 'default',
}: {
  content: string;
  className?: string;
  tone?: 'default' | 'error';
}) {
  const prepared = prepareMarkdownForDisplay(content);
  const components = useMemo(() => ({
    p: ({ children, ...props }: any) => {
      const childArr = Array.isArray(children) ? children : [children];
      const isEmpty = childArr
        .filter((c) => c !== null && c !== undefined)
        .every((c) => typeof c === 'string' && String(c).trim().length === 0);
      if (isEmpty) return null;
      return (
        <p
          {...props}
          className={clsx(
            'mb-3 last:mb-0 leading-7',
            tone === 'error' ? 'text-red-300/90' : 'text-theme-fg/85',
          )}
        >
          {children}
        </p>
      );
    },
    strong: ({ ...props }: any) => (
      <strong {...props} className={tone === 'error' ? 'font-semibold text-red-200' : 'font-semibold text-theme-fg'} />
    ),
    em: ({ ...props }: any) => <em {...props} className="italic" />,
    h1: ({ ...props }: any) => <h1 {...props} className="mb-2 mt-3 text-[16px] font-bold text-theme-fg first:mt-0" />,
    h2: ({ ...props }: any) => <h2 {...props} className="mb-2 mt-3 text-[15px] font-bold text-theme-fg first:mt-0" />,
    h3: ({ ...props }: any) => <h3 {...props} className="mb-1.5 mt-2.5 text-[14px] font-semibold text-theme-fg first:mt-0" />,
    blockquote: ({ ...props }: any) => (
      <blockquote {...props} className="my-2 border-l-2 border-theme/30 pl-3 italic text-theme-muted" />
    ),
    hr: ({ ...props }: any) => <hr {...props} className="my-3 border-theme/30" />,
    ul: ({ ...props }: any) => <ul {...props} className="mb-3 ml-4 list-disc space-y-1" />,
    ol: ({ ...props }: any) => <ol {...props} className="mb-3 ml-4 list-decimal space-y-1" />,
    li: ({ ...props }: any) => <li {...props} className="leading-7 text-theme-fg/85" />,
    a: ({ href, children, ...props }: any) => (
      <a
        {...props}
        href={href}
        className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary/70"
        onClick={(e: React.MouseEvent) => {
          if (typeof href === 'string') {
            e.preventDefault();
            openExternal(href);
          }
        }}
      >
        {children}
      </a>
    ),
    pre: ({ children, ...props }: any) => (
      <pre
        {...props}
        className="my-2 overflow-x-auto rounded-lg border border-[color:var(--dashboard-panel-border)] bg-zinc-500/10 p-3 text-[12px] leading-relaxed"
      >
        {children}
      </pre>
    ),
    code: ({ inline, className: codeClassName, children, ...props }: any) => (
      inline ? (
        <code
          className="rounded bg-theme-hover px-1.5 py-0.5 font-mono text-[85%] text-theme-fg border border-theme/20"
          {...props}
        >
          {children}
        </code>
      ) : (
        <code className={clsx(codeClassName, 'font-mono text-[12px] text-theme-fg')} {...props}>
          {children}
        </code>
      )
    ),
    table: ({ ...props }: any) => (
      <div className="my-2 overflow-x-auto">
        <table {...props} className="w-full border-collapse text-[12px]" />
      </div>
    ),
    th: ({ ...props }: any) => (
      <th {...props} className="border-b border-theme/30 bg-theme-hover/40 px-2 py-1.5 text-left font-semibold text-theme-fg" />
    ),
    td: ({ ...props }: any) => (
      <td {...props} className="border-b border-theme/10 px-2 py-1.5 text-theme-fg/85" />
    ),
  }), [tone]);

  if (!prepared.trim()) return null;

  return (
    <div className={clsx('prose prose-sm max-w-none break-words text-[14px]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={components}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
