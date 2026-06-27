import { describe, expect, it } from 'vitest';

import { normalizeVoiceEntry, modelCanDoTts, normalizeModelEntry } from './tts-tools';

describe('normalizeVoiceEntry', () => {
  it('reads the camelCase voiceId the SDK actually returns', () => {
    // Regression: the code used v.voice_id (always undefined on the v2 SDK),
    // which made the required id: z.string() fail output validation.
    const v = normalizeVoiceEntry({ voiceId: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' });
    expect(v.id).toBe('JBFqnCBsd6RMkjVDRZzb');
    expect(v.name).toBe('George');
  });

  it('still accepts a legacy snake_case voice_id', () => {
    expect(normalizeVoiceEntry({ voice_id: 'abc', name: 'Old' }).id).toBe('abc');
  });

  it('always yields strings for the schema-required fields', () => {
    const v = normalizeVoiceEntry({ voiceId: 'x' }); // no name, no description
    expect(typeof v.id).toBe('string');
    expect(typeof v.name).toBe('string');
    expect(typeof v.description).toBe('string');
    expect(v.name).toBe('x'); // falls back to id
  });

  it('derives a description from labels when none is provided', () => {
    const v = normalizeVoiceEntry({
      voiceId: 'x',
      name: 'Narrator',
      labels: { accent: 'american', age: 'middle-aged', use_case: 'narration' },
    });
    expect(v.description).toContain('american');
    expect(v.labels).toEqual({ accent: 'american', age: 'middle-aged', use_case: 'narration' });
  });

  it('emits an empty id for junk so the caller can filter it out', () => {
    expect(normalizeVoiceEntry({}).id).toBe('');
    expect(normalizeVoiceEntry(null).id).toBe('');
  });
});

describe('modelCanDoTts', () => {
  it('reads camelCase canDoTextToSpeech', () => {
    expect(modelCanDoTts({ canDoTextToSpeech: true })).toBe(true);
    expect(modelCanDoTts({ canDoTextToSpeech: false })).toBe(false);
  });

  it('falls back to snake_case, then defaults to included', () => {
    expect(modelCanDoTts({ can_do_text_to_speech: true })).toBe(true);
    expect(modelCanDoTts({})).toBe(true); // missing flag → don't silently hide the model
  });
});

describe('normalizeModelEntry', () => {
  it('reads camelCase modelId', () => {
    const m = normalizeModelEntry({ modelId: 'eleven_multilingual_v2', name: 'Multilingual v2' });
    expect(m.id).toBe('eleven_multilingual_v2');
    expect(m.name).toBe('Multilingual v2');
  });

  it('accepts legacy snake_case model_id and coerces required fields to strings', () => {
    const m = normalizeModelEntry({ model_id: 'eleven_turbo_v2_5' });
    expect(m.id).toBe('eleven_turbo_v2_5');
    expect(typeof m.name).toBe('string');
    expect(typeof m.description).toBe('string');
  });
});
