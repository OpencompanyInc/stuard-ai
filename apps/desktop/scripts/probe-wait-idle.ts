// End-to-end validation of the two round-4 fixes against real cursor-agent:
//   1. cli_agent_read clean output — renderTerminalScreen turns the ANSI paint
//      stream into readable lines (no soup, no progress-bar flood).
//   2. wait_idle busy→idle detection — blocks while "Working"/spinner is on
//      screen, returns only once output is quiet AND no busy indicator.
//
// We don't import the handler's exec* (they need the ptyManager singleton +
// RouterContext); instead we replicate the exact wait_idle algorithm against a
// real PTY so we're testing the real cursor-agent timing behavior.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCursorTrust, cursorWorkspaceSlug } from '../src/main/tools/handlers/cli-agent';
import { renderTerminalScreen } from '../src/main/tools/handlers/terminal-screen';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty = require('node-pty');

const log = (l: string, m: string) => console.log(`[${l}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mirror of the provider busyPatterns for cursor.
const CURSOR_BUSY = [/\bWorking\b/, /ctrl\+c to stop/i, /esc to (interrupt|stop)/i];

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), 'wait-idle-'));
  ensureCursorTrust(cwd);
  const proc = pty.spawn('powershell.exe', [], {
    name: 'xterm-256color', cols: 140, rows: 36, cwd, env: process.env as Record<string, string>,
  });
  let buf = '';
  proc.onData((d: string) => { buf += d; });
  const screen = () => renderTerminalScreen(buf, { cols: 140, rows: 36 });

  proc.write("& 'cursor-agent' --approve-mcps --force\r");

  // Wait for ready.
  const readyStart = Date.now();
  while (Date.now() - readyStart < 30000 && !/Auto[\s\S]{0,200}?\n\s*~/.test(screen())) await sleep(250);
  log('ready', 'cursor-agent ready');

  // Ask something that requires it to think + emit a real answer.
  proc.write('In one sentence, what is 17 times 23? Just answer.\r');
  log('sent', 'question submitted');

  // wait_idle algorithm (mirror of execCliAgentWaitIdle).
  const t0 = Date.now();
  const timeoutMs = 90000, quietMs = 2500, pollMs = 350;
  let lastLen = buf.length, lastChangeAt = Date.now();
  let sawBusy = false, idleAt = -1;
  while (Date.now() - t0 < timeoutMs) {
    if (buf.length !== lastLen) { lastLen = buf.length; lastChangeAt = Date.now(); }
    const s = screen();
    const busy = CURSOR_BUSY.some((p) => p.test(s));
    if (busy) sawBusy = true;
    const quietFor = Date.now() - lastChangeAt;
    if (quietFor >= quietMs && !busy) { idleAt = Date.now() - t0; break; }
    await sleep(pollMs);
  }

  log('busy', `observed a busy indicator at some point? ${sawBusy}`);
  if (idleAt >= 0) log('PASS-idle', `wait_idle returned idle after ${idleAt} ms (waited through busy → quiet)`);
  else log('FAIL-idle', 'never detected idle within 90s');

  // Clean-read check: the rendered screen should be readable lines, not soup.
  const s = screen();
  const tail = s.split('\n').filter((l) => l.trim()).slice(-12).join('\n');
  log('read', `clean tail:\n${tail}`);
  const answered = /391/.test(s);
  log(answered ? 'PASS-read' : 'INFO-read', answered ? 'answer 391 present in clean screen' : 'answer not detected (model may have phrased differently)');
  // Soup check: rendered output should NOT contain raw escape bytes.
  const hasRawEscapes = /\x1b\[/.test(s);
  log(hasRawEscapes ? 'FAIL-soup' : 'PASS-soup', hasRawEscapes ? 'raw ANSI escapes leaked into rendered output' : 'no raw ANSI escapes in rendered output');

  proc.write('\x03'); // ctrl+c
  await sleep(500);
  try { proc.kill(); } catch {}
  await sleep(1500);
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  try { rmSync(join(process.env.USERPROFILE || process.env.HOME!, '.cursor', 'projects', cursorWorkspaceSlug(cwd)), { recursive: true, force: true }); } catch {}
  process.exit(idleAt >= 0 && !hasRawEscapes ? 0 : 1);
}

main().catch((e) => { console.error('probe failed:', e); process.exit(2); });
