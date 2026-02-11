import { ptyManager } from '../../terminal';
import { RouterContext } from '../types';

export async function execTerminalCreate(args: any, ctx: RouterContext): Promise<any> {
  try {
    const session = ptyManager.create({
      shell: args?.shell,
      cwd: args?.cwd,
      env: args?.env,
      cols: args?.cols,
      rows: args?.rows,
    });
    ctx.logFn(`🖥️ Created terminal: ${session.id} (${session.shell})`);
    return { ok: true, session };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_create_failed' };
  }
}

export async function execTerminalList(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessions = ptyManager.list();
    return { ok: true, sessions };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_list_failed' };
  }
}

export async function execTerminalGet(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    const session = ptyManager.get(sessionId);
    if (!session) return { ok: false, error: 'session_not_found' };
    return { ok: true, session };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_get_failed' };
  }
}

export async function execTerminalSendInput(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    const input = String(args?.input || args?.text || args?.data || '');
    const enter = args?.enter !== false; // Default to true
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    if (!input && enter === false) return { ok: false, error: 'missing_input' };
    
    // Add carriage return if requested (PTY uses \r for Enter, not \n)
    const data = enter ? (input.endsWith('\r') ? input : input + '\r') : input;
    const success = ptyManager.write(sessionId, data);
    if (!success) return { ok: false, error: 'write_failed_or_session_not_running' };
    ctx.logFn(`⌨️ Sent ${enter ? 'command' : 'input'} to terminal ${sessionId}: ${input.slice(0, 50)}${input.length > 50 ? '...' : ''}`);
    return { ok: true, sessionId, inputLength: data.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_send_input_failed' };
  }
}

export async function execTerminalSendRaw(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    const data = String(args?.data ?? args?.input ?? args?.text ?? '');
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    if (data.length === 0) return { ok: false, error: 'missing_data' };
    const success = ptyManager.write(sessionId, data);
    if (!success) return { ok: false, error: 'write_failed_or_session_not_running' };
    ctx.logFn(`⌨️ Sent raw input to terminal ${sessionId} (${data.length} chars)`);
    return { ok: true, sessionId, length: data.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_send_raw_failed' };
  }
}

export async function execTerminalSendKeys(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    const keys = args?.keys ?? args?.key ?? args?.sequence;
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    if (!keys) return { ok: false, error: 'missing_keys' };

    const normalize = (k: string) => String(k || '').trim().toLowerCase();
    const toSeq = (k: string): string => {
      const nk = normalize(k);
      if (nk === 'enter' || nk === 'return') return '\r';
      if (nk === 'tab') return '\t';
      if (nk === 'escape' || nk === 'esc') return '\x1b';
      if (nk === 'backspace') return '\x7f';
      if (nk === 'ctrl+c' || nk === 'control+c') return '\x03';
      if (nk === 'ctrl+d' || nk === 'control+d') return '\x04';
      if (nk === 'ctrl+z' || nk === 'control+z') return '\x1a';
      if (nk === 'ctrl+l' || nk === 'control+l') return '\x0c';
      if (nk === 'arrowup' || nk === 'up') return '\x1b[A';
      if (nk === 'arrowdown' || nk === 'down') return '\x1b[B';
      if (nk === 'arrowright' || nk === 'right') return '\x1b[C';
      if (nk === 'arrowleft' || nk === 'left') return '\x1b[D';
      if (nk === 'home') return '\x1b[H';
      if (nk === 'end') return '\x1b[F';
      if (nk === 'pageup') return '\x1b[5~';
      if (nk === 'pagedown') return '\x1b[6~';
      // Fallback: allow raw escape sequences if user passes them
      return k;
    };

    const seq = Array.isArray(keys)
      ? keys.map(k => toSeq(String(k))).join('')
      : toSeq(String(keys));

    if (!seq) return { ok: false, error: 'empty_sequence' };
    const success = ptyManager.write(sessionId, seq);
    if (!success) return { ok: false, error: 'write_failed_or_session_not_running' };
    ctx.logFn(`⌨️ Sent keys to terminal ${sessionId}: ${Array.isArray(keys) ? keys.join(', ') : String(keys)}`);
    return { ok: true, sessionId };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_send_keys_failed' };
  }
}

