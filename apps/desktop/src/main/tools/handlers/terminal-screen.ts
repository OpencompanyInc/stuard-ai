// Minimal, dependency-free VT100/ANSI screen emulator.
//
// Why this exists: reading a coding-agent CLI's PTY output as a raw byte
// stream is wrong. TUIs (Cursor's Ink UI, Claude's REPL) and even plain
// shells (PowerShell's progress bar) paint the screen with cursor-positioning
// escapes — absolute moves (`ESC[r;cH`), line erases (`ESC[K`), scroll
// regions, alternate screens. If you just strip the escapes you get every
// repaint concatenated: a progress bar that updated 5,000 times becomes 5,000
// lines, and a dismissed dialog lingers forever. That was the root cause of
// both the 200K-token context blow-ups and the "dialog still showing" loops.
//
// Instead of pattern-matching specific apps (brittle; breaks on the next CLI
// update), we model the screen the way a real terminal does: a grid of cells
// plus scrollback. Feed the cumulative byte stream through `renderTerminalScreen`
// and you get exactly what a human would see in the terminal right now.
//
// This is NOT a complete emulator — no SGR colors (we don't need styling for
// text extraction), no DEC private modes beyond alt-screen, no tab stops table.
// It handles the cursor movement, erase, scroll, and screen-clear repertoire
// that real CLIs actually use to lay out text, which is what matters for
// turning a paint stream back into readable lines.

export interface ScreenOptions {
  cols?: number;
  rows?: number;
  /** Max lines of scrolled-off history to retain above the visible grid. */
  maxScrollback?: number;
}

const DEFAULT_COLS = 140;
const DEFAULT_ROWS = 36;
const DEFAULT_MAX_SCROLLBACK = 4000;

class Screen {
  cols: number;
  rows: number;
  maxScrollback: number;
  grid: string[][];
  scrollback: string[][];
  row = 0;
  col = 0;
  // When in the alternate screen buffer, scrolled-off lines are discarded
  // rather than pushed to scrollback (matches real terminals — alt-screen
  // apps like full-screen editors don't pollute scrollback).
  altScreen = false;

  constructor(cols: number, rows: number, maxScrollback: number) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.maxScrollback = Math.max(0, maxScrollback);
    this.grid = this.blankGrid();
    this.scrollback = [];
  }

  private blankGrid(): string[][] {
    return Array.from({ length: this.rows }, () => this.blankLine());
  }

  private blankLine(): string[] {
    return new Array(this.cols).fill(' ');
  }

  private clampRow(r: number) { return Math.max(0, Math.min(this.rows - 1, r)); }
  private clampCol(c: number) { return Math.max(0, Math.min(this.cols - 1, c)); }

  private scrollUp() {
    const top = this.grid.shift()!;
    if (!this.altScreen && this.maxScrollback > 0) {
      this.scrollback.push(top);
      if (this.scrollback.length > this.maxScrollback) this.scrollback.shift();
    }
    this.grid.push(this.blankLine());
  }

  newline() {
    if (this.row >= this.rows - 1) this.scrollUp();
    else this.row++;
  }

  writeChar(ch: string) {
    if (this.col >= this.cols) {
      // Auto-wrap to the next line.
      this.col = 0;
      this.newline();
    }
    this.grid[this.row][this.col] = ch;
    this.col++;
  }

  // Erase in line: 0 = cursor→end, 1 = start→cursor, 2 = whole line.
  eraseLine(mode: number) {
    const line = this.grid[this.row];
    if (mode === 0) for (let c = this.col; c < this.cols; c++) line[c] = ' ';
    else if (mode === 1) for (let c = 0; c <= this.col && c < this.cols; c++) line[c] = ' ';
    else for (let c = 0; c < this.cols; c++) line[c] = ' ';
  }

  // Erase in display: 0 = cursor→end, 1 = start→cursor, 2/3 = whole screen.
  eraseDisplay(mode: number) {
    if (mode === 2 || mode === 3) {
      this.grid = this.blankGrid();
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      for (let r = this.row + 1; r < this.rows; r++) this.grid[r] = this.blankLine();
    } else if (mode === 1) {
      this.eraseLine(1);
      for (let r = 0; r < this.row; r++) this.grid[r] = this.blankLine();
    }
  }

  enterAltScreen() {
    if (this.altScreen) return;
    this.altScreen = true;
    this.grid = this.blankGrid();
    this.row = 0;
    this.col = 0;
  }

  leaveAltScreen() {
    if (!this.altScreen) return;
    this.altScreen = false;
    // Real terminals restore the pre-alt-screen content; we don't track it,
    // so we clear — which is the behavior we want for reads anyway (the
    // alt-screen app's final frame, e.g. a dismissed dialog, should vanish).
    this.grid = this.blankGrid();
    this.row = 0;
    this.col = 0;
  }

  render(): string {
    const lines = [
      ...this.scrollback.map((l) => l.join('')),
      ...this.grid.map((l) => l.join('')),
    ].map((l) => l.replace(/\s+$/u, '')); // trim trailing spaces per line
    // Trim trailing blank lines.
    let end = lines.length;
    while (end > 0 && lines[end - 1] === '') end--;
    return lines.slice(0, end).join('\n');
  }
}

