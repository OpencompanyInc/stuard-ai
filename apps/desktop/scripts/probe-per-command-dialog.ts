// Focused probe: when cursor-agent shows its per-command approval dialog,
// do PTY keystrokes actually reach it? The live transcript hinted that
// `y`/Enter/Tab were ignored — but `ok:true` on the write and a static seq
// could mean either (a) the bytes were dropped before cursor-agent read
// them, or (b) cursor-agent received them but its dialog handler ignored
// them, or (c) the dialog re-rendered identically so the seq looks frozen
// from the outside. This probe distinguishes the three.
//
// Strategy: launch WITHOUT --force so the dialog actually fires. Submit a
// prompt that will trigger a shell command (`run pwd`). Wait for the
// dialog. Then try each candidate keystroke ONE AT A TIME with full
// reconciliation between attempts:
//   1. Snapshot pre-key state (buffer length, last 200 chars visible).
//   2. Send key.
//   3. Wait up to 3 s for ANY new bytes.
//   4. Snapshot post-key state. Compare.
//   5. Decide: "key worked" (dialog gone) / "key noticed" (re-render, dialog still there) / "key ignored" (no bytes).
//
// Run:  pnpm tsx scripts/probe-per-command-dialog.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCarriageReturns,
  collapseToVisibleFrame,
  cursorWorkspaceSlug,
  ensureCursorTrust,
  encodeKey,
} from '../src/main/tools/handlers/cli-agent';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty = require('node-pty');

const log = (label: string, msg: string) => console.log(`[${label}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function strip(text: string): string {
  return applyCarriageReturns(
    String(text || '')
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[\(\)][0-9A-Za-z]/g, ''),
  );
}

function visibleTail(buf: string, n = 600): string {
  return strip(collapseToVisibleFrame(buf)).slice(-n);
}

async function waitForRegex(getBuf: () => string, re: RegExp, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (re.test(visibleTail(getBuf(), 4000))) return true;
    await sleep(150);
  }
  return false;
}

async function probeKey(
  proc: any,
  getBuf: () => string,
  label: string,
  encoded: string,
): Promise<{ verdict: 'worked' | 'noticed' | 'ignored'; tail: string }> {
  const pre = getBuf().length;
  const preTail = visibleTail(getBuf(), 200);
  proc.write(encoded);
  await sleep(2500);
  const post = getBuf().length;
  const postTail = visibleTail(getBuf(), 200);
  const newBytes = post - pre;
  const dialogStillThere = /Not in allowlist|Run this command\?/.test(postTail);
  let verdict: 'worked' | 'noticed' | 'ignored';
  if (newBytes === 0) verdict = 'ignored';
  else if (!dialogStillThere) verdict = 'worked';
  else verdict = 'noticed';
  log(label, `bytes=${newBytes}  verdict=${verdict}`);
  if (verdict === 'noticed') {
    log(label, `tail diff: ${JSON.stringify(preTail.slice(-80))} → ${JSON.stringify(postTail.slice(-80))}`);
  }
  return { verdict, tail: postTail };
}

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), 'percmd-probe-'));
  ensureCursorTrust(cwd);

  // Launch WITHOUT --force — we want the per-command dialog to appear.
  const proc = pty.spawn('powershell.exe', [], {
    name: 'xterm-256color', cols: 140, rows: 36, cwd,
    env: process.env as Record<string, string>,
  });
  let buf = '';
  proc.onData((d: string) => { buf += d; });
  const getBuf = () => buf;
  proc.write("& 'cursor-agent' --approve-mcps\r");

  // Wait for ready, then submit a prompt that will trigger a shell command.
  const ready = await waitForRegex(getBuf, /Auto[\s\S]{0,200}?\n\s*~/, 30000);
  if (!ready) {
    log('FAIL', 'cursor-agent never reached ready state');
    try { proc.kill(); } catch {}
    process.exit(2);
  }
  log('ready', 'cursor-agent ready');

  proc.write('Run the shell command "pwd" and tell me the output.\r');
  log('sent', 'prompt typed + Enter');

  const dialogShown = await waitForRegex(getBuf, /Not in allowlist|Run this command\?/, 60000);
  if (!dialogShown) {
    log('FAIL', 'per-command dialog never appeared in 60s');
    log('FAIL', 'tail:\n' + visibleTail(getBuf(), 1200));
    try { proc.kill(); } catch {}
    process.exit(2);
  }
  log('dialog', 'per-command approval dialog appeared');
  log('dialog', `initial tail:\n${visibleTail(getBuf(), 600)}`);

  // Try each candidate keystroke. We make a FRESH dialog for each attempt
  // because the first success dismisses the dialog — comparing is unfair
  // otherwise. For this probe we just stack them and report what each does
  // against whatever state we land in; the FIRST verdict is the meaningful
  // one for the actual fresh dialog.
  const candidates: Array<[string, string]> = [
    ['y',          encodeKey('y') || 'y'],
    ['Enter',      encodeKey('Enter') || '\r'],
    ['Tab',        encodeKey('Tab') || '\t'],
    ['Shift+Tab',  encodeKey('shift+tab') || '\x1b[Z'],
    ['n',          encodeKey('n') || 'n'],
    ['Esc',        encodeKey('Esc') || '\x1b'],
    ['Space',      encodeKey('Space') || ' '],
  ];
  for (const [label, encoded] of candidates) {
    const before = visibleTail(getBuf(), 600);
    const dialogPresent = /Not in allowlist|Run this command\?/.test(before);
    if (!dialogPresent) {
      log(label, 'dialog already gone — skip');
      continue;
    }
    await probeKey(proc, getBuf, label, encoded);
  }

  try { proc.kill(); } catch {}
  await sleep(2000);
  try { rmSync(cwd, { recursive: true, force: true }); } catch {}
  try {
    rmSync(join(process.env.USERPROFILE || process.env.HOME!, '.cursor', 'projects', cursorWorkspaceSlug(cwd)), {
      recursive: true, force: true,
    });
  } catch {}
  process.exit(0);
}

main().catch((e) => { console.error('probe failed:', e); process.exit(2); });
