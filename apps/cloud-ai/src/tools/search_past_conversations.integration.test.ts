import { describe, expect, it, vi } from 'vitest';

vi.mock('./bridge', async () => {
  const actual = await vi.importActual<typeof import('./bridge')>('./bridge');
  return {
    ...actual,
    hasClientBridge: () => true,
  };
});

import { execLocalTool } from './bridge';
import { search_past_conversations } from './device-tools';

describe.runIf(process.env.RUN_SEARCH_PAST_CONVERSATIONS_INTEGRATION_TESTS === '1')(
  'search_past_conversations integration (opt-in)',
  () => {
    it('returns results for an existing segment summary query', async () => {
      const overrideQuery = String(process.env.MEMORY_SEARCH_QUERY || '').trim();
      const mode = String(process.env.MEMORY_SEARCH_MODE || '').trim();
      const since = String(process.env.MEMORY_SEARCH_SINCE || '').trim() || undefined;
      const before = String(process.env.MEMORY_SEARCH_BEFORE || '').trim() || undefined;
      const stats = await execLocalTool('memory_stats', {}, undefined, 30000, { silent: true });
      const segs = Number(
        (mode === 'recent'
          ? (stats?.stats?.segments ?? 0)
          : (stats?.stats?.segments_with_embedding ?? stats?.stats?.segments ?? 0))
      );
      if (segs <= 0) {
        expect(segs).toBe(0);
        return;
      }

      const summary = (() => {
        if (mode === 'recent') return '';
        return String(stats?.stats?.latest_segment_summary || '').trim();
      })();

      let query = mode === 'recent' ? '' : (overrideQuery || summary);
      if (!query && mode !== 'recent') {
        const zero = Array.from({ length: 3072 }, () => 0);
        const sample = await execLocalTool(
          'segment_search',
          { embedding: zero, limit: 1, threshold: 0.0 },
          undefined,
          30000,
          { silent: true }
        );

        expect(sample?.ok).toBe(true);
        expect(Array.isArray(sample?.results)).toBe(true);
        expect(sample.results.length).toBeGreaterThan(0);

        const first = sample.results[0];
        const s = String(first?.segment?.summary || '').trim();
        expect(s.length).toBeGreaterThan(0);
        query = overrideQuery || s;
      }

      const out = await (search_past_conversations as any).execute({
        context: {
          query,
          limit: 5,
          filter: mode
            ? {
                mode,
                since,
                before,
              }
            : undefined,
        },
      });

      expect(out?.ok).toBe(true);
      expect(Array.isArray(out?.results)).toBe(true);
      if (mode === 'recent') {
        if (!since && !before) {
          expect(out.results.length).toBeGreaterThan(0);
        }
      } else if (!overrideQuery) {
        expect(out.results.length).toBeGreaterThan(0);
      }

      console.log({
        query: query.slice(0, 120),
        mode: mode || undefined,
        since,
        before,
        top: out.results.slice(0, 3).map((r: any) => ({
          conversation_id: r.conversation_id,
          score: r.score,
          topics: r.topics,
          summary: String(r.summary || '').slice(0, 120),
        })),
      });
    }, 60000);
  }
);
