import { describe, expect, it } from 'vitest';

import { execLocalTool } from '../tools/bridge';

describe.runIf(process.env.RUN_LOCAL_MEMORY_SEARCH_INTEGRATION_TESTS === '1')(
  'Local memory segment_search integration (opt-in)',
  () => {
    it('segment_search returns results for a zero vector when segments exist', async () => {
      const stats = await execLocalTool('memory_stats', {}, undefined, 30000, { silent: true });
      const segs = Number(stats?.stats?.segments_with_embedding ?? stats?.stats?.segments ?? 0);
      if (segs <= 0) {
        expect(segs).toBe(0);
        return;
      }

      const embedding = Array.from({ length: 3072 }, () => 0);
      const result = await execLocalTool(
        'segment_search',
        { embedding, limit: 5, threshold: 0.0 },
        undefined,
        30000,
        { silent: true }
      );

      expect(result?.ok).toBe(true);
      expect(Array.isArray(result?.results)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });
  }
);
