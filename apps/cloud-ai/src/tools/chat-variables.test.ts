import { describe, expect, it, beforeEach } from 'vitest';
import {
  setVar,
  getVar,
  listVars,
  deleteVar,
  clearConversationVars,
  resolveVarRefs,
  captureLargeOutputs,
} from './chat-variables';

const CONV_A = 'conv:test-a';
const CONV_B = 'conv:test-b';

describe('chat-variables store', () => {
  beforeEach(() => {
    clearConversationVars(CONV_A);
    clearConversationVars(CONV_B);
  });

  it('sets, gets, lists, and deletes a variable', () => {
    setVar(CONV_A, 'greeting', 'hello');
    expect(getVar(CONV_A, 'greeting')?.value).toBe('hello');

    const listed = listVars(CONV_A);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('greeting');
    // list must not leak the full value, only metadata/preview
    expect(listed[0]).not.toHaveProperty('value');

    expect(deleteVar(CONV_A, 'greeting')).toBe(true);
    expect(getVar(CONV_A, 'greeting')).toBeUndefined();
  });

  it('isolates variables per conversation', () => {
    setVar(CONV_A, 'x', 1);
    setVar(CONV_B, 'x', 2);
    expect(getVar(CONV_A, 'x')?.value).toBe(1);
    expect(getVar(CONV_B, 'x')?.value).toBe(2);
    clearConversationVars(CONV_A);
    expect(getVar(CONV_A, 'x')).toBeUndefined();
    expect(getVar(CONV_B, 'x')?.value).toBe(2);
  });
});

describe('resolveVarRefs', () => {
  beforeEach(() => clearConversationVars(CONV_A));

  it('rehydrates an exact handle to its raw (non-string) value', () => {
    setVar(CONV_A, 'payload', { big: true, n: 42 });
    const out = resolveVarRefs(CONV_A, { data: '{{var:payload}}' });
    expect(out.data).toEqual({ big: true, n: 42 });
  });

  it('substitutes a handle embedded in a larger string', () => {
    setVar(CONV_A, 'name', 'Ada');
    const out = resolveVarRefs(CONV_A, { msg: 'Hi {{var:name}}!' });
    expect(out.msg).toBe('Hi Ada!');
  });

  it('leaves unknown handles untouched so the model can self-correct', () => {
    const out = resolveVarRefs(CONV_A, { data: '{{var:missing}}' });
    expect(out.data).toBe('{{var:missing}}');
  });

  it('walks nested arrays and objects', () => {
    setVar(CONV_A, 'img', 'BASE64DATA');
    const out = resolveVarRefs(CONV_A, { items: [{ src: '{{var:img}}' }] });
    expect(out.items[0].src).toBe('BASE64DATA');
  });
});

describe('captureLargeOutputs', () => {
  beforeEach(() => clearConversationVars(CONV_A));

  it('stores an oversized base64 image field as a reusable img handle and removes the raw bytes', () => {
    const bigPayload = 'a'.repeat(800_000);
    const captured: any = captureLargeOutputs(CONV_A, {
      ok: true,
      images: [{ filePath: 'C:/generated/cat.png', format: 'png', imageB64: bigPayload }],
    });

    // metadata preserved
    expect(captured.images[0].filePath).toBe('C:/generated/cat.png');
    // raw bytes replaced by a handle ref — the field name signals image kind
    const ref = captured.images[0].imageB64;
    expect(ref).toHaveProperty('_ref');
    expect(typeof ref._ref).toBe('string');
    expect(ref._ref).toMatch(/^\{\{var:img_\d+\}\}$/);
    expect(JSON.stringify(captured).length).toBeLessThan(10_000);

    // the handle round-trips back to the original bytes via resolveVarRefs
    const rehydrated = resolveVarRefs(CONV_A, { data: ref._ref });
    expect(rehydrated.data).toBe(bigPayload);
  });

  it('captures an unlabeled oversized base64 field as a generic blob handle', () => {
    const bigPayload = 'a'.repeat(800_000);
    const captured: any = captureLargeOutputs(CONV_A, { ok: true, data: bigPayload });
    expect(captured.data._ref).toMatch(/^\{\{var:blob_\d+\}\}$/);
    const rehydrated = resolveVarRefs(CONV_A, captured.data._ref);
    expect(rehydrated).toBe(bigPayload);
  });

  it('captures a bare oversized data URL string', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(5000);
    const captured: any = captureLargeOutputs(CONV_A, dataUrl);
    expect(captured).toHaveProperty('_ref');
    expect(captured.kind).toBe('img');
    const rehydrated = resolveVarRefs(CONV_A, captured._ref);
    expect(rehydrated).toBe(dataUrl);
  });

  it('passes small values through untouched', () => {
    const small = { ok: true, text: 'short answer' };
    expect(captureLargeOutputs(CONV_A, small)).toEqual(small);
  });

  it('captures an oversized text content field (long file read) as a text handle', () => {
    const longText = 'The quick brown fox. '.repeat(2000); // ~42k chars
    const captured: any = captureLargeOutputs(CONV_A, {
      ok: true,
      content: longText,
      total_lines: 1,
    });
    // metadata preserved, raw text replaced by a handle + generous preview
    expect(captured.total_lines).toBe(1);
    expect(captured.content._ref).toMatch(/^\{\{var:text_\d+\}\}$/);
    expect(captured.content.chars).toBe(longText.length);
    expect(typeof captured.content.preview).toBe('string');
    expect(captured.content.preview.length).toBeLessThan(longText.length);
    // full text round-trips via the handle
    const rehydrated = resolveVarRefs(CONV_A, captured.content._ref);
    expect(rehydrated).toBe(longText);
  });

  it('captures a subagent result string (delegate boundary) as a text handle', () => {
    const bigResult = 'Findings: '.repeat(1500); // ~15k chars
    const captured: any = captureLargeOutputs(CONV_A, {
      ok: true,
      subagentId: 'sub_1',
      result: bigResult,
      completed: true,
    });
    expect(captured.subagentId).toBe('sub_1');
    expect(captured.result._ref).toMatch(/^\{\{var:text_\d+\}\}$/);
    expect(resolveVarRefs(CONV_A, captured.result._ref)).toBe(bigResult);
  });

  it('does not capture medium text below the threshold', () => {
    const mediumText = 'hello world. '.repeat(300); // ~3.9k chars, not base64-shaped
    const captured: any = captureLargeOutputs(CONV_A, { ok: true, content: mediumText });
    expect(captured.content).toBe(mediumText);
  });

  it('does not sweep up non-payload string fields like error/preview', () => {
    const longErr = 'boom '.repeat(3000); // ~15k chars, but not a payload key
    const captured: any = captureLargeOutputs(CONV_A, { ok: false, error: longErr });
    expect(captured.error).toBe(longErr);
  });
});