export function renderTerminalScreen(raw: string, opts: ScreenOptions = {}): string {
  const cols = opts.cols ?? DEFAULT_COLS;
  const rows = opts.rows ?? DEFAULT_ROWS;
  const maxScrollback = opts.maxScrollback ?? DEFAULT_MAX_SCROLLBACK;
  const screen = new Screen(cols, rows, maxScrollback);

  const text = String(raw || '');
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const code = text.charCodeAt(i);

    // ESC sequences.
    if (ch === '\x1b') {
      const next = text[i + 1];

      // CSI: ESC [ ... final
      if (next === '[') {
        let j = i + 2;
        let params = '';
        // Optional private prefix (?, >, =) and parameter/intermediate bytes.
        while (j < n) {
          const c = text[j];
          const cc = text.charCodeAt(j);
          if (cc >= 0x40 && cc <= 0x7e) break; // final byte
          params += c;
          j++;
        }
        const final = text[j];
        applyCsi(screen, params, final);
        i = j + 1;
        continue;
      }

      // OSC: ESC ] ... (BEL | ESC \)
      if (next === ']') {
        let j = i + 2;
        while (j < n) {
          if (text[j] === '\x07') { j++; break; }
          if (text[j] === '\x1b' && text[j + 1] === '\\') { j += 2; break; }
          j++;
        }
        i = j;
        continue;
      }

      // Charset designation: ESC ( X / ESC ) X — skip the designator char.
      if (next === '(' || next === ')') { i += 3; continue; }

      // Reverse index: ESC M — move up, scrolling down at top.
      if (next === 'M') {
        if (screen.row === 0) {
          screen.grid.pop();
          screen.grid.unshift(new Array(screen.cols).fill(' '));
        } else {
          screen.row--;
        }
        i += 2;
        continue;
      }

      // ESC = / ESC > (keypad modes) and other 2-byte escapes: skip both.
      i += 2;
      continue;
    }

    // Control chars.
    if (ch === '\n') { screen.newline(); i++; continue; }
    if (ch === '\r') { screen.col = 0; i++; continue; }
    if (ch === '\b') { screen.col = Math.max(0, screen.col - 1); i++; continue; }
    if (ch === '\t') {
      screen.col = Math.min(screen.cols - 1, (Math.floor(screen.col / 8) + 1) * 8);
      i++;
      continue;
    }
    if (code === 0x07) { i++; continue; } // BEL
    if (code < 0x20) { i++; continue; }   // other C0 controls — ignore

    // Printable.
    screen.writeChar(ch);
    i++;
  }

  return screen.render();
}

function parseParams(params: string): number[] {
  // Strip a private prefix if present (?, >, =) for numeric parsing; callers
  // that care about the prefix inspect `params` directly.
  const clean = params.replace(/^[?>=]/, '');
  if (clean === '') return [];
  return clean.split(';').map((p) => {
    const v = parseInt(p, 10);
    return Number.isFinite(v) ? v : 0;
  });
}

function applyCsi(screen: Screen, params: string, final: string | undefined) {
  if (!final) return;
  const isPrivate = params.startsWith('?');
  const nums = parseParams(params);
  const p0 = nums[0] ?? 0;

  // DEC private modes: alternate screen buffer.
  if (isPrivate && (final === 'h' || final === 'l')) {
    if (nums.includes(1049) || nums.includes(47) || nums.includes(1047)) {
      if (final === 'h') screen.enterAltScreen();
      else screen.leaveAltScreen();
    }
    return; // other private modes (cursor visibility, etc.) — ignore
  }

  switch (final) {
    case 'A': screen.row = Math.max(0, screen.row - Math.max(1, p0)); break;             // CUU
    case 'B': screen.row = Math.min(screen.rows - 1, screen.row + Math.max(1, p0)); break; // CUD
    case 'C': screen.col = Math.min(screen.cols - 1, screen.col + Math.max(1, p0)); break; // CUF
    case 'D': screen.col = Math.max(0, screen.col - Math.max(1, p0)); break;             // CUB
    case 'E': screen.row = Math.min(screen.rows - 1, screen.row + Math.max(1, p0)); screen.col = 0; break; // CNL
    case 'F': screen.row = Math.max(0, screen.row - Math.max(1, p0)); screen.col = 0; break;             // CPL
    case 'G': screen.col = Math.max(0, Math.min(screen.cols - 1, (p0 || 1) - 1)); break; // CHA
    case 'd': screen.row = Math.max(0, Math.min(screen.rows - 1, (p0 || 1) - 1)); break; // VPA
    case 'H': case 'f': {                                                                 // CUP
      const r = (nums[0] || 1) - 1;
      const c = (nums[1] || 1) - 1;
      screen.row = Math.max(0, Math.min(screen.rows - 1, r));
      screen.col = Math.max(0, Math.min(screen.cols - 1, c));
      break;
    }
    case 'J': screen.eraseDisplay(p0); break; // ED
    case 'K': screen.eraseLine(p0); break;    // EL
    // Everything else (SGR `m`, scroll `S`/`T`, insert/delete lines, etc.)
    // doesn't affect text layout enough to matter for extraction — ignore.
    default: break;
  }
}
