import { describe, expect, it } from 'vitest';

import {
  getStreamingOverlapLength,
  isRedundantStreamingUpdate,
  mergeStreamingText,
} from './streamMerge';

describe('streamMerge', () => {
  it('appends normal delta chunks', () => {
    expect(mergeStreamingText('Planning', ' next moves')).toBe('Planning next moves');
  });

  it('promotes a fuller snapshot without duplicating prior text', () => {
    expect(
      mergeStreamingText(
        'Let me wait a few seconds and then check for output',
        'Let me wait a few seconds and then check for output.',
      ),
    ).toBe('Let me wait a few seconds and then check for output.');
  });

  it('merges overlapping chunks once', () => {
    expect(
      mergeStreamingText(
        'the process is still running',
        'running. Let me wait a bit more and try again.',
      ),
    ).toBe('the process is still running. Let me wait a bit more and try again.');
  });

  it('ignores repeated suffix snapshots', () => {
    expect(
      mergeStreamingText(
        'It keeps timing out. Let me try running it in the background and reading the output.',
        'reading the output.',
      ),
    ).toBe('It keeps timing out. Let me try running it in the background and reading the output.');
  });

  it('measures suffix-prefix overlap', () => {
    expect(getStreamingOverlapLength('abc123', '123xyz')).toBe(3);
  });

  it('detects redundant progressive updates', () => {
    expect(
      isRedundantStreamingUpdate(
        'a few seconds and then check for output',
        'a few seconds and then check for output.',
      ),
    ).toBe(true);
  });

  it('does not collapse distinct reasoning lines', () => {
    expect(
      isRedundantStreamingUpdate(
        'Run command in the background',
        'Read the terminal output next',
      ),
    ).toBe(false);
  });
});
