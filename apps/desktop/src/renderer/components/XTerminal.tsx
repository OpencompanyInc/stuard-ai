import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
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

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

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
      screenReaderMode: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    // GPU-accelerated rendering via WebGL
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available, falls back to canvas renderer
    }

    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

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
    terminalRef.current.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) {
          (window as any).desktopAPI?.terminalWrite?.(sessionId, text);
        }
      });
    });

    // Handle user input -> send to main process
    term.onData((data) => {
      (window as any).desktopAPI?.terminalWrite?.(sessionId, data);
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        if (onResize) {
          onResize(xtermRef.current.cols, xtermRef.current.rows);
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    // Initial resize notification
    setTimeout(() => {
      handleResize();
    }, 100);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, onResize]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    write: (data: string) => xtermRef.current?.write(data),
    clear: () => xtermRef.current?.clear(),
    focus: () => xtermRef.current?.focus(),
    fit: () => fitAddonRef.current?.fit(),
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
