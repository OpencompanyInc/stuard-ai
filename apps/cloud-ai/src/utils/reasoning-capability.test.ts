import { describe, expect, it } from 'vitest';

import {
  clampEffortToControl,
  heuristicReasoningControl,
  resolveEffectiveReasoning,
  resolveReasoningControl,
  type ReasoningControl,
} from './reasoning-capability';

describe('heuristicReasoningControl', () => {
  it('gives Opus 4.8 an extra-high tier and lets it be disabled', () => {
    const c = heuristicReasoningControl('anthropic/claude-opus-4-8');
    expect(c.supported).toBe(true);
    expect(c.levels).toContain('xhigh');
    expect(c.canDisable).toBe(true);
  });

  it('matches the same model behind the OpenRouter transport / dotted version', () => {
    const c = heuristicReasoningControl('openrouter/anthropic/claude-opus-4.8');
    expect(c.levels).toContain('xhigh');
  });

  it('treats Gemini 3 as non-disableable with no extra-high tier', () => {
    const c = heuristicReasoningControl('google/gemini-3.1-pro-preview');
    expect(c.canDisable).toBe(false);
    expect(c.levels).toEqual(['low', 'medium', 'high']);
  });

  it('exposes a minimal tier on Gemini 3 flash', () => {
    const c = heuristicReasoningControl('google/gemini-3-flash-preview');
    expect(c.levels[0]).toBe('minimal');
    expect(c.canDisable).toBe(false);
  });

  it('exposes a minimal tier on GPT-5 and allows disabling', () => {
    const c = heuristicReasoningControl('openai/gpt-5.4');
    expect(c.levels).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(c.canDisable).toBe(true);
  });

  it('keeps o-series reasoning always on', () => {
    const c = heuristicReasoningControl('openai/o3');
    expect(c.canDisable).toBe(false);
    expect(c.levels).toEqual(['low', 'medium', 'high']);
  });

  it('limits Grok to low/high, always on', () => {
    const c = heuristicReasoningControl('xai/grok-4.3');
    expect(c.levels).toEqual(['low', 'high']);
    expect(c.canDisable).toBe(false);
  });

  it('reports non-reasoning Grok / GPT-4o as unsupported', () => {
    expect(heuristicReasoningControl('xai/grok-4.20-0309-non-reasoning').supported).toBe(false);
    expect(heuristicReasoningControl('openai/gpt-4o').supported).toBe(false);
  });

  it('cannot disable Gemini 2.5 Pro but can disable 2.5 Flash', () => {
    expect(heuristicReasoningControl('google/gemini-2.5-pro').canDisable).toBe(false);
    expect(heuristicReasoningControl('google/gemini-2.5-flash').canDisable).toBe(true);
  });
});

describe('resolveReasoningControl', () => {
  it('takes levels from models.dev reasoning_options but disable-ability from family', () => {
    // models.dev shape for Opus 4.8.
    const opts = [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }];
    const c = resolveReasoningControl('openrouter/anthropic/claude-opus-4.8', true, opts);
    expect(c.levels).toEqual(['low', 'medium', 'high', 'xhigh']); // "max" folds into xhigh
    expect(c.canDisable).toBe(true);
  });

  it('keeps Gemini 2.5 Pro non-disableable even though models.dev only lists a budget', () => {
    const opts = [{ type: 'budget_tokens', min: 128, max: 32768 }];
    const c = resolveReasoningControl('google/gemini-2.5-pro', true, opts);
    expect(c.supported).toBe(true);
    expect(c.canDisable).toBe(false);
  });

  it('falls back to a generic ladder for an unknown reasoning model', () => {
    const c = resolveReasoningControl('qwen/qwq-32b', true);
    expect(c.supported).toBe(true);
    expect(c.levels).toEqual(['low', 'medium', 'high']);
    expect(c.canDisable).toBe(true);
  });

  it('reports an unknown non-reasoning model as unsupported', () => {
    expect(resolveReasoningControl('meta-llama/llama-3-8b', false).supported).toBe(false);
  });
});

describe('resolveEffectiveReasoning', () => {
  const offable: ReasoningControl = { supported: true, canDisable: true, levels: ['low', 'high'], default: 'high' };
  const lockedOn: ReasoningControl = { supported: true, canDisable: false, levels: ['low', 'medium', 'high'], default: 'high' };

  it('keeps "none" off when the model allows it', () => {
    expect(resolveEffectiveReasoning('none', offable)).toBe('none');
  });

  it('turns a stale "none" into the model default when it cannot be disabled', () => {
    expect(resolveEffectiveReasoning('none', lockedOn)).toBe('default');
  });

  it('passes effort tiers straight through', () => {
    expect(resolveEffectiveReasoning('xhigh', offable)).toBe('xhigh');
  });
});

describe('clampEffortToControl', () => {
  const lowHigh: ReasoningControl = { supported: true, canDisable: false, levels: ['low', 'high'], default: 'high' };
  const withXhigh: ReasoningControl = { supported: true, canDisable: true, levels: ['low', 'medium', 'high', 'xhigh'], default: 'high' };
  const unknown: ReasoningControl = { supported: false, canDisable: true, levels: [], default: 'medium' };

  it('rounds an unsupported tier down to the model ceiling', () => {
    expect(clampEffortToControl('xhigh', lowHigh)).toBe('high');
    expect(clampEffortToControl('medium', lowHigh)).toBe('low');
  });

  it('keeps a supported tier as-is', () => {
    expect(clampEffortToControl('xhigh', withXhigh)).toBe('xhigh');
  });

  it('only folds the riskiest tier for unknown models', () => {
    expect(clampEffortToControl('xhigh', unknown)).toBe('high');
    expect(clampEffortToControl('minimal', unknown)).toBe('minimal');
  });
});
