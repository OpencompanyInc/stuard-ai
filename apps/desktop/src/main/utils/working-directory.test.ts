import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeOptionalWorkingDirectory, normalizeWorkingDirectory } from './working-directory';

describe('working-directory', () => {
  it('keeps valid directories', () => {
    const cwd = normalizeWorkingDirectory(os.tmpdir());
    expect(cwd).toBe(path.resolve(os.tmpdir()));
  });

  it('falls back when cwd does not exist', () => {
    const fallback = os.tmpdir();
    const cwd = normalizeWorkingDirectory('/this/path/should/not/exist/xyz123', fallback);
    expect(cwd).toBe(path.resolve(fallback));
  });

  it('treats unresolved placeholders as invalid', () => {
    const fallback = os.tmpdir();
    const cwd = normalizeWorkingDirectory('{{$workspace.data}}', fallback);
    expect(cwd).toBe(path.resolve(fallback));
  });

  it('returns undefined for invalid optional cwd values', () => {
    expect(normalizeOptionalWorkingDirectory('{{$workspace.data}}')).toBeUndefined();
    expect(normalizeOptionalWorkingDirectory('')).toBeUndefined();
  });
});
