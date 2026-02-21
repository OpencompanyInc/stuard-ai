import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './scrollbar.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Cross2Icon, Pencil1Icon, EyeOpenIcon, CopyIcon } from '@radix-ui/react-icons';

function convertLatexDelims(md: string): string {
  let i = 0;
  let out = '';
  let inFence = false;
  let inInline = false;
  while (i < md.length) {
    if (!inInline && md.startsWith('```', i)) {
      inFence = !inFence;
      out += '```';
      i += 3;
      continue;
    }
    if (!inFence && md[i] === '`') {
      inInline = !inInline;
      out += md[i++];
      continue;
    }
    if (!inFence && !inInline) {
      if (md.startsWith('\\[', i)) { out += '$$'; i += 2; continue; }
      if (md.startsWith('\\]', i)) { out += '$$'; i += 2; continue; }
      if (md.startsWith('\\(', i)) { out += '$'; i += 2; continue; }
      if (md.startsWith('\\)', i)) { out += '$'; i += 2; continue; }
    }
    out += md[i++];
  }
  return out;
}

function escapeCurrencyDollars(text: string): string {
  return text.replace(/\$(\d[\d,]*\.?\d*)/g, '\\$$$1');
}

function BoardApp() {
  const [data, setData] = useState<any>({ template: 'notes', title: 'Board', position: { x: 80, y: 80 }, size: { width: 360, height: 240 } });
  const [content, setContent] = useState<string>('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string>('');
  const saveTimer = useRef<any>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    const unsubInit = window.desktopAPI.onBoardInit?.((d: any) => {
      setData(d || {});
      if (typeof d?.content === 'string') { setContent(d.content); lastSavedRef.current = String(d.content); }
    });
    const unsubUpdate = window.desktopAPI.onBoardUpdate?.((d: any) => {
      if (typeof d?.content === 'string') { setContent(d.content); lastSavedRef.current = String(d.content); }
      setData((prev: any) => ({ ...prev, ...d }));
    });
    return () => { try { (unsubInit as any)?.(); } catch {}; try { (unsubUpdate as any)?.(); } catch {} };
  }, []);

  useEffect(() => {
    if (!titleEditing) setTitleDraft(String(data?.title || ''));
  }, [data?.title, titleEditing]);

  const boardId = String(data?.id || '');
  // Debounced auto-save so readers can fetch up-to-date content without waiting for blur
  useEffect(() => {
    if (!boardId) return;
    try { if (saveTimer.current) clearTimeout(saveTimer.current); } catch {}
    saveTimer.current = setTimeout(async () => {
      try {
        if (lastSavedRef.current !== content) {
          await window.desktopAPI.canvasUpdate?.({ id: boardId, content });
          lastSavedRef.current = content;
        }
      } catch {}
    }, 400);
    return () => { try { if (saveTimer.current) clearTimeout(saveTimer.current); } catch {} };
  }, [content, boardId]);
  const toggleTemplate = async () => {
    if (!boardId) return;
    const next = data?.template === 'notes' ? 'info' : 'notes';
    setData((prev: any) => ({ ...prev, template: next }));
    try { await window.desktopAPI.canvasUpdate?.({ id: boardId, template: next, content }); } catch {}
  };
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(String(content || '')); } catch {}
  };
  const handleClose = async () => {
    try { if (boardId) await window.desktopAPI.canvasDelete?.(boardId); } catch {}
    try { window.close(); } catch {}
  };
  const commitTitle = async () => {
    setTitleEditing(false);
    const t = String(titleDraft || '').trim();
    if (!boardId) return;
    try { await window.desktopAPI.canvasUpdate?.({ id: boardId, title: t }); } catch {}
  };

  return (
    <div className="w-full h-full">
      <div className="w-full h-full rounded-xl border border-white/10 bg-surface/90 backdrop-blur-lg shadow-soft overflow-hidden flex flex-col">
        <div className="drag h-7 w-full px-2 flex items-center justify-between text-[11px] bg-white/5 border-b border-white/10">
          <div className="flex-1 flex items-center gap-1 min-w-0">
            {titleEditing ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitleEditing(false); setTitleDraft(String(data?.title || '')); } }}
                className="no-drag bg-transparent outline-none text-[11px] px-1 py-0.5 rounded-md border border-white/20 w-full text-white"
                autoFocus
              />
            ) : (
              <button className="no-drag text-left truncate mr-2 text-white/85 hover:text-white/90" title="Edit title" onClick={() => setTitleEditing(true)}>
                {data?.title || (data?.template === 'notes' ? 'Notes' : 'Info')}
              </button>
            )}
          </div>
          <div className="no-drag inline-flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 ring-1 ring-white/10">
            <button
              onClick={toggleTemplate}
              className="h-5 w-5 rounded-md hover:bg-white/10 transition inline-flex items-center justify-center"
              title={data?.template === 'notes' ? 'Preview' : 'Edit'}
              aria-label={data?.template === 'notes' ? 'Preview' : 'Edit'}
            >
              {data?.template === 'notes' ? <EyeOpenIcon className="w-3.5 h-3.5" /> : <Pencil1Icon className="w-3.5 h-3.5" />}
            </button>
            <button onClick={handleCopy} className="h-5 w-5 rounded-md hover:bg-white/10 transition inline-flex items-center justify-center" title="Copy" aria-label="Copy">
              <CopyIcon className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleClose} className="h-5 w-5 rounded-md hover:bg-white/10 transition inline-flex items-center justify-center" title="Close" aria-label="Close">
              <Cross2Icon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {data?.template === 'notes' ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={async () => { if (boardId) { try { await window.desktopAPI.canvasUpdate?.({ id: boardId, content }); } catch {} } }}
              className="w-full h-full bg-transparent outline-none text-[12.5px] p-2.5 custom-scrollbar border-t border-white/10 placeholder:text-white/40 resize-none text-white"
              placeholder="Type notes..."
            />
          ) : (
            <div className="w-full h-full p-2.5 overflow-auto custom-scrollbar text-[12.5px] leading-relaxed tracking-[0.01em] text-white">
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                components={{
                  p: (props: any) => <p className="mb-1.5 text-white" {...props} />,
                  a: (props: any) => <a className="text-sky-300 underline underline-offset-2 decoration-white/30 hover:decoration-white/60" {...props} />,
                  ul: (props: any) => <ul className="list-disc pl-5 mb-1.5 text-white" {...props} />,
                  ol: (props: any) => <ol className="list-decimal pl-5 mb-1.5 text-white" {...props} />,
                  blockquote: (props: any) => <blockquote className="border-l-2 border-white/20 pl-2 my-1 text-white/75" {...props} />,
                  h1: (props: any) => <h1 className="text-[15px] font-semibold mb-1.5 tracking-[0.01em] text-white" {...props} />,
                  h2: (props: any) => <h2 className="text-[14.5px] font-semibold mb-1.5 tracking-[0.01em] text-white" {...props} />,
                  h3: (props: any) => <h3 className="text-[14px] font-medium mb-1.5 tracking-[0.01em] text-white" {...props} />,
                  code: ({inline, className, children, ...props}: any) => (
                    inline
                      ? <code className="bg-white/10 rounded-md px-1 font-mono text-[12.5px] text-white" {...props}>{children}</code>
                      : <pre className="bg-white/5 rounded-lg p-2 overflow-auto custom-scrollbar border border-white/10"><code className={className ? className + ' font-mono text-[12.5px] text-white' : 'font-mono text-[12.5px] text-white'} {...props}>{children}</code></pre>
                  ),
                }}
              >
                {convertLatexDelims(escapeCurrencyDollars(String(content || '')))}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BoardApp />
  </React.StrictMode>
);
