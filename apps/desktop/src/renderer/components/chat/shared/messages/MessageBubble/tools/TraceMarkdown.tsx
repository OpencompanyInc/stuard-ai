import React, { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeMarkdownSpacing } from '../helpers/markdown';

// Compact markdown renderer for tool-result text shown in the chain-of-thought
// trace (analyze_media summaries, generic string results, …). Renders
// **bold**, *italic*, lists, `code`, links and tables with tight spacing so the
// raw `**` / `#` / `-` markers never leak through as literal text. Colour is
// inherited from the surrounding container so it blends with each preview.
const TRACE_MD_COMPONENTS = {
  p: (props: any) => <p className="mb-1.5 leading-relaxed last:mb-0" {...props} />,
  strong: (props: any) => <strong className="font-semibold" {...props} />,
  em: (props: any) => <em className="italic" {...props} />,
  del: (props: any) => <del className="line-through opacity-70" {...props} />,
  ul: (props: any) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0" {...props} />,
  ol: (props: any) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0" {...props} />,
  li: (props: any) => <li className="leading-relaxed" {...props} />,
  h1: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  h2: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  h3: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  h4: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  h5: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  h6: (props: any) => <p className="mb-1 mt-1 font-semibold first:mt-0" {...props} />,
  hr: () => <hr className="my-2" style={{ borderColor: 'color-mix(in srgb, var(--foreground) 12%, transparent)' }} />,
  blockquote: (props: any) => (
    <blockquote
      className="my-1.5 border-l-2 pl-2 italic opacity-90"
      style={{ borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)' }}
      {...props}
    />
  ),
  a: ({ href, children, ...props }: any) => (
    <a
      href={href}
      className="text-indigo-400 underline underline-offset-2 transition-colors hover:text-indigo-300"
      onClick={(e) => {
        if (typeof href === 'string' && !/^(javascript|vbscript):/i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          try { (window as any).desktopAPI?.openExternal?.(href); } catch {}
        }
      }}
      {...props}
    >
      {children}
    </a>
  ),
  // Render block code ourselves and collapse react-markdown's wrapping <pre> so
  // we don't end up with a nested pre.
  pre: ({ children }: any) => <>{children}</>,
  code: ({ className, children, ...props }: any) => {
    const text = String(children ?? '');
    const isBlock = /language-/.test(className || '') || text.includes('\n');
    if (isBlock) {
      return (
        <pre
          className="my-1.5 overflow-x-auto rounded-md p-2 text-[11px] font-mono leading-relaxed"
          style={{ backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <code {...props}>{text.replace(/\n$/, '')}</code>
        </pre>
      );
    }
    return (
      <code
        className="rounded px-1 py-0.5 font-mono text-[0.85em]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  table: (props: any) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="text-[11px]" {...props} />
    </div>
  ),
  th: (props: any) => <th className="px-2 py-0.5 text-left font-semibold" {...props} />,
  td: (props: any) => <td className="px-2 py-0.5 align-top" {...props} />,
  img: ({ alt }: any) => <span className="opacity-70">{alt || 'image'}</span>,
};

export const TraceMarkdown: React.FC<{ children: string; className?: string; style?: React.CSSProperties }> = memo(({ children, className, style }) => {
  const text = useMemo(() => normalizeMarkdownSpacing(String(children || '')), [children]);
  if (!text.trim()) return null;
  return (
    <div className={className} style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url) => url} components={TRACE_MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
