import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveRedactedFilePath } from '../handlers/redacted-path';

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuard-redacted-path-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveRedactedFilePath', () => {
  it('returns existing paths unchanged', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'audio_real_123.wav');
    fs.writeFileSync(filePath, 'audio');

    expect(resolveRedactedFilePath(filePath)).toEqual({
      path: filePath,
      recovered: false,
    });
  });

  it('recovers a filename when only the redacted segment differs', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'audio_actual-session_1777534153274.wav');
    fs.writeFileSync(filePath, 'audio');

    const redactedPath = path.join(dir, 'audio_[redacted]_1777534153274.wav');
    expect(resolveRedactedFilePath(redactedPath)).toEqual({
      path: filePath,
      recovered: true,
    });
  });

  it('leaves unmatched redacted paths unchanged', () => {
    const dir = makeTempDir();
    const redactedPath = path.join(dir, 'audio_[redacted]_missing.wav');

    expect(resolveRedactedFilePath(redactedPath)).toEqual({
      path: redactedPath,
      recovered: false,
    });
  });
});
