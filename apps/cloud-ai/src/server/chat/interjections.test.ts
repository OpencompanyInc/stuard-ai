import { describe, expect, it } from 'vitest';

import {
  appendInterjectionToMessages,
  buildInterjectionContent,
  createInterjectionUserMessage,
} from './interjections';

describe('chat interjection helpers', () => {
  it('formats interjections as model-visible steering context', () => {
    const content = buildInterjectionContent([
      { text: 'Prefer the CSV path.' },
      { text: 'Do not refactor unrelated files.' },
    ]);

    expect(content).toContain('[User interjection while you were working]');
    expect(content).toContain('Interjection 1: Prefer the CSV path.');
    expect(content).toContain('Interjection 2: Do not refactor unrelated files.');
    expect(content).toContain('Use this guidance in the next step');
  });

  it('creates a Mastra-compatible user message instead of a plain UI-only object', () => {
    const message = createInterjectionUserMessage('Steer text');

    expect(message.role).toBe('user');
    expect(message.id).toMatch(/^interjection-/);
    expect(message.content.format).toBe(2);
    expect(message.content.content).toBe('Steer text');
    expect(message.content.parts).toEqual([{ type: 'text', text: 'Steer text' }]);
  });

  it('appends the interjection without mutating existing step messages', () => {
    const base = [{ id: 'm1', role: 'user', content: { format: 2, parts: [], content: 'Hi' } }];
    const next = appendInterjectionToMessages(base, 'Adjust course');

    expect(next).toHaveLength(2);
    expect(base).toHaveLength(1);
    expect(next[1].content.content).toBe('Adjust course');
  });
});
