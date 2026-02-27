/**
 * VM Agent — Shell Executor
 * 
 * Manages PTY sessions on the VM for terminal access.
 * Uses node-pty for pseudo-terminal support.
 */

import { EventEmitter } from 'events';

export interface PtySession {
  id: string;
  pid: number;
  cols: number;
  rows: number;
}

export interface ShellExecutorEvents {
  output: (sessionId: string, data: string) => void;
  exit: (sessionId: string, exitCode: number) => void;
}

export class ShellExecutor extends EventEmitter {
  private sessions = new Map<string, any>(); // sessionId → pty instance
  private outputBuffers = new Map<string, string[]>(); // sessionId → buffered output chunks
  private pty: any = null;

  constructor() {
    super();
  }

  private async getPty() {
    if (this.pty) return this.pty;
    try {
      this.pty = require('node-pty');
    } catch {
      // Fallback: try dynamic import
      this.pty = await import('node-pty');
    }
    return this.pty;
  }

  async create(sessionId: string, cols = 80, rows = 24, cwd?: string): Promise<PtySession> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const pty = await this.getPty();
    const shell = process.env.SHELL || '/bin/bash';

    const instance = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || '/home',
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.sessions.set(sessionId, instance);
    this.outputBuffers.set(sessionId, []);

    instance.onData((data: string) => {
      // Buffer output for HTTP polling
      const buf = this.outputBuffers.get(sessionId);
      if (buf) buf.push(data);
      this.emit('output', sessionId, data);
    });

    instance.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(sessionId);
      this.outputBuffers.delete(sessionId);
      this.emit('exit', sessionId, exitCode);
    });

    return {
      id: sessionId,
      pid: instance.pid,
      cols,
      rows,
    };
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.write(data);
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      session.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read and flush the output buffer for a session (for HTTP polling).
   */
  readBuffer(sessionId: string): string {
    const buf = this.outputBuffers.get(sessionId);
    if (!buf || buf.length === 0) return '';
    const data = buf.join('');
    buf.length = 0;
    return data;
  }

  destroy(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      session.kill();
    } catch {}
    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    return true;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }
}
