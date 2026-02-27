import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_WS = ((window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082').replace(/^http/, 'ws');

interface CloudTerminalPanelProps {
  engine: { status: string; user_id?: string };
  className?: string;
}

export const CloudTerminalPanel: React.FC<CloudTerminalPanelProps> = ({ engine, className }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (engine.status !== 'running' || !termRef.current) return;

    // Init xterm
    const term = new Terminal({
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      cursorBlink: true,
      theme: {
        background: 'transparent',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    // Connect WS
    let disposed = false;
    let disposable: { dispose: () => void } | null = null;
    let resizeDisp: { dispose: () => void } | null = null;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      let token = '';
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}
      if (disposed) return;

      const wsUrl = `${CLOUD_AI_WS}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ kind: 'terminal_open', shell: '/bin/bash' }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.kind === 'terminal_output' && msg.data) {
            term.write(msg.data);
          } else if (msg.kind === 'terminal_closed') {
            term.write('\r\n\x1b[90m[Session ended]\x1b[0m\r\n');
            setConnected(false);
          }
        } catch {}
      };

      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);

      disposable = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: 'terminal_data', data }));
        }
      });

      const onResize = () => { fit.fit(); };
      resizeObs = new ResizeObserver(onResize);
      if (termRef.current) resizeObs.observe(termRef.current);

      resizeDisp = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ kind: 'terminal_resize', cols, rows }));
        }
      });
    })();

    return () => {
      disposed = true;
      disposable?.dispose();
      resizeDisp?.dispose();
      resizeObs?.disconnect();
      wsRef.current?.close();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [engine.status]);

  if (engine.status !== 'running') {
    return (
      <div className={clsx('flex items-center justify-center text-xs text-theme-muted', className)}>
        Start your VM to use the terminal
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-2 py-1 border-b border-theme/10 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
          <span className="text-[10px] font-medium text-theme-muted">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
      <div ref={termRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  );
};
