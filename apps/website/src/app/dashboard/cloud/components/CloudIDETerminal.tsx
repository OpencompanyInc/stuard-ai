'use client';

import React, { useEffect, useRef } from 'react';
import { useCloudTerminal } from '@/hooks/useCloudTerminal';

export function CloudIDETerminal({ isRunning }: { isRunning: boolean }) {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const { connect, sendData, resize, onData, close } = useCloudTerminal();

  useEffect(() => {
    if (!termContainerRef.current || !isRunning) return;
    let term: any;
    let fitAddon: { fit: () => void };
    let ro: ResizeObserver | null = null;
    let disposeInput: { dispose: () => void } | undefined;
    let disposeWs: (() => void) | undefined;
    let disposed = false;

    const init = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');
        await import('@xterm/xterm/css/xterm.css');
        if (disposed) return;
        term = new Terminal({
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 13,
          theme: {
            background: '#0f172a',
            foreground: '#e2e8f0',
            cursor: '#e2e8f0',
            cursorAccent: '#0f172a',
            selectionBackground: 'rgba(0, 122, 255, 0.35)',
          },
          cursorBlink: true,
        }) as typeof term;
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(termContainerRef.current!);
        fitAddon.fit();
        disposeInput = term.onData((data: string) => sendData(data));
        onData((data: string) => term.write(data));
        disposeWs = connect({ cols: term.cols, rows: term.rows });
        ro = new ResizeObserver(() => {
          if (!disposed) {
            fitAddon.fit();
            resize(term.cols, term.rows);
          }
        });
        ro.observe(termContainerRef.current!);
      } catch (error) {
        if (!disposed) console.error('Terminal init failed:', error);
      }
    };

    void init();
    return () => {
      disposed = true;
      ro?.disconnect();
      disposeInput?.dispose();
      disposeWs?.();
      term?.dispose();
      close();
    };
  }, [isRunning, close, connect, onData, resize, sendData]);

  return <div ref={termContainerRef} className="ide-terminal-body h-full w-full" />;
}
