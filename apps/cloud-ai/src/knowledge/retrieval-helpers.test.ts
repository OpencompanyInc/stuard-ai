import { describe, it, expect } from 'vitest';
import { computeCompositeScore, mmrRerank, hasTemporalIntent } from './retrieval';

describe('computeCompositeScore', () => {
  it('weights cosine heaviest', () => {
    const high = computeCompositeScore(0.9, { created_at: new Date().toISOString(), confidence: 1.0 });
    const low = computeCompositeScore(0.1, { created_at: new Date().toISOString(), confidence: 1.0 });
    expect(high).toBeGreaterThan(low);
  });

  it('boosts user_manual source', () => {
    const ai = computeCompositeScore(0.5, { source: 'ai_extracted', confidence: 1.0 });
    const user = computeCompositeScore(0.5, { source: 'user_manual', confidence: 1.0 });
    expect(user).toBeGreaterThan(ai);
  });

  it('applies temporalBoost only for items <30d old', () => {
    const now = new Date().toISOString();
    const oldDate = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
    const recentBoosted = computeCompositeScore(0.5, { created_at: now }, { temporalBoost: true });
    const recentBase = computeCompositeScore(0.5, { created_at: now });
    expect(recentBoosted).toBeGreaterThan(recentBase);
    const oldBoosted = computeCompositeScore(0.5, { created_at: oldDate }, { temporalBoost: true });
    const oldBase = computeCompositeScore(0.5, { created_at: oldDate });
    expect(oldBoosted).toBeCloseTo(oldBase, 5);
  });

  it('applies conversationBoost additively', () => {
    const base = computeCompositeScore(0.5, { confidence: 1.0 });
    const boosted = computeCompositeScore(0.5, { confidence: 1.0 }, { conversationBoost: 0.10 });
    expect(boosted - base).toBeCloseTo(0.10, 5);
  });
});

describe('mmrRerank', () => {
  it('passes all candidates through when k >= candidates (no rerank needed)', () => {
    const candidates = [
      { score: 0.3, vector: [1, 0] },
      { score: 0.9, vector: [0, 1] },
    ];
    const result = mmrRerank(candidates, 5, 0.7, (c) => c.score);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.item).sort()).toEqual([0.3, 0.9]);
  });

  it('penalises near-duplicates via diversity', () => {
    // Two near-identical vectors compete with one different vector.
    const candidates = [
      { id: 'a', score: 0.9, vector: [1, 0, 0] },
      { id: 'b', score: 0.89, vector: [1, 0, 0] },         // near-dup of a
      { id: 'c', score: 0.7, vector: [0, 1, 0] },          // diverse
    ];
    const picked = mmrRerank(candidates, 2, 0.7, (c) => c.id);
    expect(picked[0]).toEqual({ item: 'a', score: 0.9 });
    // Without MMR, 'b' would be picked second (score 0.89 > 0.7). With MMR,
    // 'c' should win because it's not a near-duplicate of 'a'.
    expect(picked[1].item).toBe('c');
  });

  it('falls back to score order when vectors are missing', () => {
    const candidates = [
      { id: 'a', score: 0.5 },
      { id: 'b', score: 0.9 },
      { id: 'c', score: 0.7 },
    ];
    const picked = mmrRerank(candidates, 2, 0.7, (c) => c.id);
    expect(picked.map((p) => p.item)).toEqual(['b', 'c']);
  });
});

describe('hasTemporalIntent', () => {
  it('detects recency keywords', () => {
    expect(hasTemporalIntent('what did I say recently')).toBe(true);
    expect(hasTemporalIntent('show me last week')).toBe(true);
    expect(hasTemporalIntent('today')).toBe(true);
  });
  it('returns false for non-temporal queries', () => {
    expect(hasTemporalIntent('what is the auth flow')).toBe(false);
    expect(hasTemporalIntent('')).toBe(false);
  });
});
