import { describe, expect, it } from 'vitest';
import { AskUserInputSchema, AskUserOutputSchema } from './ask-user';

describe('ask_user schemas', () => {
  it('accepts the legacy single-question shape', () => {
    const parsed = AskUserInputSchema.parse({ message: 'Proceed?', type: 'confirm' });
    expect(parsed.message).toBe('Proceed?');
    expect(parsed.type).toBe('confirm');
  });

  it('accepts paged questionnaires', () => {
    const parsed = AskUserInputSchema.parse({
      title: 'Setup',
      pages: [
        { title: 'Profile', questions: [{ id: 'name', message: 'Your name?', type: 'text' }] },
        { title: 'Plan', questions: [{ id: 'plan', message: 'Plan?', type: 'choices', options: [{ id: 'pro', label: 'Pro' }] }] },
      ],
    });
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages?.[1].questions[0].options?.[0].label).toBe('Pro');
  });

  it('accepts combined questionnaire responses', () => {
    const parsed = AskUserOutputSchema.parse({
      ok: true,
      dismissed: false,
      answers: {
        name: { id: 'name', message: 'Your name?', type: 'text', value: 'Solar', text: 'Solar' },
      },
      responses: [
        { id: 'name', message: 'Your name?', type: 'text', value: 'Solar', text: 'Solar' },
      ],
    });
    expect(parsed.answers?.name.text).toBe('Solar');
  });
});