import React, { useMemo } from 'react';
import clsx from 'clsx';
import { AudioPlayer } from '../../../../../AudioPlayer';
import { toMediaSrc } from '../helpers/media';
import { CodeCopyButton } from '../inline/CodeCopyButton';
import { InlineImage } from '../inline/InlineImage';
import { InlineVideo } from '../inline/InlineVideo';
import { isHighlightHref, MarkdownHighlight } from '../inline/MarkdownHighlight';
import { isUnderlineHref, MarkdownUnderline } from '../inline/MarkdownUnderline';

export function useMessageMarkdownComponents(role: 'user' | 'assistant') {
  return useMemo(() => ({
    p: ({ children, ...props }: any) => {
      const childArr = Array.isArray(children) ? children : [children];
      const isEmpty = childArr
        .filter((c) => c !== null && c !== undefined)
        .every((c) => typeof c === 'string' && String(c).trim().length === 0);
      if (isEmpty) return null;
      return <p className="mb-4 last:mb-0 leading-[1.7] text-theme-fg/95 [&:where(li_&)]:mb-1" {...props}>{children}</p>;
    },
    img: ({ node, src, alt, ...props }: any) => {
      const nodeUrl = (node && (node.url || (node.properties && node.properties.src))) || '';
      const finalSrc = src || nodeUrl || '';
      try {
        console.log('[MessageBubble] img node/url:', { src, nodeUrl, finalSrc });
      } catch { }
      const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(finalSrc) || alt === 'audio';
      const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(finalSrc) || alt === 'video';
      if (isAudio) return <AudioPlayer src={toMediaSrc(finalSrc)} />;
      if (isVideo) return <InlineVideo src={finalSrc} />;
      return <InlineImage src={finalSrc} alt={alt} />;
    },
    a: ({ href, children, ...props }: any) => {
      if (isHighlightHref(href)) {
        return <MarkdownHighlight>{children}</MarkdownHighlight>;
      }
      if (isUnderlineHref(href)) {
        return <MarkdownUnderline>{children}</MarkdownUnderline>;
      }
      const linkClass = role === 'user'
        ? "text-white/95 underline underline-offset-3 decoration-white/50 hover:decoration-white/80 hover:text-white cursor-pointer transition-all font-medium"
        : "text-indigo-400 underline underline-offset-3 decoration-indigo-400/40 hover:decoration-indigo-400/70 hover:text-indigo-300 cursor-pointer transition-all font-medium";
      return (
        <a
          className={linkClass}
          href={href}
          onClick={(e) => {
            if (typeof href === 'string' && !/^(javascript|vbscript):/i.test(href)) {
              e.preventDefault();
              e.stopPropagation();
              try { (window as any).desktopAPI.openExternal(href); } catch { }
            }
          }}
          {...props}
        >{children}</a>
      );
    },
    ul: (props: any) => <ul className="list-disc pl-6 mb-4 space-y-1.5 marker:text-theme/60 marker:text-sm" {...props} />,
    ol: (props: any) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-theme/60 marker:text-sm marker:font-semibold" {...props} />,
    li: (props: any) => <li className="leading-[1.7] text-theme-fg/95 pl-1" {...props} />,
    blockquote: ({ children, ...props }: any) => (
      <blockquote
        className="my-4 rounded-xl bg-theme-card border border-theme shadow-sm px-4 py-3 [&>p]:mb-2 [&>p:last-child]:mb-0"
        {...props}
      >
        <span className="text-theme-muted leading-[1.7]">{children}</span>
      </blockquote>
    ),
    h1: (props: any) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0 tracking-tight text-theme-fg border-b border-theme/10 pb-2" {...props} />,
    h2: (props: any) => <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0 tracking-tight text-theme-fg border-b border-theme/10 pb-1" {...props} />,
    h3: (props: any) => <h3 className="text-lg font-bold mb-2.5 mt-4 first:mt-0 text-theme-fg/95" {...props} />,
    h4: (props: any) => <h4 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-theme-fg/90" {...props} />,
    h5: (props: any) => <h5 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0 text-theme-fg/85" {...props} />,
    h6: (props: any) => <h6 className="text-xs font-semibold mb-1 mt-2.5 first:mt-0 text-theme-muted/80 uppercase tracking-wide" {...props} />,
    strong: (props: any) => <strong className="font-bold text-theme-fg" {...props} />,
    em: (props: any) => <em className="italic text-theme-fg/95" {...props} />,
    pre: ({ children, ...props }: any) => {
      let childProps: any = {};
      let codeContent = children;
      if (React.isValidElement(children)) {
        childProps = children.props || {};
        codeContent = childProps.children;
      } else if (Array.isArray(children) && children.length === 1 && React.isValidElement(children[0])) {
        childProps = children[0].props || {};
        codeContent = childProps.children;
      }

      const className = childProps.className || '';
      const language = className.replace('language-', '') || 'code';
      // Flatten children to a plain string — react-markdown may hand back a
      // single string or an array of text nodes, so String() alone can mangle it.
      const codeText = React.Children.toArray(codeContent)
        .map((c) => (typeof c === 'string' ? c : ''))
        .join('')
        .replace(/\n$/, '');
      return (
        <div className="my-4 rounded-xl overflow-hidden bg-theme-card border border-theme shadow-sm w-full max-w-full group/codeblock flex flex-col">
          <div className="bg-theme-hover px-4 py-2 border-b border-theme flex items-center justify-between select-none">
            <span className="text-xs text-theme-muted font-mono font-bold uppercase tracking-wider">{language}</span>
            <div className="flex items-center gap-3">
              <CodeCopyButton code={codeText} />
            </div>
          </div>
          <div className="relative w-full overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4 w-full bg-theme-bg">
              <code
                className={clsx(className, "font-mono text-[13px] inline-block min-w-full leading-[1.7] text-theme-fg whitespace-pre tab-4")}
                {...childProps}
              >
                {codeContent}
              </code>
            </div>
          </div>
        </div>
      );
    },
    code: ({ className, children, ...props }: any) => (
      <code className="bg-theme-hover border border-theme text-theme-fg rounded-md px-[6px] py-[2px] font-mono text-[0.85em] font-medium align-middle" {...props}>{children}</code>
    ),
    table: (props: any) => (
      <div className="overflow-x-auto scrollbar-none my-3 rounded-xl border border-theme/20 shadow-sm">
        <table className="min-w-full divide-y divide-theme/15 text-sm" {...props} />
      </div>
    ),
    thead: (props: any) => <thead className="bg-gradient-to-b from-theme-hover/60 to-theme-hover/40" {...props} />,
    tbody: (props: any) => <tbody className="divide-y divide-theme/10 bg-theme-bg/30" {...props} />,
    tr: (props: any) => <tr className="hover:bg-theme-hover/40 transition-colors" {...props} />,
    th: (props: any) => <th className="px-4 py-2.5 text-left font-bold text-theme-fg uppercase tracking-wider text-[11px]" {...props} />,
    td: (props: any) => <td className="px-4 py-2.5 text-theme-fg/90 whitespace-pre-wrap" {...props} />,
    hr: (props: any) => <hr className="my-4 border-theme/15" {...props} />,
    del: (props: any) => <del className="line-through text-theme-muted/60 decoration-2" {...props} />,
    sup: (props: any) => <sup className="text-[75%] align-super text-theme-muted/80" {...props} />,
    sub: (props: any) => <sub className="text-[75%] align-sub text-theme-muted/80" {...props} />,
  }), [role]);
}
