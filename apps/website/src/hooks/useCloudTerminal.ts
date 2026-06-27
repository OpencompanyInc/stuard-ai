'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getCloudAccessToken } from '@/lib/cloudApi';
import { resolveBrowserCloudApiOrigin } from '@/lib/cloudApiBase';

const TERMINAL_HEARTBEAT_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type TerminalConnectOptions = { cols?: number; rows?: number };

/**
 * WebSocket hook for cloud terminal I/O.
 */
export function useCloudTerminal() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [idleTimedOut, setIdleTimedOut] = useState(false);
  const onDataRef = useRef<((data: string) => void) | null>(null);
  const onClosedRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const optsRef = useRef<TerminalConnectOptions | undefined>(undefined);
  const stoppedRef = useRef(false);
  const openSocketRef = useRef<((opts?: TerminalConnectOptions) => Promise<void>) | null>(null);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const openSocket = useCallback(async (opts?: TerminalConnectOptions) => {
    const token = await getCloudAccessToken();
    if (!token) return;

    optsRef.current = opts;

    wsRef.current?.close();
    setConnected(false);
    setSessionId(null);

    const wsUrl = resolveBrowserCloudApiOrigin().replace(/^http/, 'ws') + `/terminal?token=${encodeURIComponent(token)}`;
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
      void opts;
      // A clean open resets the backoff counter so any future drop starts fresh.
      reconnectAttemptsRef.current = 0;
      setIdleTimedOut(false);
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
        } else if (msg.type === 'terminal_idle_timeout') {
          // Server closed us for inactivity — don't auto-reconnect. Let the
          // UI show "Session idle" and wait for a user gesture.
          setIdleTimedOut(true);
          stoppedRef.current = true;
          setConnected(false);
          onClosedRef.current?.();
        } else if (msg.type === 'terminal_closed') {
          setConnected(false);
          onClosedRef.current?.();
        } else if (msg.type === 'error') {
          setConnected(false);
        }
      } catch {}
    };

    const scheduleReconnect = () => {
      if (stoppedRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      reconnectAttemptsRef.current = attempt + 1;
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void openSocketRef.current?.(optsRef.current);
      }, delay);
    };

    ws.onclose = () => {
      stopHeartbeat();
      setConnected(false);
      setSessionId(null);
      onClosedRef.current?.();
      if (!stoppedRef.current) scheduleReconnect();
    };

    ws.onerror = () => {
      stopHeartbeat();
      setConnected(false);
    };
  }, []);
  useEffect(() => {
    openSocketRef.current = openSocket;
  }, [openSocket]);

  const connect = useCallback((opts?: TerminalConnectOptions) => {
    stoppedRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    void openSocket(opts);
    return () => {
      stoppedRef.current = true;
      clearReconnectTimer();
      wsRef.current?.close();
      if (wsRef.current) wsRef.current = null;
    };
  }, [openSocket]);

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
    stoppedRef.current = true;
    clearReconnectTimer();
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
    stoppedRef.current = true;
    clearReconnectTimer();
    wsRef.current?.close();
  }, []);

  return { connected, sessionId, idleTimedOut, connect, sendData, resize, close, onData, onClosed };
}
