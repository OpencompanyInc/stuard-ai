/**
 * Voice realtime model pricing.
 *
 * Kept separate from `pricing.ts` because realtime voice models charge for
 * audio tokens at very different rates than text tokens, and the central
 * `priceForModel` table only has a single flat in/out rate. Providers compute
 * cost here and pass `costUsd` on the VoiceUsageEvent — the billing tracker
 * prefers explicit cost over estimating from a flat in/out rate.
 *
 * Rates are USD per million tokens unless noted. Update when providers ship
 * GA pricing for their preview models.
 */

interface VoiceModelPricing {
  /** Text input $/MTok */
  textInPerMTok: number;
  /** Text output $/MTok */
  textOutPerMTok: number;
  /** Audio input $/MTok */
  audioInPerMTok: number;
  /** Audio output $/MTok */
  audioOutPerMTok: number;
  /** Cached input $/MTok (text). Audio cache rates folded in here when published. */
  cachedInPerMTok: number;
}

const DEFAULT_PRICING: VoiceModelPricing = {
  textInPerMTok: 5,
  textOutPerMTok: 20,
  audioInPerMTok: 40,
  audioOutPerMTok: 80,
  cachedInPerMTok: 0.5,
};

// OpenAI Realtime — published Dec 2025 GA rates.
// https://platform.openai.com/docs/pricing
const OPENAI_REALTIME: Record<string, VoiceModelPricing> = {
  'gpt-4o-realtime-preview': {
    textInPerMTok: 5,
    textOutPerMTok: 20,
    audioInPerMTok: 40,
    audioOutPerMTok: 80,
    cachedInPerMTok: 2.5,
  },
  'gpt-4o-mini-realtime-preview': {
    textInPerMTok: 0.6,
    textOutPerMTok: 2.4,
    audioInPerMTok: 10,
    audioOutPerMTok: 20,
    cachedInPerMTok: 0.3,
  },
};

// Google Gemini Live — preview pricing tracks the 2.5 Flash Live rates.
// Audio rates from https://ai.google.dev/pricing.
const GEMINI_LIVE: Record<string, VoiceModelPricing> = {
  'gemini-3.1-flash-live-preview': {
    textInPerMTok: 0.3,
    textOutPerMTok: 2.5,
    audioInPerMTok: 3,
    audioOutPerMTok: 12,
    cachedInPerMTok: 0.075,
  },
  'gemini-2.5-flash-native-audio-preview-12-2025': {
    textInPerMTok: 0.3,
    textOutPerMTok: 2.5,
    audioInPerMTok: 3,
    audioOutPerMTok: 12,
    cachedInPerMTok: 0.075,
  },
};

// xAI Grok Voice Agent — no published voice rates, so approximate with grok-3 text rates
// and a 4x audio multiplier (matches the OpenAI/Gemini ratio).
const GROK_REALTIME: Record<string, VoiceModelPricing> = {
  'grok-3': {
    textInPerMTok: 3,
    textOutPerMTok: 15,
    audioInPerMTok: 12,
    audioOutPerMTok: 60,
    cachedInPerMTok: 0.75,
  },
};

const PROVIDER_TABLES: Record<string, Record<string, VoiceModelPricing>> = {
  'openai-realtime': OPENAI_REALTIME,
  'gemini-live': GEMINI_LIVE,
  'grok-realtime': GROK_REALTIME,
};

export function getVoicePricing(providerId: string, modelId: string): VoiceModelPricing {
  const table = PROVIDER_TABLES[providerId] || {};
  return table[modelId] || table[Object.keys(table)[0]] || DEFAULT_PRICING;
}

export interface VoiceTokenBreakdown {
  textInputTokens?: number;
  textOutputTokens?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  cachedInputTokens?: number;
}

export function computeVoiceCostUsd(
  providerId: string,
  modelId: string,
  tokens: VoiceTokenBreakdown,
): number {
  const p = getVoicePricing(providerId, modelId);
  const textIn = Math.max(0, Number(tokens.textInputTokens || 0));
  const textOut = Math.max(0, Number(tokens.textOutputTokens || 0));
  const audioIn = Math.max(0, Number(tokens.audioInputTokens || 0));
  const audioOut = Math.max(0, Number(tokens.audioOutputTokens || 0));
  const cached = Math.max(0, Math.min(textIn, Number(tokens.cachedInputTokens || 0)));
  const nonCachedTextIn = Math.max(0, textIn - cached);

  const cost =
    (nonCachedTextIn / 1_000_000) * p.textInPerMTok +
    (cached / 1_000_000) * p.cachedInPerMTok +
    (textOut / 1_000_000) * p.textOutPerMTok +
    (audioIn / 1_000_000) * p.audioInPerMTok +
    (audioOut / 1_000_000) * p.audioOutPerMTok;

  return Math.max(0, Number(cost.toFixed(8)));
}

// ── ElevenLabs (duration-based) ──────────────────────────────────────────────
// ConvAI billing is per-minute on their side. ~$0.18/min for the Turbo model
// (Business plan), ~$0.30/min for Multilingual. Default to Turbo.
const ELEVENLABS_USD_PER_MIN: Record<string, number> = {
  eleven_turbo_v2_5: 0.18,
  eleven_turbo_v2: 0.18,
  eleven_multilingual_v2: 0.3,
  eleven_flash_v2_5: 0.12,
};

export function computeElevenLabsCostUsd(modelId: string | undefined, durationMs: number): number {
  const perMin = ELEVENLABS_USD_PER_MIN[String(modelId || 'eleven_turbo_v2_5')] ?? 0.18;
  if (perMin <= 0 || durationMs <= 0) return 0;
  const minutes = durationMs / 60_000;
  return Math.max(0, Number((perMin * minutes).toFixed(8)));
}
