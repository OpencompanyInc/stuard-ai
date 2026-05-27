// Unit tests for the cli_agent harness helpers: workspace-slug derivation,
// trust-marker writing, alt-screen / screen-clear frame collapsing, and the
// key-encoding table that backs `cli_agent_send({ keys })`. These are pure
// functions; the end-to-end pty driving is covered separately by the live
// probe (see live-test transcript in the PR description).

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../terminal', () => ({ ptyManager: { create: vi.fn(), write: vi.fn() } }));

import {
  applyCarriageReturns,
  collapseToVisibleFrame,
  cursorWorkspaceSlug,
  encodeKey,
  ensureCursorTrust,
  hasReadyMarker,
} from '../handlers/cli-agent';
import { renderTerminalScreen } from '../handlers/terminal-screen';

describe('cursorWorkspaceSlug', () => {
  it('matches the on-disk format Cursor uses', () => {
    expect(cursorWorkspaceSlug('C:\\Users\\solar')).toBe('C-Users-solar');
    expect(cursorWorkspaceSlug('c:\\Users\\solar\\StuardAI-V2')).toBe('c-Users-solar-StuardAI-V2');
  });
  it('handles forward slashes too', () => {
    expect(cursorWorkspaceSlug('c:/Users/solar/proj')).toBe('cUserssolarproj');
  });
});

