/**
 * Shared Per-Request Embedding
 *
 * Generates a single query embedding per prompt and memoizes the Promise
 * so that parallel consumers (memory retrieval, knowledge search, tool ranking)
 * all share the same in-flight embedding call without duplicate OpenAI requests.
 *
 * Cache key: normalized (trimmed + lowercased) prompt text.
 * TTL: 3 minutes – long enough for a full request pipeline, short enough to
 *       avoid stale results across conversations.
 */

import { embed } from 'ai';
import { google } from './models';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const CACHE_TTL_MS = 1000 * 60 * 3; // 3 minutes
const MAX_INPUT_CHARS = 8000;

interface CacheEntry {
  promise: Promise<number[]>;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

// Periodic cleanup to prevent unbounded growth
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.createdAt > CACHE_TTL_MS) {
        cache.delete(key);
      }
    }
    if (cache.size === 0 && _cleanupTimer) {
      clearInterval(_cleanupTimer);
      _cleanupTimer = null;
    }
  }, CACHE_TTL_MS);
  // Allow the process to exit even if the timer is still running
  if (_cleanupTimer && typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    _cleanupTimer.unref();
  }
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().slice(0, MAX_INPUT_CHARS);
}

/**
 * Get or create a shared embedding for the given query text.
 *
 * Multiple concurrent callers with the same (normalized) text will receive
 * the **same** Promise, avoiding duplicate embedding API calls.
 *
 * @param text  The user prompt / query to embed
 * @returns     Promise resolving to the embedding vector (number[])
 */
export function getOrCreateQueryEmbedding(text: string): Promise<number[]> {
  const key = normalizeKey(text);
  if (!key) return Promise.resolve([]);

  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now - existing.createdAt < CACHE_TTL_MS) {
    return existing.promise;
  }

  // Create the embedding promise (not awaited – shared across consumers)
  const promise = embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    value: text.slice(0, MAX_INPUT_CHARS),
  }).then(({ embedding }) => embedding as number[]);

  cache.set(key, { promise, createdAt: now });
  ensureCleanup();

  return promise;
}

/**
 * Retrieve a cached embedding if one exists (already resolved or in-flight).
 * Returns null if the prompt hasn't been embedded yet.
 */
export function getCachedEmbedding(text: string): Promise<number[]> | null {
  const key = normalizeKey(text);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.promise;
}

/**
 * Force-clear the embedding cache (useful for tests).
 */
export function clearEmbeddingCache(): void {
  cache.clear();
}
