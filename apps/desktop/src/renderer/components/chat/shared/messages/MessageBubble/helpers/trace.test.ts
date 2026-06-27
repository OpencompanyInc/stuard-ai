import { describe, expect, it } from 'vitest';
import { compactReasoningTraceSteps, summarizeReasoningLabel } from './trace';
import type { AssistantTraceStepData } from '../types';

const reasoning = (id: string, content: string, extra: Partial<AssistantTraceStepData> = {}): AssistantTraceStepData => ({
  id,
  kind: 'reasoning',
  label: content,
  status: 'complete',
  content,
  ...extra,
});

const toolStep = (id: string): AssistantTraceStepData => ({
  id,
  kind: 'tool',
  label: id,
  status: 'complete',
  tool: { id, tool: 'browser', status: 'completed' } as any,
});

describe('summarizeReasoningLabel', () => {
  it('skips a stray leading period instead of producing ". Click"', () => {
    expect(summarizeReasoningLabel('. Click the appropriate elements to open the transcript'))
      .toBe('Click the appropriate elements to open the transcript');
  });

  it('falls back for a punctuation-only chunk', () => {
    expect(summarizeReasoningLabel('.')).toBe('Planning next moves');
  });

  it('takes the first real sentence of normal reasoning', () => {
    expect(summarizeReasoningLabel('Reading the manifest now. Then I will edit it.'))
      .toBe('Reading the manifest now');
  });
});

describe('compactReasoningTraceSteps — fragmented reasoning', () => {
  it('folds a stream split into fragments into one clean step', () => {
    // Reproduces the screenshot: reasoning split around hidden tools into
    // mid-sentence fragments (". Click", "the appropriate…", ".").
    const steps = [
      reasoning('r1', 'Get interactive elements to find the three dots menu and transcript button 3'),
      reasoning('r2', '. Click'),
      reasoning('r3', 'the appropriate elements to open the transcript 4. Extract and return the transcript text'),
      reasoning('r4', '.'),
    ];

    const out = compactReasoningTraceSteps(steps);
    expect(out).toHaveLength(1);
    // Word seam between fragments is repaired (no "Clickthe"), period seams kept.
    expect(out[0].content).toContain('button 3. Click the appropriate elements');
    expect(out[0].content).not.toContain('Clickthe');
    // Label is a clean first sentence, not a "." or ". Click" fragment.
    expect(String(out[0].label).startsWith('Get interactive elements')).toBe(true);
  });

  it('keeps reasoning on opposite sides of a visible tool separate', () => {
    const steps = [
      reasoning('r1', 'First I will inspect the page.'),
      toolStep('t1'),
      reasoning('r2', 'Now I will click the button.'),
    ];
    const out = compactReasoningTraceSteps(steps);
    expect(out.map((s) => s.kind)).toEqual(['reasoning', 'tool', 'reasoning']);
  });

  it('drops a lone punctuation-only reasoning fragment', () => {
    const out = compactReasoningTraceSteps([toolStep('t1'), reasoning('r1', '.')]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('tool');
  });

  it('does not merge reasoning from different subagents', () => {
    const steps = [
      reasoning('r1', 'Subagent A is thinking about the task.', { nested: true, subagentId: 'a' }),
      reasoning('r2', 'Subagent B is doing something else entirely.', { nested: true, subagentId: 'b' }),
    ];
    expect(compactReasoningTraceSteps(steps)).toHaveLength(2);
  });
});
