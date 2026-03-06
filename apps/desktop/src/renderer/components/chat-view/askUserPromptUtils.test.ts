import { describe, expect, it } from 'vitest';
import { buildAskUserResult, normalizeAskUserPrompt } from './askUserPromptUtils';

describe('askUserPromptUtils', () => {
  it('normalizes the legacy single-question ask_user format', () => {
    const prompt = normalizeAskUserPrompt({ message: 'What should I do?', type: 'choices', options: [{ id: 'a', label: 'Option A' }] });
    expect(prompt.isLegacySingle).toBe(true);
    expect(prompt.pages).toHaveLength(1);
    expect(prompt.pages[0].questions[0].type).toBe('choices');
  });

  it('turns top-level questions into a paged flow', () => {
    const prompt = normalizeAskUserPrompt({
      title: 'Setup',
      questions: [
        { id: 'name', message: 'Your name?', type: 'text' },
        { id: 'plan', message: 'Pick a plan', type: 'choices', options: [{ id: 'pro', label: 'Pro' }] },
      ],
    });
    expect(prompt.isLegacySingle).toBe(false);
    expect(prompt.pages).toHaveLength(2);
    expect(prompt.pages[1].questions[0].id).toBe('plan');
  });

  it('builds combined results for multi-page responses', () => {
    const prompt = normalizeAskUserPrompt({
      pages: [
        { title: 'Profile', questions: [{ id: 'name', message: 'Your name?', type: 'text' }] },
        { title: 'Plan', questions: [{ id: 'plan', message: 'Pick a plan', type: 'choices', options: [{ id: 'pro', label: 'Pro' }] }] },
      ],
    });
    const result = buildAskUserResult(prompt, { name: 'Solar', plan: 'pro' });
    expect(result.ok).toBe(true);
    expect(result.responses).toHaveLength(2);
    expect(result.answers.plan.selectedLabel).toBe('Pro');
  });

  it('accepts form-like pages with fields and select types', () => {
    const prompt = normalizeAskUserPrompt({
      title: 'Project Direction',
      pages: [
        {
          title: 'Which flavor of projects are you feeling right now?',
          fields: [
            {
              id: 'direction',
              type: 'select',
              label: 'Which flavor of projects are you feeling right now?',
              options: ['Creative', 'Business', 'Technical'],
            },
          ],
        },
      ],
    });
    expect(prompt.pages).toHaveLength(1);
    expect(prompt.pages[0].questions[0].type).toBe('choices');
    expect(prompt.pages[0].questions[0].options.map((option) => option.label)).toEqual(['Creative', 'Business', 'Technical']);
  });

  it('accepts prompt/choices aliases for dynamic questionnaires', () => {
    const prompt = normalizeAskUserPrompt({
      questions: [
        {
          id: 'direction',
          prompt: 'Which flavor of projects are you feeling right now?',
          choices: [
            { value: 'creative', text: 'Creative' },
            { value: 'business', text: 'Business' },
          ],
        },
      ],
    });
    expect(prompt.pages[0].questions[0].message).toContain('Which flavor');
    expect(prompt.pages[0].questions[0].type).toBe('choices');
    expect(prompt.pages[0].questions[0].options[0].id).toBe('creative');
  });

  it('preserves legacy result fields for single prompts', () => {
    const prompt = normalizeAskUserPrompt({ message: 'Proceed?', type: 'confirm' });
    const result = buildAskUserResult(prompt, { question_1: true });
    expect('confirmed' in result && result.confirmed).toBe(true);
    expect(result.responses[0].type).toBe('confirm');
  });
});