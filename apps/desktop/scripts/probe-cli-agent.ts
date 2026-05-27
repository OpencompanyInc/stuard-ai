// Live probe for the cli_agent harness. Drives the *real* cli-agent.ts logic
// end-to-end against the user's actual cursor-agent install: it pre-trusts a
// fresh tmp workspace, spawns cursor-agent interactively through node-pty,
// confirms the workspace-trust dialog does NOT render, then exercises the
// new `keys`/collapseToVisibleFrame plumbing.
//
// Run with:  pnpm tsx scripts/probe-cli-agent.ts

import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collapseToVisibleFrame,
  cursorWorkspaceSlug,
  encodeKey,
  ensureCursorTrust,
} from '../src/main/tools/handlers/cli-agent';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pty = require('node-pty');

function log(label: string, msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[${label}] ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), 'cli-probe-'));
  log('setup', `tmp workspace = ${cwd}`);

  // Step 1: pre-trust via the same helper the harness uses.
  const status = ensureCursorTrust(cwd);
  log('trust', `ensureCursorTrust returned: ${status}`);
  if (status !== 'granted') {
    throw new Error(`expected trust=granted, got ${status}`);
  }
  const slug = cursorWorkspaceSlug(cwd);
  const marker = join(process.env.USERPROFILE || process.env.HOME!, '.cursor', 'projects', slug, '.workspace-trusted');
  if (!existsSync(marker)) throw new Error(`marker not written at ${marker}`);
  log('trust', `marker exists at ${marker}`);

  // Step 2: spawn cursor-agent via node-pty, same way the harness does.
  const proc = pty.spawn('powershell.exe', [], {
    name: 'xterm-256color',
    cols: 140,
    rows: 36,
    cwd,
    env: process.env as Record<string, string>,
  });

  let buf = '';
  proc.onData((d: string) => { buf += d; });

  // Launch cursor-agent with the same args the harness uses for interactive
  // mode: --approve-mcps suppresses the MCP server approval dialog that the
  // user hit in round 2 (their global supabase MCP triggers it every fresh
  // session).
  proc.write("& 'cursor-agent' --approve-mcps\r");

  // Give it 8s to fully render its initial frame.
  await sleep(8000);

  log('boot', `raw buffer length: ${buf.length} bytes`);
  const visible = collapseToVisibleFrame(buf);
  log('boot', `visible-frame length: ${visible.length} bytes`);

  const trustInBuffer = /Workspace Trust Required/.test(buf);
  const trustInVisible = /Workspace Trust Required/.test(visible);
  const mcpInBuffer = /MCP Server Approval Required/.test(buf);
  const mcpInVisible = /MCP Server Approval Required/.test(visible);
  log('check', `"Workspace Trust Required"   in raw / collapsed = ${trustInBuffer} / ${trustInVisible}`);
  log('check', `"MCP Server Approval"        in raw / collapsed = ${mcpInBuffer} / ${mcpInVisible}`);

  if (trustInVisible || mcpInVisible) {
    log('FAIL', 'a recurring approval dialog rendered in the collapsed view');
    log('FAIL', 'visible tail:\n' + visible.slice(-2000));
  } else {
    log('PASS', 'no trust + no MCP-approval dialog blocked the TUI launch');
  }

  // Step 3: exercise the keys path: send an 'a' (just to verify the encoded
  // bytes flow), then a Ctrl+C to terminate cursor-agent cleanly.
  log('keys', `encodeKey('a') = ${JSON.stringify(encodeKey('a'))}`);
  log('keys', `encodeKey('ctrl+c') = ${JSON.stringify(encodeKey('ctrl+c'))}`);

  // Step 4: demonstrate that the buffer-collapse hides a dismissed dialog.
  // Reproduce the original bug scenario synthetically: a TUI app entered the
  // alt-screen, drew a trust dialog, then left the alt-screen — the bottom
  // 80 lines of the cumulative buffer would still show the dialog without
  // the fix.
  const syntheticBuf = [
    '\x1b[?1049h',
    '╭─── ⚠ Workspace Trust Required ───╮\n',
    '│  ▶ [a] Trust this workspace        │\n',
    '╰────────────────────────────────────╯\n',
    '\x1b[?1049l',
    '> ',
  ].join('');
  const after = collapseToVisibleFrame(syntheticBuf);
  log('collapse', `synthetic raw contains Trust dialog? ${/Trust Required/.test(syntheticBuf)}`);
  log('collapse', `synthetic collapsed contains Trust dialog? ${/Trust Required/.test(after)}`);
  log('collapse', `collapsed tail: ${JSON.stringify(after)}`);

  // Step 5: full ready-then-prompt round trip against the live cursor-agent.
  // Spawn fresh, wait for the actual ready marker (`~` after `Auto`), then
  // type a marker phrase the way the harness would, then re-read and assert
  // the marker phrase appears in the buffer (= cursor-agent received the
  // typed prompt, not the splash). This is the regression the user hit:
  // 1200ms timeout fired before cursor-agent was ready, prompt vanished.
  const cwd2 = mkdtempSync(join(tmpdir(), 'cli-probe-ready-'));
  ensureCursorTrust(cwd2);
  const proc2 = pty.spawn('powershell.exe', [], {
    name: 'xterm-256color', cols: 140, rows: 36, cwd: cwd2,
    env: process.env as Record<string, string>,
  });
  let buf2 = '';
  proc2.onData((d: string) => { buf2 += d; });
  proc2.write("& 'cursor-agent' --approve-mcps\r");

  // Poll for the cursor-agent readyMarker the way the harness's
  // waitForReadyMarker helper does — strip ANSI + apply CR overwrites + the
  // visible-frame collapse first, then test the same regex. (Earlier
  // version tested raw bytes and the ANSI codes between Auto and ~ defeated
  // the {0,200} non-greedy window.)
  const cursorReady = /Auto[\s\S]{0,200}?\n\s*~/;
  const stripForReady = (raw: string) =>
    String(raw || '')
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[\(\)][0-9A-Za-z]/g, '');
  const PROBE_PHRASE = 'STUARD-PROBE-ECHO-MARKER-42';
  const readyDeadline = Date.now() + 30000;
  const readyStart = Date.now();
  let readyHitMs = -1;
  while (Date.now() < readyDeadline) {
    const visible = stripForReady(collapseToVisibleFrame(buf2));
    if (cursorReady.test(visible)) { readyHitMs = Date.now() - readyStart; break; }
    await sleep(250);
  }
  log('ready', `cursor-agent readyMarker hit at ${readyHitMs} ms (waited up to 30 s)`);

  if (readyHitMs >= 0) {
    proc2.write(`${PROBE_PHRASE}\r`);
    // Give cursor-agent ~3s to echo the typed prompt into its input field.
    await sleep(3000);
    const echoed = buf2.includes(PROBE_PHRASE);
    log('typed', `probe phrase appeared in buffer after typing? ${echoed}`);
    if (!echoed) {
      log('FAIL', 'typed prompt did NOT echo — wait-for-ready regression');
      log('FAIL', 'buffer tail (post-strip): ' + JSON.stringify(buf2.slice(-800)));
    } else {
      log('PASS', 'wait-for-ready works — prompt actually landed in cursor-agent input');
    }
  } else {
    log('FAIL', 'cursor-agent never reached ready state in 30 s');
  }

  try { proc2.kill(); } catch {}
  await sleep(2000);
  try { rmSync(cwd2, { recursive: true, force: true }); } catch {}
  try {
    rmSync(
      join(process.env.USERPROFILE || process.env.HOME!, '.cursor', 'projects', cursorWorkspaceSlug(cwd2)),
      { recursive: true, force: true },
    );
  } catch {}
  proc.write(encodeKey('ctrl+c')!);
  await sleep(500);
  proc.write(encodeKey('ctrl+c')!);
  await sleep(500);

  try { proc.kill(); } catch {}
  // cursor-agent may keep file handles on the cwd briefly after kill; give
  // Windows a moment so cleanup succeeds without EBUSY.
  await sleep(2000);

  // Cleanup is best-effort — a EBUSY here doesn't reflect on the harness.
  try { rmSync(cwd, { recursive: true, force: true }); } catch (e: any) {
    log('cleanup', `cwd rm warning (non-fatal): ${e?.code || e?.message || e}`);
  }
  try {
    rmSync(join(process.env.USERPROFILE || process.env.HOME!, '.cursor', 'projects', slug), {
      recursive: true,
      force: true,
    });
  } catch (e: any) {
    log('cleanup', `trust-dir rm warning (non-fatal): ${e?.code || e?.message || e}`);
  }

  log('done', 'probe complete');
  process.exit(trustInVisible ? 1 : 0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('probe failed:', e);
  process.exit(2);
});