describe('ensureCursorTrust', () => {
  it('writes the trust marker and reports granted, then already on second call', () => {
    // Point HOME at a tmpdir so we don't touch the user's real ~/.cursor.
    const tmpHome = mkdtempSync(join(tmpdir(), 'cli-agent-trust-'));
    const origHome = process.env.USERPROFILE;
    const origHomeUnix = process.env.HOME;
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
    try {
      const cwd = join(tmpHome, 'workspaces', 'demo');
      const first = ensureCursorTrust(cwd);
      expect(first).toBe('granted');

      const slug = cursorWorkspaceSlug(cwd);
      const marker = join(tmpHome, '.cursor', 'projects', slug, '.workspace-trusted');
      expect(existsSync(marker)).toBe(true);
      const body = JSON.parse(readFileSync(marker, 'utf8'));
      expect(body.workspacePath).toBe(cwd);
      expect(typeof body.trustedAt).toBe('string');

      const second = ensureCursorTrust(cwd);
      expect(second).toBe('already');
    } finally {
      if (origHome === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origHome;
      if (origHomeUnix === undefined) delete process.env.HOME; else process.env.HOME = origHomeUnix;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('collapseToVisibleFrame', () => {
  it('drops content before a full screen clear', () => {
    const raw = 'OLD garbage from a previous render\n\x1b[2Jvisible after clear';
    expect(collapseToVisibleFrame(raw)).toBe('visible after clear');
  });
  it('drops the alt-screen body on leave', () => {
    // Enter alt-screen, draw a dialog, leave alt-screen, then main output.
    const raw = '\x1b[?1049hWORKSPACE TRUST DIALOG body\x1b[?1049lback in main';
    expect(collapseToVisibleFrame(raw)).toBe('back in main');
  });
  it('processes nested resets (enter alt + later clear inside it)', () => {
    const raw = 'preamble\x1b[?1049hold frame\x1b[2Jfinal frame';
    expect(collapseToVisibleFrame(raw)).toBe('final frame');
  });
  it('passes through when there is no reset', () => {
    expect(collapseToVisibleFrame('plain text')).toBe('plain text');
  });
});

describe('hasReadyMarker', () => {
  it('matches Claude Code footer text with or without spaces', () => {
    expect(hasReadyMarker('claude', '? for shortcuts · ← for agents')).toBe(true);
    expect(hasReadyMarker('claude', '?forshortcuts·←foragents')).toBe(true);
  });
});

describe('applyCarriageReturns', () => {
  it('collapses a PowerShell-style progress bar to a single final line', () => {
    // The exact pattern that ate 245K context tokens in the live transcript.
    const frames = [];
    for (let bytes = 1000; bytes <= 10000; bytes += 1000) {
      frames.push(`Writing request stream... (Number of bytes written: ${bytes})\r`);
    }
    // Final frame without trailing \r, then a real newline + next line.
    frames.push('Writing request stream... (Number of bytes written: 10000)\nDone\n');
    const raw = frames.join('');
    const out = applyCarriageReturns(raw);
    // After collapse: only the last in-place frame survives on its line.
    const lines = out.split('\n');
    expect(lines[0]).toBe('Writing request stream... (Number of bytes written: 10000)');
    expect(lines[1]).toBe('Done');
    // And the byte budget shrinks by ~10x — the actual point of the fix.
    expect(out.length).toBeLessThan(raw.length / 5);
  });
  it('preserves CRLF line breaks (does not eat them as overwrites)', () => {
    const raw = 'line one\r\nline two\r\nline three';
    expect(applyCarriageReturns(raw)).toBe('line one\nline two\nline three');
  });
  it('overwrites partially when the new chunk is shorter (real terminal semantics)', () => {
    // \"abcdef\\rXY\" → on a real terminal you'd see \"XYcdef\".
    expect(applyCarriageReturns('abcdef\rXY')).toBe('XYcdef');
  });
});

describe('renderTerminalScreen', () => {
  it('collapses a CUP-repainted progress bar to its final state', () => {
    // PowerShell-style: repaint the same screen row via absolute cursor
    // positioning (ESC[r;1H) instead of \r. Stripping ANSI naively would
    // concatenate every frame; the screen model overwrites in place.
    let raw = 'PS C:\\> some-command\r\n';
    for (let i = 1; i <= 50; i++) {
      raw += `\x1b[5;1H\x1b[KWriting request stream... (bytes: ${i * 1000})`;
    }
    raw += '\x1b[5;1H\x1b[K\x1b[10;1HDONE';
    const out = renderTerminalScreen(raw, { cols: 120, rows: 24 });
    // Only the final byte count should survive — not all 50 frames.
    expect(out).not.toContain('bytes: 1000)');
    expect(out).not.toContain('bytes: 49000)');
    expect(out).toContain('DONE');
    // Sanity: output is small (a screen, not a 50x transcript).
    expect(out.length).toBeLessThan(2000);
  });

  it('models a dismissed alt-screen dialog as gone', () => {
    const raw =
      '\x1b[?1049h' +
      '\x1b[2;1H┌ Trust this workspace? ┐' +
      '\x1b[3;1H▶ [a] Yes' +
      '\x1b[?1049l' +
      'back at the prompt\r\n❯ ';
    const out = renderTerminalScreen(raw, { cols: 80, rows: 24 });
    expect(out).not.toContain('Trust this workspace');
    expect(out).toContain('back at the prompt');
  });

  it('lays out normal scrolling text in order', () => {
    const raw = 'line one\r\nline two\r\nline three\r\n';
    const out = renderTerminalScreen(raw, { cols: 80, rows: 24 });
    expect(out).toBe('line one\nline two\nline three');
  });

  it('resolves \\r overwrites within a line', () => {
    const out = renderTerminalScreen('abcdef\rXY', { cols: 80, rows: 24 });
    expect(out).toBe('XYcdef');
  });

  it('keeps scrolled-off lines in scrollback', () => {
    let raw = '';
    for (let i = 1; i <= 30; i++) raw += `row ${i}\r\n`;
    const out = renderTerminalScreen(raw, { cols: 80, rows: 10 });
    // Even though only 10 rows are visible, scrollback retains the earlier ones.
    expect(out).toContain('row 1');
    expect(out).toContain('row 30');
  });
});

describe('encodeKey', () => {
  it('translates named keys to the bytes Ink TUIs expect', () => {
    expect(encodeKey('Enter')).toBe('\r');
    expect(encodeKey('Esc')).toBe('\x1b');
    expect(encodeKey('Up')).toBe('\x1b[A');
    expect(encodeKey('Down')).toBe('\x1b[B');
    expect(encodeKey('Tab')).toBe('\t');
    expect(encodeKey('Space')).toBe(' ');
    expect(encodeKey('ctrl+c')).toBe('\x03');
  });
  it('passes through single printable characters', () => {
    expect(encodeKey('a')).toBe('a');
    expect(encodeKey('1')).toBe('1');
    expect(encodeKey('y')).toBe('y');
  });
  it('rejects empty', () => {
    expect(encodeKey('')).toBeNull();
    expect(encodeKey('   ')).toBeNull();
  });
});