export async function execTerminalRead(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    const sinceSeq = Number(args?.sinceSeq ?? args?.since_seq ?? args?.since ?? 0) || 0;
    const maxChars = Math.max(0, Number(args?.maxChars ?? args?.max_chars ?? args?.max ?? 8000) || 8000);
    const stripAnsi = args?.stripAnsi !== false;
    if (!sessionId) return { ok: false, error: 'missing_session_id' };

    const res = ptyManager.read(sessionId, sinceSeq, maxChars);
    if (!res.ok) return { ok: false, error: 'session_not_found', sessionId };

    const strip = (s: string) => {
      // Basic ANSI escape stripping for AI readability (keeps plain text)
      // Covers CSI, OSC, and a few common sequences.
      return String(s || '')
        .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '') // OSC ... BEL or ST
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')   // CSI ... cmd
        .replace(/\x1b[\(\)][0-9A-Za-z]/g, '')       // Charset select
        .replace(/\r/g, '\n');                       // Normalize CR to LF
    };

    const chunks = res.chunks.map(c => ({
      seq: c.seq,
      ts: c.ts,
      stream: c.stream,
      text: stripAnsi ? strip(c.text) : c.text,
      raw: c.text,
    }));

    return {
      ok: true,
      sessionId,
      done: res.done,
      exitCode: res.exitCode,
      seq: res.seq,
      truncated: res.truncated,
      chunks,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_read_failed' };
  }
}

export async function execTerminalWaitFor(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    const needle = String(args?.text ?? args?.needle ?? args?.contains ?? '');
    const timeoutMs = Math.max(0, Number(args?.timeoutMs ?? args?.timeout_ms ?? 15000) || 15000);
    const pollMs = Math.max(50, Number(args?.pollMs ?? args?.poll_ms ?? 200) || 200);
    const maxChars = Math.max(0, Number(args?.maxChars ?? 8000) || 8000);
    const stripAnsi = args?.stripAnsi !== false;
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    if (!needle) return { ok: false, error: 'missing_text' };

    const start = Date.now();
    let sinceSeq = Number(args?.sinceSeq ?? 0) || 0;
    let collected = '';
    while (Date.now() - start < timeoutMs) {
      const r = ptyManager.read(sessionId, sinceSeq, maxChars);
      if (!r.ok) return { ok: false, error: 'session_not_found', sessionId };

      const pieces = r.chunks.map(c => c.text || '').join('');
      const text = stripAnsi
        ? pieces
            .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
            .replace(/\x1b[\(\)][0-9A-Za-z]/g, '')
            .replace(/\r/g, '\n')
        : pieces;

      if (text) collected += text;
      sinceSeq = r.seq || sinceSeq;

      if (collected.includes(needle)) {
        return { ok: true, sessionId, matched: true, needle, seq: sinceSeq, done: r.done, exitCode: r.exitCode };
      }
      if (r.done) {
        return { ok: true, sessionId, matched: collected.includes(needle), needle, seq: sinceSeq, done: true, exitCode: r.exitCode };
      }

      await new Promise(r2 => setTimeout(r2, pollMs));
    }

    return { ok: true, sessionId, matched: collected.includes(needle), needle, timeout: true, seq: sinceSeq };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_wait_for_failed' };
  }
}

export async function execTerminalDestroy(args: any, ctx: RouterContext): Promise<any> {
  try {
    const sessionId = String(args?.sessionId || args?.session_id || args?.id || '');
    if (!sessionId) return { ok: false, error: 'missing_session_id' };
    const success = ptyManager.destroy(sessionId);
    ctx.logFn(`🗑️ Destroyed terminal: ${sessionId}`);
    return { ok: true, destroyed: success };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'terminal_destroy_failed' };
  }
}

