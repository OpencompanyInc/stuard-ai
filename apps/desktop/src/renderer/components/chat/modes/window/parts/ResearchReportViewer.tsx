/**
 * ResearchReportViewer — full document overlay for the markdown report shipped
 * by the research_report tool. Renders with the exact same markdown pipeline
 * as assistant chat bubbles (GFM + math + ==highlight==), plus document
 * actions: copy markdown, save as .md (native save dialog), close.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Check, Copy, Download, FileText, X } from 'lucide-react';
import { useMessageMarkdownComponents } from '../../../shared/messages/MessageBubble/hooks/useMessageMarkdownComponents';
import { processCustomMarkdown } from '../../../shared/messages/MessageBubble/helpers/markdown';
import { RESEARCH_ACCENT } from './ActiveResearchBar';
import type { ResearchReport } from '../../../../../hooks/useActiveResearch';

interface ResearchReportViewerProps {
  report: ResearchReport;
  onClose: () => void;
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80);
  return (cleaned || 'research-report') + '.md';
}

export const ResearchReportViewer: React.FC<ResearchReportViewerProps> = ({ report, onClose }) => {
  const markdownComponents = useMessageMarkdownComponents('assistant');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      const api = (window as any).desktopAPI;
      if (api?.chatUiClipboardWrite) await api.chatUiClipboardWrite(report.markdown);
      else await navigator.clipboard.writeText(report.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { }
  }, [report.markdown]);

  const handleSave = useCallback(async () => {
    try {
      const api = (window as any).desktopAPI;
      if (!api?.chatUiPickSavePath || !api?.chatUiWriteFile) return;
      const picked = await api.chatUiPickSavePath({
        title: 'Save research report',
        defaultPath: safeFileName(report.title),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      const path = typeof picked === 'string' ? picked : picked?.path || picked?.filePath;
      if (!path) return;
      await api.chatUiWriteFile(path, report.markdown);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch { }
  }, [report]);

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Document panel */}
      <div className="relative w-full max-w-3xl h-full max-h-[88vh] flex flex-col rounded-[20px] bg-theme-bg border border-theme/15 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-theme/10 bg-theme-card/60 backdrop-blur-sm">
          <span
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[9px] ring-1 ring-inset"
            style={{
              backgroundColor: `${RESEARCH_ACCENT}14`,
              color: RESEARCH_ACCENT,
              // @ts-ignore — ring color via inline style
              ['--tw-ring-color' as any]: `${RESEARCH_ACCENT}33`,
            }}
            aria-hidden
          >
            <FileText className="w-3.5 h-3.5" strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-theme-muted/55 leading-none mb-0.5">
              Research report
            </div>
            <div className="truncate text-[13.5px] font-semibold text-theme-fg leading-tight">
              {report.title}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Copy markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={1.75} /> : <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Save as .md"
            >
              {saved ? <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={1.75} /> : <Download className="w-3.5 h-3.5" strokeWidth={1.75} />}
              {saved ? 'Saved' : 'Save .md'}
            </button>
            <span aria-hidden className="mx-0.5 w-px h-4 bg-theme/10" />
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Document body — same markdown pipeline as assistant bubbles */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="max-w-[720px] mx-auto px-6 sm:px-8 py-6 select-text break-words text-[14px]">
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
              urlTransform={(url) => url}
              components={markdownComponents}
            >
              {processCustomMarkdown(report.markdown)}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
