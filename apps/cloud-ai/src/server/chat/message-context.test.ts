import { describe, it, expect } from 'vitest';
import { buildPastContextLines, renderBudgetedSections } from './message-context';

describe('buildPastContextLines (P1+P2)', () => {
  it('returns empty array when no matches', () => {
    expect(buildPastContextLines([], 'hello')).toEqual([]);
  });

  it('renders date + topic tags + summary with provenance', () => {
    const matches = [
      {
        score: 0.7,
        segment: {
          conversation_id: 'c1',
          summary: 'useReducer pattern decided over useState for the auth flow',
          topics: ['react', 'hooks'],
          created_at: '2026-04-02T12:00:00Z',
        },
      },
    ];
    const lines = buildPastContextLines(matches, 'what about react?');
    expect(lines[0]).toBe('[PAST CONTEXT]');
    expect(lines[1]).toContain('2026-04-02');
    expect(lines[1]).toContain('[react, hooks]');
    expect(lines[1]).toContain('useReducer pattern');
  });

  it('caps topic tags at 3 and summary at 140 chars', () => {
    const longSummary = 'a'.repeat(300);
    const matches = [
      {
        score: 0.8,
        segment: {
          conversation_id: 'c1',
          summary: longSummary,
          topics: ['a', 'b', 'c', 'd', 'e'],
          created_at: '2026-04-02',
        },
      },
    ];
    const lines = buildPastContextLines(matches, 'q');
    expect(lines[1]).toContain('[a, b, c]');
    expect(lines[1]).not.toContain('[a, b, c, d');
    // line length = "- " + "2026-04-02 [a, b, c]: " + 140 a's
    expect(lines[1].length).toBeLessThanOrEqual(2 + 11 + 11 + 2 + 140);
  });

  it('boosts segments from active conversation in ranking', () => {
    const matches = [
      // Lower cosine but in active conversation
      {
        score: 0.5,
        segment: {
          conversation_id: 'active',
          summary: 'active-conv segment',
          topics: ['x'],
          created_at: '2026-04-02',
        },
      },
      // Higher cosine but unrelated conversation
      {
        score: 0.6,
        segment: {
          conversation_id: 'other',
          summary: 'other-conv segment',
          topics: ['y'],
          created_at: '2026-04-02',
        },
      },
    ];
    const lines = buildPastContextLines(matches, 'q', 'active');
    // First body line (after header) should be the active-conv segment thanks
    // to the +0.15 conversationBoost.
    expect(lines[1]).toContain('active-conv segment');
  });

  it('returns empty when all segments have empty summaries', () => {
    const matches = [
      { score: 0.7, segment: { summary: '', topics: [], created_at: '2026-04-02' } },
    ];
    expect(buildPastContextLines(matches, 'q')).toEqual([]);
  });
});

describe('renderBudgetedSections (P4)', () => {
  it('renders sections in canonical order regardless of input order', () => {
    const out = renderBudgetedSections([
      { key: 'PAST_CONTEXT', text: '[PAST CONTEXT]\n- past' },
      { key: 'USER_IDENTITY', text: '[USER IDENTITY]\nName: Bob' },
      { key: 'RELEVANT_MEMORIES', text: '[RELEVANT MEMORIES]\n- mem' },
    ]);
    const idIdx = out.indexOf('[USER IDENTITY]');
    const memIdx = out.indexOf('[RELEVANT MEMORIES]');
    const pastIdx = out.indexOf('[PAST CONTEXT]');
    expect(idIdx).toBeLessThan(memIdx);
    expect(memIdx).toBeLessThan(pastIdx);
  });

  it('truncates a section by dropping trailing body lines, not mid-line', () => {
    // RELEVANT_MEMORIES budget is 600. Build a section that exceeds it.
    const header = '[RELEVANT MEMORIES]';
    const longLine = '- ' + 'x'.repeat(200); // ~202 chars
    const text = [header, longLine, longLine, longLine, longLine].join('\n');
    // Total ~ 19 + 4*203 = 831 — over 600.
    const out = renderBudgetedSections([{ key: 'RELEVANT_MEMORIES', text }]);
    expect(out.startsWith('[RELEVANT MEMORIES]')).toBe(true);
    // Each line preserved intact — never cut mid-line.
    for (const line of out.split('\n')) {
      if (line === header) continue;
      expect(line === longLine || line === '').toBe(true);
    }
  });

  it('preserves USER_IDENTITY uncapped (always passes through)', () => {
    const huge = '[USER IDENTITY]\n' + Array.from({ length: 50 }, (_, i) => `Field${i}: value`).join('\n');
    const out = renderBudgetedSections([{ key: 'USER_IDENTITY', text: huge }]);
    expect(out).toBe(huge);
  });

  it('renders multiple CURRENT_CONTEXT blocks independently (P3)', () => {
    const out = renderBudgetedSections([
      { key: 'CURRENT_CONTEXT', text: '[CURRENT CONTEXT: ProjectA]\n- fact A' },
      { key: 'CURRENT_CONTEXT', text: '[CURRENT CONTEXT: ProjectB]\n- fact B' },
    ]);
    expect(out).toContain('[CURRENT CONTEXT: ProjectA]');
    expect(out).toContain('[CURRENT CONTEXT: ProjectB]');
  });

  it('returns empty string for no sections', () => {
    expect(renderBudgetedSections([])).toBe('');
  });
});
