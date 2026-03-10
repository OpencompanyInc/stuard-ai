import { xai } from '@ai-sdk/xai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// Single configured Google provider — reads GOOGLE_API_KEY (works for both Gemini and Cloud Vision)
export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '',
});

/**
 * Builds an AI SDK model instance from a provider/model-id string.
 * Format: "provider/model-id" (e.g. "openai/gpt-4.1")
 */
export const buildProviderModel = (id: string): any | null => {
  try {
    const raw = String(id || '').trim();
    const idx = raw.indexOf('/');
    if (idx <= 0 || idx >= raw.length - 1) return null;
    const provider = raw.slice(0, idx).toLowerCase();
    const mid = raw.slice(idx + 1);
    if (!mid) return null;

    if (provider === 'xai') return xai(mid);
    if (provider === 'google') return google(mid);
    if (provider === 'deepseek') return deepseek(mid);
    if (provider === 'openai' || provider === 'penai') {
      // o-series and gpt-5 models: use Responses API to expose reasoning summaries
      const isReasoningModel = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(mid);
      return isReasoningModel ? openai.responses(mid) : openai(mid);
    }
    if (provider === 'anthropic') return anthropic(mid);
    if (provider === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      const openrouter = createOpenRouter({ apiKey });
      return openrouter(mid);
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Builds an AI SDK embedding model instance from a provider/model-id string.
 * Format: "provider/model-id" (e.g. "openai/text-embedding-3-large")
 */
export const buildProviderEmbeddingModel = (id: string): any | null => {
  try {
    const raw = String(id || '').trim();
    const idx = raw.indexOf('/');
    if (idx <= 0 || idx >= raw.length - 1) return null;
    const provider = raw.slice(0, idx).toLowerCase();
    const mid = raw.slice(idx + 1);
    if (!mid) return null;

    if (provider === 'openai' || provider === 'penai') return openai.embedding(mid);
    if (provider === 'google') return google.textEmbeddingModel(mid);
    
    return null;
  } catch {
    return null;
  }
};




