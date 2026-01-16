import { xai } from '@ai-sdk/xai';
import { google } from '@ai-sdk/google';
import { deepseek } from '@ai-sdk/deepseek';
import { openai } from '@ai-sdk/openai';

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
    return null;
  } catch {
    return null;
  }
};



