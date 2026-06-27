import { openai } from '@ai-sdk/openai';
import { google } from './models';

const DEFAULT_EMBEDDER = process.env.MEMORY_EMBEDDER_MODEL || process.env.EMBEDDER_MODEL_ID || 'google/gemini-embedding-2-preview';

export const EMBEDDING_DIMENSIONS = 3072;

export function embeddingDimForModel(modelId: string): number {
  const m = (modelId || '').toLowerCase();
  if (m.includes('gemini-embedding')) return 3072;
  if (m.includes('text-embedding-3-large')) return 3072;
  if (m.includes('text-embedding-004')) return 768;
  if (m.includes('text-embedding-ada-002')) return 1536;
  return 3072;
}

export async function resolveEmbedder(_writer?: any, _override?: string) {
  const modelId = _override || DEFAULT_EMBEDDER;
  let embedder;
  if (modelId.startsWith('google/')) {
    const googleModelId = modelId.replace('google/', '');
    embedder = google.textEmbeddingModel(googleModelId);
  } else if (modelId.startsWith('openai/')) {
    const openaiModelId = modelId.replace('openai/', '');
    embedder = openai.embedding(openaiModelId);
  } else {
    // Default to Gemini embedding
    embedder = google.textEmbeddingModel('gemini-embedding-2-preview');
  }
  return { embedder, modelId } as const;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    // Allow soft failure or return 0 if dimensions mismatch in some edge cases?
    // Strict is better for debugging.
    throw new Error(`Vectors must have same dimensions (got ${vecA.length} and ${vecB.length})`);
  }
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}















