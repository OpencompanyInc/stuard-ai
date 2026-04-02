import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
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

    // GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        try { webglAddon.dispose(); } catch {}
      });
      term.loadAddon(webglAddon);
    } catch {}

    try { fit.fit(); } catch {}
    xtermRef.current = term;
    fitRef.current = fit;

    // Connect WS to /terminal endpoint (not /ws — that's the chat handler)
    let disposed = false;
    let disposable: { dispose: () => void } | null = null;
    let resizeDisp: { dispose: () => void } | null = null;
    let resizeObs: ResizeObserver | null = null;
    // Track WS locally so cleanup can close it even if the async IIFE
    // hasn't assigned to wsRef yet.
    let localWs: WebSocket | null = null;

    /** Safe write — no-op once the terminal has been disposed. */
    const safeWrite = (data: string) => {
      if (disposed) return;
      try { term.write(data); } catch {}
    };

    (async () => {
      let token = '';
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || '';
      } catch {}
      if (disposed) return;

      // Connect to /terminal — the relay auto-opens a PTY on the VM
      const wsUrl = `${CLOUD_AI_WS}/terminal?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      localWs = ws;
      wsRef.current = ws;

      // If cleanup already ran while we were awaiting the token, close immediately.
      if (disposed) { ws.close(); return; }

      ws.onopen = () => {
        if (disposed) return;
        // Terminal relay auto-opens the PTY session on connect — no need to send terminal_open
        safeWrite('\x1b[90mConnecting to VM terminal...\x1b[0m\r\n');
      };

      ws.onmessage = (evt) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'terminal_opened') {
            setConnected(true);
            safeWrite('\x1b[90mConnected.\x1b[0m\r\n');
          } else if (msg.type === 'terminal_data' && msg.data) {
            safeWrite(msg.data);
          } else if (msg.type === 'terminal_idle_timeout') {
            safeWrite('\r\n\x1b[90m[Session timed out due to inactivity]\x1b[0m\r\n');
            setConnected(false);
          } else if (msg.type === 'error') {
            safeWrite(`\r\n\x1b[31m[Error: ${msg.error || 'unknown'}]\x1b[0m\r\n`);
            setConnected(false);
          }
        } catch {}
      };

      ws.onclose = () => { if (!disposed) setConnected(false); };
      ws.onerror = () => { if (!disposed) setConnected(false); };

      // Clipboard: Ctrl+V paste, Ctrl+C copy (when selected), right-click paste
      const sendInput = (text: string) => {
        if (!disposed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal_data', data: text }));
        }
      };

      term.attachCustomKeyEventHandler((event) => {
        if (disposed) return true;
        const isMod = event.ctrlKey || event.metaKey;
        if (isMod && event.key === 'v' && event.type === 'keydown') {
          navigator.clipboard.readText().then(text => { if (text) sendInput(text); });
          return false;
        }
        if (isMod && event.key === 'c' && event.type === 'keydown' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        return true;
      });

      if (termRef.current) {
        termRef.current.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          navigator.clipboard.readText().then(text => { if (text) sendInput(text); });
        });
      }

      disposable = term.onData((data) => {
        sendInput(data);
      });

      resizeObs = new ResizeObserver(() => {
        if (disposed) return;
        try { fit.fit(); } catch {}
      });
      if (termRef.current) resizeObs.observe(termRef.current);

      resizeDisp = term.onResize(({ cols, rows }) => {
        if (!disposed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal_resize', cols, rows }));
        }
      });
    })();

    return () => {
      disposed = true;
      try { disposable?.dispose(); } catch {}
      try { resizeDisp?.dispose(); } catch {}
      try { resizeObs?.disconnect(); } catch {}
      // Close both the ref and the local reference (covers the race where
      // the async IIFE assigned to localWs but not yet to wsRef).
      try { localWs?.close(); } catch {}
      try { wsRef.current?.close(); } catch {}
      // Wrap term.dispose() — WebglAddon can throw _isDisposed errors
      // during cleanup which propagate to React's error boundary.
      try { term.dispose(); } catch {}
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
