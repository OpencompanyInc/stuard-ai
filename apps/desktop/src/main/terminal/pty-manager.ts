import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import { TerminalSession, TerminalCreateOptions, TerminalOutputChunk } from './types';
import logger from '../utils/logger';

interface PtyEntry {
  pty: pty.IPty;
  session: TerminalSession;
  buffer: TerminalOutputChunk[];
  seq: number;
}

const MAX_BUFFER_CHUNKS = 1000;

class PtyManager {
  private sessions = new Map<string, PtyEntry>();

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private resolveShell(shell?: string): string {
    if (!shell || shell === 'auto') {
      return this.getDefaultShell();
    }

    const shellMap: Record<string, string> = {
      powershell: 'powershell.exe',
      pwsh: 'pwsh.exe',
      cmd: 'cmd.exe',
      bash: process.platform === 'win32' ? 'bash.exe' : '/bin/bash',
      zsh: '/bin/zsh',
      sh: '/bin/sh',
    };

    return shellMap[shell.toLowerCase()] || shell;
  }

  create(options: TerminalCreateOptions = {}): TerminalSession {
    const id = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shell = this.resolveShell(options.shell);
    const cwd = options.cwd || process.cwd();
    const cols = options.cols || 120;
    const rows = options.rows || 30;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
    });

    const session: TerminalSession = {
      id,
      pid: ptyProcess.pid,
      shell,
      cwd,
      title: shell.split(/[/\\]/).pop() || shell,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      cols,
      rows,
      status: 'running',
    };

    const buffer: TerminalOutputChunk[] = [];
    const entry: PtyEntry = {
      pty: ptyProcess,
      session,
      buffer,
      seq: 0,
    };

    ptyProcess.onData((data: string) => {
      session.lastActivity = Date.now();
      const chunk: TerminalOutputChunk = {
        seq: ++entry.seq,
        ts: Date.now(),
        text: data,
        stream: 'pty',
      };
      buffer.push(chunk);
      if (buffer.length > MAX_BUFFER_CHUNKS) {
        buffer.shift();
      }
      this.broadcast('terminal:data', { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      this.broadcast('terminal:exit', { sessionId: id, exitCode });
      logger.info(`Terminal ${id} exited with code ${exitCode}`);
    });

    this.sessions.set(id, entry);
    logger.info(`Created terminal ${id} with shell ${shell}`);

    return session;
  }

  write(sessionId: string, data: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.session.status !== 'running') {
      return false;
    }
    entry.pty.write(data);
    entry.session.lastActivity = Date.now();
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.session.status !== 'running') {
      return false;
    }
    entry.pty.resize(cols, rows);
    entry.session.cols = cols;
    entry.session.rows = rows;
    return true;
  }

  destroy(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }
    try {
      entry.pty.kill();
    } catch (e) {
      logger.warn(`Failed to kill terminal ${sessionId}:`, e);
    }
    this.sessions.delete(sessionId);
    logger.info(`Destroyed terminal ${sessionId}`);
    return true;
  }

  get(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId)?.session || null;
  }

  getBuffer(sessionId: string): string[] {
    const buf = this.sessions.get(sessionId)?.buffer || [];
    return buf.map(c => c.text);
  }

  /**
   * Read terminal output incrementally using a seq cursor.
   * - sinceSeq: return chunks with seq > sinceSeq
   * - maxChars: hard cap total returned text size (approx)
   */
  read(sessionId: string, sinceSeq: number = 0, maxChars: number = 8000): {
    ok: boolean;
    sessionId: string;
    seq: number;
    done: boolean;
    exitCode?: number;
    chunks: TerminalOutputChunk[];
    truncated: boolean;
  } {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return { ok: false, sessionId, seq: 0, done: false, chunks: [], truncated: false };
    }

    // Keep entry.seq in sync with the latest chunk seq
    const latestSeq = entry.buffer.length ? entry.buffer[entry.buffer.length - 1].seq : 0;
    entry.seq = Math.max(entry.seq || 0, latestSeq);

    const out: TerminalOutputChunk[] = [];
    let used = 0;
    let truncated = false;

    for (const ch of entry.buffer) {
      if (ch.seq <= (sinceSeq || 0)) continue;
      const txt = ch.text || '';
      if (!txt) continue;

      if (used + txt.length > maxChars) {
        const take = Math.max(0, maxChars - used);
        if (take > 0) {
          out.push({ ...ch, text: txt.slice(0, take) });
        }
        truncated = true;
        break;
      }

      out.push(ch);
      used += txt.length;
    }

    return {
      ok: true,
      sessionId,
      seq: entry.seq || latestSeq || 0,
      done: entry.session.status === 'exited',
      exitCode: entry.session.exitCode,
      chunks: out,
      truncated,
    };
  }

  list(): TerminalSession[] {
    return Array.from(this.sessions.values()).map(e => e.session);
  }

  private broadcast(channel: string, data: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(channel, data);
      } catch (e) {
        // Window may be closed
      }
    }
  }

  destroyAll() {
    for (const id of this.sessions.keys()) {
      this.destroy(id);
    }
  }
}

export const ptyManager = new PtyManager();
