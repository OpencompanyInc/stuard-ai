import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export interface XTerminalProps {
  sessionId: string;
  onResize?: (cols: number, rows: number) => void;
  className?: string;
}

export interface XTerminalRef {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
}

export const XTerminal = forwardRef<XTerminalRef, XTerminalProps>(({
  sessionId,
  onResize,
  className
}, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onResizeRef = useRef(onResize);
  const lastSizeRef = useRef<string>('');
  onResizeRef.current = onResize;

  // Initialize terminal
  useEffect(() => {
    const terminalElement = terminalRef.current;
    if (!terminalElement) return;

    let disposed = false;
    let initialFitTimer: number | null = null;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, "DejaVu Sans Mono", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#569cd6',
        cursorAccent: '#1e1e1e',
        selectionBackground: 'rgba(38, 79, 120, 0.5)',
        black: '#000000',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#d7ba7d',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4fc1ff',
        white: '#cccccc',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#b5cea8',
        brightYellow: '#d7ba7d',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#9cdcfe',
        brightWhite: '#ffffff',
      },
      scrollback: 10000,
      allowProposedApi: true,
      windowOptions: {
        setWinSizeChars: true,
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    lastSizeRef.current = '';

    term.open(terminalElement);

    // Clipboard: Ctrl+V paste, Ctrl+C copy (when selected), right-click paste
    term.attachCustomKeyEventHandler((event) => {
      const isMod = event.ctrlKey || event.metaKey;
      if (isMod && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            // Bracket paste mode for proper multi-line handling
            (window as any).desktopAPI?.terminalWrite?.(sessionId, text);
          }
        });
        return false;
      }
      if (isMod && event.key === 'c' && event.type === 'keydown' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      return true;
    });

    // Right-click paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) {
          (window as any).desktopAPI?.terminalWrite?.(sessionId, text);
        }
      });
    };
    terminalElement.addEventListener('contextmenu', handleContextMenu);

    // Handle user input -> send to main process
    term.onData((data) => {
      (window as any).desktopAPI?.terminalWrite?.(sessionId, data);
    });

    const notifyResize = () => {
      const currentTerm = xtermRef.current;
      if (!currentTerm) return;

      const nextSize = `${currentTerm.cols}x${currentTerm.rows}`;
      if (nextSize === lastSizeRef.current) return;

      lastSizeRef.current = nextSize;
      onResizeRef.current?.(currentTerm.cols, currentTerm.rows);
    };

    const fitTerminal = () => {
      const currentTerm = xtermRef.current;
      const currentFitAddon = fitAddonRef.current;
      if (disposed || !currentTerm || !currentFitAddon || !terminalElement.isConnected) return false;
      if (terminalElement.clientWidth === 0 || terminalElement.clientHeight === 0) return false;

      try {
        currentFitAddon.fit();
        notifyResize();
        return true;
      } catch {
        // xterm can throw if a resize races with disposal.
        return false;
      }
    };

    const scheduleInitialFit = (attemptsRemaining: number) => {
      if (disposed) return;
      if (fitTerminal() || attemptsRemaining <= 0) return;
      initialFitTimer = window.setTimeout(() => {
        scheduleInitialFit(attemptsRemaining - 1);
      }, 50);
    };

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal();
    });
    resizeObserver.observe(terminalElement);

    scheduleInitialFit(10);

    return () => {
      disposed = true;
      if (initialFitTimer !== null) {
        window.clearTimeout(initialFitTimer);
      }
      resizeObserver.disconnect();
      terminalElement.removeEventListener('contextmenu', handleContextMenu);
      xtermRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [sessionId]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    write: (data: string) => xtermRef.current?.write(data),
    clear: () => xtermRef.current?.clear(),
    focus: () => xtermRef.current?.focus(),
    fit: () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit requests that land during disposal.
      }
    },
  }), []);

  return (
    <div
      ref={terminalRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
    />
  );
});

XTerminal.displayName = 'XTerminal';
