import React, { useEffect, useRef, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { supabase } from '../lib/supabaseClient';

const CLOUD_AI_WS = ((window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082').replace(/^http/, 'ws');
const HEARTBEAT_MS = 15_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

interface CloudTerminalPanelProps {
  engine: { status: string; user_id?: string };
  className?: string;
  variant?: 'default' | 'workspace';
}

export const CloudTerminalPanel: React.FC<CloudTerminalPanelProps> = ({
  engine,
  className,
  variant = 'default',
}) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);

  const connectWs = useCallback(async (term: Terminal) => {
    if (disposedRef.current) return;

    let token = '';
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || '';
    } catch {}
    if (disposedRef.current) return;

    const wsUrl = `${CLOUD_AI_WS}/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!disposedRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal_ping', ts: Date.now() }));
        }
      }, HEARTBEAT_MS);
    };

    const scheduleReconnect = () => {
      if (disposedRef.current) return;
      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;
      const secs = Math.round(delay / 1000);
      term.write(`\r\n\x1b[90m[Reconnecting in ${secs}s...]\x1b[0m\r\n`);
      setTimeout(() => {
        if (!disposedRef.current) connectWs(term);
      }, delay);
    };

    ws.onopen = () => {
      if (disposedRef.current) { ws.close(); return; }
      startHeartbeat();
      term.write('\x1b[90mConnecting to VM terminal...\x1b[0m\r\n');
    };

    ws.onmessage = (evt) => {
      if (disposedRef.current) return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'terminal_opened') {
          setConnected(true);
          reconnectAttemptRef.current = 0;
          term.write('\x1b[90mConnected.\x1b[0m\r\n');
        } else if (msg.type === 'terminal_data' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'terminal_pong') {
          // keepalive ack
        } else if (msg.type === 'terminal_idle_timeout') {
          term.write('\r\n\x1b[90m[Session timed out — reconnecting...]\x1b[0m\r\n');
          setConnected(false);
          stopHeartbeat();
          scheduleReconnect();
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m[Error: ${msg.error || 'unknown'}]\x1b[0m\r\n`);
          setConnected(false);
        }
      } catch {}
    };

    ws.onclose = () => {
      stopHeartbeat();
      if (!disposedRef.current) {
        setConnected(false);
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      stopHeartbeat();
      if (!disposedRef.current) setConnected(false);
    };

    const sendInput = (text: string) => {
      if (!disposedRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal_data', data: text }));
      }
    };

    term.attachCustomKeyEventHandler((event) => {
      if (disposedRef.current) return true;
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

    const dataDisp = term.onData((data) => sendInput(data));
    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (!disposedRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal_resize', cols, rows }));
      }
    });

    return () => {
      stopHeartbeat();
      try { dataDisp.dispose(); } catch {}
      try { resizeDisp.dispose(); } catch {}
      try { ws.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (engine.status !== 'running' || !termRef.current) return;
    disposedRef.current = false;
    reconnectAttemptRef.current = 0;

    const themeRoot = document.documentElement;
    const computed = window.getComputedStyle(themeRoot);
    const fg = computed.getPropertyValue('--foreground').trim() || '#d4d4d4';
    const cursor = computed.getPropertyValue('--primary').trim() || '#007acc';

    const term = new Terminal({
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      cursorBlink: true,
      theme: {
        background: 'rgba(0,0,0,0.01)',
        foreground: fg,
        cursor,
        selectionBackground: cursor + '40',
      },
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => { try { webglAddon.dispose(); } catch {} });
      term.loadAddon(webglAddon);
    } catch {}

    try { fit.fit(); } catch {}
    xtermRef.current = term;
    fitRef.current = fit;

    let wsCleanup: (() => void) | undefined;
    connectWs(term).then(cleanup => { wsCleanup = cleanup; });

    const resizeObs = new ResizeObserver(() => {
      if (!disposedRef.current) try { fit.fit(); } catch {}
    });
    if (termRef.current) resizeObs.observe(termRef.current);

    return () => {
      disposedRef.current = true;
      try { resizeObs.disconnect(); } catch {}
      wsCleanup?.();
      try { wsRef.current?.close(); } catch {}
      try { term.dispose(); } catch {}
      xtermRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [engine.status, connectWs]);

  if (engine.status !== 'running') {
    return (
      <div className={clsx('flex items-center justify-center text-xs text-theme-muted', className)}>
        Start your VM to use the terminal
      </div>
    );
  }

  return (
    <div className={clsx('flex h-full flex-col', className)}>
      {variant === 'workspace' ? (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-theme-muted shrink-0">
            <div className={clsx('h-1.5 w-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
            <span>{connected ? 'Connected' : 'Reconnecting...'}</span>
          </div>
          <div ref={termRef} className="flex-1 min-h-0 px-3 pb-2" />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-2 py-1 border-b border-theme/10 shrink-0">
            <div className="flex items-center gap-1.5">
              <div className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
              <span className="text-[10px] font-medium text-theme-muted">
                {connected ? 'Connected' : 'Reconnecting...'}
              </span>
            </div>
          </div>
          <div ref={termRef} className="flex-1 min-h-0 px-1 py-1" />
        </>
      )}
    </div>
  );
};
