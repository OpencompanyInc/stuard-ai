import { createRequire } from 'node:module';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';

const require = createRequire(import.meta.url);

function loadOptionalExport<T>(specifier: string, exportName: string): T | null {
  try {
    const mod = require(specifier) as Record<string, T>;
    return mod?.[exportName] || null;
  } catch {
    return null;
  }
}

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

    if (provider === 'xai') {
      const xai = loadOptionalExport<(modelId: string) => any>('@ai-sdk/xai', 'xai');
      return xai ? xai(mid) : null;
    }
    if (provider === 'google') return google(mid);
    if (provider === 'deepseek') {
      const deepseek = loadOptionalExport<(modelId: string) => any>('@ai-sdk/deepseek', 'deepseek');
      return deepseek ? deepseek(mid) : null;
    }
    if (provider === 'openai' || provider === 'penai') {
      const isReasoningModel = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(mid);
      return isReasoningModel ? openai.responses(mid) : openai(mid);
    }
    if (provider === 'anthropic') {
      const anthropic = loadOptionalExport<(modelId: string) => any>('@ai-sdk/anthropic', 'anthropic');
      return anthropic ? anthropic(mid) : null;
    }
    if (provider === 'perplexity') {
      const apiKey = process.env.PERPLEXITY_API_KEY || '';
      if (!apiKey) return null;
      const { createOpenAI } = require('@ai-sdk/openai');
      const perplexity = createOpenAI({
        apiKey,
        baseURL: 'https://api.perplexity.ai/',
      });
      return perplexity(mid);
    }
    if (provider === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      const createOpenRouter = loadOptionalExport<(args: { apiKey: string }) => (modelId: string) => any>(
        '@openrouter/ai-sdk-provider',
        'createOpenRouter',
      );
      if (!createOpenRouter) return null;
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




