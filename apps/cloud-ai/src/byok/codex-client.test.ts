import { describe, expect, it } from 'vitest';

import { transformBody } from './codex-client';

describe('transformBody', () => {
  it('keeps paired function call inputs structured in stateless mode', () => {
    const transformed = transformBody({
      store: true,
      stream: false,
      previous_response_id: 'resp_previous',
      conversation: 'conv_previous',
      input: [
        { type: 'item_reference', id: 'fc_old' },
        {
          type: 'function_call',
          id: 'fc_123',
          call_id: 'call_123',
          name: 'create_folder',
          arguments: '{"path":"C:/Users/solar/Test"}',
        },
        {
          type: 'function_call_output',
          id: 'fco_123',
          call_id: 'call_123',
          output: '{"ok":true}',
        },
      ],
    }, 'gpt-5.1-codex', true);

    expect(transformed.store).toBe(false);
    expect(transformed.stream).toBe(true);
    expect(transformed.previous_response_id).toBeUndefined();
    expect(transformed.conversation).toBeUndefined();
    expect(transformed.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call',
          call_id: 'call_123',
          name: 'create_folder',
          arguments: '{"path":"C:/Users/solar/Test"}',
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_123',
          output: '{"ok":true}',
        }),
      ]),
    );
    expect(transformed.input.some((item: any) => item.type === 'item_reference')).toBe(false);
    expect(transformed.input.some((item: any) => item.id === 'fc_123' || item.id === 'fco_123')).toBe(false);
  });

  it('does not leak orphan wording when falling back for unmatched outputs', () => {
    const transformed = transformBody({
      input: [
        {
          type: 'function_call_output',
          call_id: 'call_missing',
          output: 'created folder',
        },
      ],
    }, 'gpt-5.1-codex', true);

    const text = JSON.stringify(transformed.input);
    expect(text).toContain('Tool result from previous step: created folder');
    expect(text).not.toContain('orphan');
  });
});
