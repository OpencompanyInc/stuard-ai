'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL || 'https://api.stuard.ai';

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
    if (!token) return;

    const wsUrl = CLOUD_API_URL.replace(/^http/, 'ws') + '/ws?client=desktop';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        auth: { accessToken: token },
      }));
      // Open terminal
      ws.send(JSON.stringify({
        type: 'terminal_open',
        cols: opts?.cols || 80,
        rows: opts?.rows || 24,
      }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'terminal_output' && onDataRef.current) {
          onDataRef.current(msg.data);
          if (!sessionId && msg.sessionId) setSessionId(msg.sessionId);
        }
        if (msg.type === 'command_result' && msg.result?.sessionId) {
          setSessionId(msg.result.sessionId);
        }
        if (msg.type === 'terminal_closed') {
          onClosedRef.current?.();
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      setSessionId(null);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_data',
        sessionId,
        data,
      }));
    }
  }, [sessionId]);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_resize',
        sessionId,
        cols,
        rows,
      }));
    }
  }, [sessionId]);

  const close = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal_close',
        sessionId,
      }));
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setSessionId(null);
  }, [sessionId]);

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
