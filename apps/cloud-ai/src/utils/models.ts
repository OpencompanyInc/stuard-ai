import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import { deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

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
    if (provider === 'openai' || provider === 'penai') return openai(mid);
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




