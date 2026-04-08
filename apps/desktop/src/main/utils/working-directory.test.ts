import path from 'path';
import { describe, expect, it } from 'vitest';
import { normalizeOptionalWorkingDirectory, normalizeWorkingDirectory } from './working-directory';

describe('working-directory', () => {
  it('keeps valid directories', () => {
    const cwd = normalizeWorkingDirectory('C:\\Users\\solar\\StuardAI-V2');
    expect(cwd).toBe(path.resolve('C:\\Users\\solar\\StuardAI-V2'));
  });

  it('falls back when cwd does not exist', () => {
    const fallback = path.resolve('C:\\Users\\solar\\StuardAI-V2');
    const cwd = normalizeWorkingDirectory('C:\\this\\path\\should\\not\\exist', fallback);
    expect(cwd).toBe(fallback);
  });

  it('treats unresolved placeholders as invalid', () => {
    const fallback = path.resolve('C:\\Users\\solar\\StuardAI-V2');
    const cwd = normalizeWorkingDirectory('{{$workspace.data}}', fallback);
    expect(cwd).toBe(fallback);
  });

  it('returns undefined for invalid optional cwd values', () => {
    expect(normalizeOptionalWorkingDirectory('{{$workspace.data}}')).toBeUndefined();
    expect(normalizeOptionalWorkingDirectory('')).toBeUndefined();
  });
});
