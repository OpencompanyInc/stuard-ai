import { describe, expect, it } from 'vitest';

import { generateEmbedding } from './conversations';

describe.runIf(!!process.env.OPENAI_API_KEY && process.env.RUN_OPENAI_INTEGRATION_TESTS === '1')(
  'OpenAI embedding integration (opt-in)',
  () => {
  it('generateEmbedding returns a 3072-dim vector', async () => {
    const vec = await generateEmbedding('test embedding');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(3072);
  });
  }
);
