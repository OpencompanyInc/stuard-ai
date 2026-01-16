import { ipcMain } from 'electron';
import { ptyManager } from './pty-manager';
import { TerminalCreateOptions } from './types';

export function setupTerminalIpc() {
  // Create new terminal session
  ipcMain.handle('terminal:create', (_e, options?: TerminalCreateOptions) => {
    try {
      const session = ptyManager.create(options);
      return { ok: true, session };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'create_failed';
      return { ok: false, error: message };
    }
  });

  // Write data to terminal (keyboard input)
  ipcMain.handle('terminal:write', (_e, sessionId: string, data: string) => {
    try {
      const ok = ptyManager.write(sessionId, data);
      return { ok };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'write_failed';
      return { ok: false, error: message };
    }
  });

  // Resize terminal
  ipcMain.handle('terminal:resize', (_e, sessionId: string, cols: number, rows: number) => {
    try {
      const ok = ptyManager.resize(sessionId, cols, rows);
      return { ok };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'resize_failed';
      return { ok: false, error: message };
    }
  });

  // Destroy terminal session
  ipcMain.handle('terminal:destroy', (_e, sessionId: string) => {
    try {
      const ok = ptyManager.destroy(sessionId);
      return { ok };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'destroy_failed';
      return { ok: false, error: message };
    }
  });

  // Get session info
  ipcMain.handle('terminal:get', (_e, sessionId: string) => {
    try {
      const session = ptyManager.get(sessionId);
      return { ok: !!session, session };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'get_failed';
      return { ok: false, error: message };
    }
  });

  // Get buffered output (for reconnection)
  ipcMain.handle('terminal:getBuffer', (_e, sessionId: string) => {
    try {
      const buffer = ptyManager.getBuffer(sessionId);
      return { ok: true, buffer };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'getBuffer_failed';
      return { ok: false, error: message };
    }
  });

  // List all sessions
  ipcMain.handle('terminal:list', () => {
    try {
      const sessions = ptyManager.list();
      return { ok: true, sessions };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'list_failed';
      return { ok: false, error: message };
    }
  });

  // AI-initiated write (adds carriage return for command execution - PTY uses \r, not \n)
  ipcMain.handle('terminal:aiWrite', (_e, sessionId: string, input: string) => {
    try {
      const data = input.endsWith('\r') ? input : input + '\r';
      const ok = ptyManager.write(sessionId, data);
      return { ok };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'aiWrite_failed';
      return { ok: false, error: message };
    }
  });
}
