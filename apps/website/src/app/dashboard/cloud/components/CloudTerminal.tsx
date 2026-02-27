'use client';

import React, { useEffect, useRef } from 'react';
import { useCloudTerminal } from '@/hooks/useCloudTerminal';

interface CloudTerminalProps {
  engine: any;
}

export function CloudTerminal({ engine }: CloudTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const { connected, connect, sendData, resize, onData, close } = useCloudTerminal();

  useEffect(() => {
    if (!termRef.current || engine.status !== 'running') return;

    let term: any;
    let fitAddon: any;

    const init = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        // Import CSS
        await import('@xterm/xterm/css/xterm.css');

        term = new Terminal({
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 14,
          theme: {
            background: '#1a1b26',
            foreground: '#c0caf5',
            cursor: '#c0caf5',
          },
          cursorBlink: true,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        term.open(termRef.current!);
        fitAddon.fit();

        xtermRef.current = term;

        // Connect terminal → WS
        term.onData((data: string) => sendData(data));

        // Connect WS → terminal
        onData((data: string) => term.write(data));

        // Connect WS
        const cleanup = connect({ cols: term.cols, rows: term.rows });

        // Handle resize
        const ro = new ResizeObserver(() => {
          fitAddon.fit();
          resize(term.cols, term.rows);
        });
        ro.observe(termRef.current!);

        return () => {
          ro.disconnect();
          cleanup?.();
          term.dispose();
        };
      } catch (e) {
        console.error('Failed to initialize terminal:', e);
      }
    };

    const cleanup = init();
    return () => {
      cleanup.then(fn => fn?.());
      close();
    };
  }, [engine.status]);

  if (engine.status !== 'running') {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-2xl border border-gray-200">
        <p className="text-gray-500">Start your engine to access the terminal.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Terminal</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${
          connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div
        ref={termRef}
        className="w-full h-[500px] rounded-xl overflow-hidden border border-gray-800"
        style={{ background: '#1a1b26' }}
      />
    </div>
  );
}
