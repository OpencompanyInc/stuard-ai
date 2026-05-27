'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import type { ToolCall } from '@stuardai/chat-ui/types';

/**
 * Web-friendly inline renderer for the `chat_ui` GenUI tool.
 *
 * The desktop sandboxes a full React app inside an iframe; on the web we just
 * render a clean status card showing the component name + title + a JSON
 * payload preview, plus the result once the agent finishes.
 */
export function ChatUiBlock({ tool }: { tool: ToolCall }) {
  const [showRaw, setShowRaw] = useState(false);

  const args = (tool.args || {}) as Record<string, any>;
  const component = String(args.component || args.name || 'chat_ui');
  const title = String(args.title || args.label || '').trim();
  const description = String(args.description || args.subtitle || '').trim();
  const data = args.data ?? args.props ?? null;

  const isCompleted = tool.status === 'completed';
  const isError = tool.status === 'error';

  const previewJson = useMemo(() => {
    try {
      return JSON.stringify(data ?? args, null, 2);
    } catch {
      return String(data ?? args);
    }
  }, [args, data]);

  const resultJson = useMemo(() => {
    if (tool.result == null) return '';
    try {
      return JSON.stringify(tool.result, null, 2);
    } catch {
      return String(tool.result);
    }
  }, [tool.result]);

  return (
    <div
      className="overflow-hidden rounded-2xl border border-theme bg-theme-card shadow-sm"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 border-b border-theme px-3 py-2">
        <Sparkles
          className="h-4 w-4 shrink-0"
          style={{ color: 'var(--primary)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-theme-fg">
            {title || component}
          </div>
          {description ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] text-theme-muted">
              {description}
            </div>
          ) : null}
        </div>
        <span
          className="shrink-0 rounded-full border border-theme/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-theme-muted"
        >
          {component}
        </span>
      </div>

      <div className="px-3 py-3">
        {!isCompleted && !isError ? (
          <div className="text-[12px] leading-relaxed text-theme-muted">
            Interactive UI requested by the agent. The full rich widget is only
            rendered in the desktop app — here, you can inspect the request and
            response payloads.
          </div>
        ) : null}

        {isError ? (
          <div
            className="rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--destructive, #ef4444) 8%, transparent)',
              color: 'var(--destructive, #ef4444)',
            }}
          >
            {typeof tool.error === 'string'
              ? tool.error
              : JSON.stringify(tool.error || 'chat_ui failed', null, 2)}
          </div>
        ) : null}

        {isCompleted && resultJson ? (
          <div
            className="rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
              color: 'color-mix(in srgb, var(--foreground) 80%, transparent)',
            }}
          >
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-theme-muted">
              Result
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
              {resultJson}
            </pre>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 rounded-md text-[11px] font-medium text-theme-muted transition-colors hover:text-theme-fg"
        >
          <ChevronRight
            className={clsx(
              'h-3 w-3 transition-transform duration-150',
              showRaw && 'rotate-90',
            )}
          />
          {showRaw ? 'Hide payload' : 'Show payload'}
        </button>

        {showRaw ? (
          <div
            className="mt-2 max-h-48 overflow-auto rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 25%, transparent)',
              color: 'color-mix(in srgb, var(--foreground) 75%, transparent)',
            }}
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {previewJson}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ChatUiBlock;
