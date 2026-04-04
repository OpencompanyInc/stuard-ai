'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';
const TERMINAL_HEARTBEAT_MS = 20_000;

/**
 * WebSocket hook for cloud terminal I/O.
 */
export function useCloudTerminal() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const onDataRef = useRef<((data: string) => void) | null>(null);
  const onClosedRef = useRef<(() => void) | null>(null);

  const connect = useCallback((opts?: { cols?: number; rows?: number }) => {
    const token = localStorage.getItem('stuard_access_token');
    if (!token) return undefined;

    wsRef.current?.close();
    setConnected(false);
    setSessionId(null);

    const wsUrl = CLOUD_API_URL.replace(/^http/, 'ws') + `/terminal?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let heartbeatTimer: number | null = null;

    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminal_ping',
            ts: Date.now(),
          }));
        }
      }, TERMINAL_HEARTBEAT_MS);
    };

    ws.onopen = () => {
      // The terminal relay authenticates + opens the PTY automatically.
      // Keep these values around for future protocol expansion if needed.
      void opts;
      startHeartbeat();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'terminal_opened') {
          setConnected(true);
          setSessionId(msg.sessionId || msg.terminalId || null);
        } else if (msg.type === 'terminal_data' && onDataRef.current) {
          onDataRef.current(msg.data);
        } else if (msg.type === 'terminal_pong') {
          // Keepalive acknowledgement only.
        } else if (msg.type === 'terminal_idle_timeout' || msg.type === 'terminal_closed') {
          setConnected(false);
          onClosedRef.current?.();
        } else if (msg.type === 'error') {
          setConnected(false);
        }
      } catch {}
    };

    ws.onclose = () => {
      stopHeartbeat();
      setConnected(false);
      setSessionId(null);
      onClosedRef.current?.();
    };

    ws.onerror = () => {
      stopHeartbeat();
      setConnected(false);
    };

    return () => {
      stopHeartbeat();
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, []);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && data) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_data',
        data,
      }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_resize',
        cols,
        rows,
      }));
    }
  }, []);

  const close = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_close',
      }));
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setSessionId(null);
  }, []);

  const onData = useCallback((cb: (data: string) => void) => {
    onDataRef.current = cb;
  }, []);

  const onClosed = useCallback((cb: () => void) => {
    onClosedRef.current = cb;
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    wsRef.current?.close();
  }, []);

  return { connected, sessionId, connect, sendData, resize, close, onData, onClosed };
}
