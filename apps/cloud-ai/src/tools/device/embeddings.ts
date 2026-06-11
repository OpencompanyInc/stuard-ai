import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embed, embedMany } from 'ai';
import { resolveEmbedder, cosineSimilarity } from '../../utils/embeddings';
import { anyJsonObject } from './shared';

export const embed_text = createTool({
  id: 'embed_text',
  description:
    'Generate a vector embedding for one or more text strings using Gemini Embedding 2. Returns an array of 3072-dim float vectors. Supports semantic search, similarity matching, clustering, and classification in workflows.',
  inputSchema: z.object({
    texts: z
      .array(z.string())
      .min(1)
      .max(100)
      .describe('Array of text strings to embed (max 100)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    embeddings: z
      .array(z.array(z.number()))
      .optional()
      .describe('Array of embedding vectors (one per input text)'),
    dimensions: z.number().optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const texts = (inputData as any).texts as string[];
      if (!texts || texts.length === 0) {
        return { ok: false, error: 'No texts provided' };
      }

      const { embedder } = await resolveEmbedder();
      const result = await embedMany({
        model: embedder as any,
        values: texts,
      });

      return {
        ok: true,
        embeddings: result.embeddings,
        dimensions: result.embeddings[0]?.length || 0,
        count: result.embeddings.length,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

export const vector_similarity = createTool({
  id: 'vector_similarity',
  description:
    'Compute cosine similarity between a query vector and a list of candidate vectors. Returns scored results sorted by similarity (highest first). Use this after embed_text to find the most similar items.',
  inputSchema: z.object({
    query: z
      .array(z.number())
      .describe('The query embedding vector'),
    candidates: z
      .array(
        z.object({
          id: z.string().describe('Unique identifier for this candidate'),
          vector: z.array(z.number()).describe('Embedding vector'),
          metadata: anyJsonObject.optional().describe('Optional metadata to return with results'),
        }),
      )
      .describe('List of candidate vectors to compare against'),
    topK: z
      .number()
      .optional()
      .default(10)
      .describe('Number of top results to return (default 10)'),
    threshold: z
      .number()
      .optional()
      .default(0)
      .describe('Minimum similarity score to include (0-1, default 0)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z
      .array(
        z.object({
          id: z.string(),
          score: z.number(),
          metadata: z.any().optional(),
        }),
      )
      .optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const { query, candidates, topK, threshold } = inputData as any;
      if (!query || !candidates) {
        return { ok: false, error: 'Missing query or candidates' };
      }

      const scored = candidates
        .map((c: any) => {
          try {
            const score = cosineSimilarity(query, c.vector);
            return { id: c.id, score, metadata: c.metadata };
          } catch {
            return { id: c.id, score: -1, metadata: c.metadata };
          }
        })
        .filter((r: any) => r.score >= (threshold || 0))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, topK || 10);

      return { ok: true, results: scored, count: scored.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

export const embed_and_store = createTool({
  id: 'embed_and_store',
  description:
    'Embed text and return the vector alongside the original content. A convenience tool that combines embedding with metadata preparation — the result can be passed to db_store for persistence. Does NOT store automatically.',
  inputSchema: z.object({
    text: z.string().describe('Text to embed'),
    id: z.string().optional().describe('Optional ID (auto-generated if omitted)'),
    metadata: z
      .record(z.string(), z.any())
      .optional()
      .describe('Optional metadata to attach'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    document: z
      .object({
        id: z.string(),
        text: z.string(),
        vector: z.array(z.number()),
        metadata: z.any().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const { text, id: docId, metadata } = inputData as any;
      if (!text) return { ok: false, error: 'No text provided' };

      const { embedder } = await resolveEmbedder();
      const result = await embed({ model: embedder as any, value: text });

      const finalId =
        docId || `emb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return {
        ok: true,
        document: {
          id: finalId,
          text,
          vector: result.embedding,
          metadata: metadata || undefined,
        },
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});
