import { clipboard } from 'electron';
import { fileURLToPath } from 'node:url';

/**
 * The primary kind of content currently on the clipboard.
 * The OS clipboard can hold several formats at once (e.g. an image plus its
 * source HTML); `type` is the single best representation while `types` lists
 * everything that was detected.
 */
export type ClipboardKind = 'text' | 'image' | 'files' | 'html' | 'empty';

export interface ClipboardSnapshot {
  /** Best-guess primary content type (priority: files > image > text > html). */
  type: ClipboardKind;
  /** All content types detected on the clipboard. */
  types: ClipboardKind[];
  /** Plain text content (empty string when none). */
  text: string;
  /** HTML markup content (empty string when none). */
  html: string;
  /** Absolute file paths copied to the clipboard (best-effort, platform-specific). */
  files: string[];
  /** Whether an image is present on the clipboard. */
  hasImage: boolean;
  /** Pixel size of the clipboard image, when present. */
  imageSize: { width: number; height: number } | null;
  /** Raw Electron clipboard format identifiers. */
  formats: string[];
  /** Cheap content fingerprint used to detect clipboard changes between polls. */
  signature: string;
}

/**
 * Tiny non-cryptographic hash (djb2). For buffers we sample bytes so that
 * hashing a large image stays cheap enough to run on a polling interval.
 */
function quickHash(input: string | Buffer): string {
  let h = 5381;
  if (typeof input === 'string') {
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
  } else {
    const step = Math.max(1, Math.floor(input.length / 4096));
    for (let i = 0; i < input.length; i += step) {
      h = ((h << 5) + h + input[i]) | 0;
    }
    h = (h ^ input.length) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Best-effort extraction of file paths from the clipboard. Each OS exposes
 * copied files through a different clipboard format, and Electron only surfaces
 * a subset of them, so this is intentionally defensive.
 */
function readClipboardFiles(): string[] {
  const files: string[] = [];
  const pushUriList = (raw: string) => {
    for (const line of raw.split(/[\r\n]+/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      try {
        files.push(s.startsWith('file:') ? fileURLToPath(s) : s);
      } catch {
        files.push(s);
      }
    }
  };

  try {
    if (process.platform === 'darwin') {
      const raw = clipboard.read('public.file-url');
      if (raw) pushUriList(raw);
    } else if (process.platform === 'win32') {
      // Electron surfaces a single copied file path via the FileNameW format,
      // encoded as UTF-16LE and NUL-terminated.
      try {
        const buf = clipboard.readBuffer('FileNameW');
        if (buf && buf.length) {
          const p = buf.toString('ucs2').replace(/\u0000+$/g, '').trim();
          if (p) files.push(p);
        }
      } catch {
        /* format not present */
      }
    } else {
      const raw = clipboard.read('text/uri-list');
      if (raw) pushUriList(raw);
    }
  } catch {
    /* clipboard unavailable */
  }

  return files;
}

/**
 * Read the current clipboard into a typed, structured snapshot. Safe to call
 * frequently (e.g. from a polling trigger) — image hashing is the only
 * non-trivial cost and only runs when an image is actually present.
 */
export function readClipboardSnapshot(): ClipboardSnapshot {
  let formats: string[] = [];
  try {
    formats = clipboard.availableFormats() || [];
  } catch {
    /* ignore */
  }

  let text = '';
  try {
    text = clipboard.readText() || '';
  } catch {
    /* ignore */
  }

  let html = '';
  try {
    html = clipboard.readHTML() || '';
  } catch {
    /* ignore */
  }

  let hasImage = false;
  let imageSize: { width: number; height: number } | null = null;
  let imageSig = '';
  try {
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      hasImage = true;
      const size = img.getSize();
      imageSize = { width: size.width, height: size.height };
      try {
        imageSig = quickHash(img.toPNG());
      } catch {
        imageSig = `${size.width}x${size.height}`;
      }
    }
  } catch {
    /* ignore */
  }

  const files = readClipboardFiles();

  const types: ClipboardKind[] = [];
  if (files.length) types.push('files');
  if (hasImage) types.push('image');
  if (text) types.push('text');
  if (html) types.push('html');

  const type: ClipboardKind = files.length
    ? 'files'
    : hasImage
      ? 'image'
      : text
        ? 'text'
        : html
          ? 'html'
          : 'empty';

  const signature = quickHash(
    [type, files.join('|'), imageSig, text, html ? quickHash(html) : ''].join('\u0001'),
  );

  return { type, types, text, html, files, hasImage, imageSize, formats, signature };
}
