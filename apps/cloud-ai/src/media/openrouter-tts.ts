/**
 * OpenRouter text-to-speech (audio generation).
 *
 * Sits alongside the ElevenLabs TTS path: when a `text_to_speech` call selects
 * an OpenRouter audio model (e.g. "openai/gpt-audio"), synthesis is served
 * through Stuard's OpenRouter account using the chat/completions modalities
 * API instead of ElevenLabs. ElevenLabs remains the default and an equally
 * valid choice — the model id decides which provider runs.
 *
 * OpenRouter streams audio as base64 chunks under `delta.audio.data`; the docs
 * require `stream: true`. We accumulate the base64 segments and decode once.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// OpenRouter / OpenAI gpt-audio voices.
export const OPENROUTER_TTS_VOICES = [
  'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'ash', 'ballad', 'coral', 'sage', 'verse',
] as const;

// Audio container formats gpt-audio can emit.
export const OPENROUTER_TTS_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'pcm16'] as const;

const DEFAULT_VOICE = 'alloy';
const DEFAULT_FORMAT = 'mp3';

/** True when the model id targets ElevenLabs (its native models are `eleven_*`). */
export function isElevenLabsTtsModel(model: string): boolean {
  return /^eleven/i.test(String(model || '').trim());
}

/** True when the model id should be served as audio through OpenRouter. */
export function isOpenRouterTtsModel(model: string): boolean {
  const m = String(model || '').trim();
  if (!m) return false;
  if (isElevenLabsTtsModel(m)) return false;
  // Slugs ("openai/gpt-audio") or bare gpt-audio names.
  return m.includes('/') || /gpt-audio|lyria/i.test(m);
}

/** Normalize a bare audio model name into an OpenRouter slug. */
export function normalizeTtsModelId(model: string): string {
  const m = String(model || '').trim();
  if (m.includes('/')) return m;
  if (/^gpt-audio/i.test(m)) return `openai/${m}`;
  if (/^lyria/i.test(m)) return `google/${m}`;
  return m;
}

function resolveVoice(voice?: string): string {
  const v = String(voice || '').trim().toLowerCase();
  return (OPENROUTER_TTS_VOICES as readonly string[]).includes(v) ? v : DEFAULT_VOICE;
}

function resolveFormat(format?: string): string {
  const f = String(format || '').trim().toLowerCase();
  if ((OPENROUTER_TTS_FORMATS as readonly string[]).includes(f)) return f;
  if (f === 'mpeg') return 'mp3';
  return DEFAULT_FORMAT;
}

export interface OpenRouterTtsResult {
  audioBuffer: Buffer;
  format: string;
  mimeType: string;
  transcript?: string;
  costUsd: number;
  usage: any;
  model: string;
}

function mimeForFormat(format: string): string {
  switch (format) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'opus': return 'audio/opus';
    case 'pcm16': return 'audio/pcm';
    default: return `audio/${format}`;
  }
}

/** True when the model id is a Google Lyria music model (served via OpenRouter). */
export function isOpenRouterMusicModel(model: string): boolean {
  return /lyria/i.test(String(model || '').trim());
}

/** Normalize a bare Lyria model name into an OpenRouter slug. */
export function normalizeMusicModelId(model: string): string {
  const m = String(model || '').trim();
  if (!m) return 'google/lyria-3-pro-preview';
  if (m.includes('/')) return m;
  if (/^lyria/i.test(m)) return `google/${m}`;
  return m;
}

export interface OpenRouterMusicResult {
  audioBuffer: Buffer;
  format: string;
  mimeType: string;
  costUsd: number;
  usage: any;
  model: string;
}

/**
 * POST the chat/completions modalities request and accumulate the streamed
 * base64 audio segments. Shared by speech (gpt-audio) and music (Lyria) — the
 * only difference is the request body, so the SSE parsing lives here once.
 */
async function streamAudioCompletion(body: any): Promise<{ audioB64: string; transcript: string; usage: any }> {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) throw new Error('openrouter_not_configured');

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://stuard.ai',
      'X-Title': 'Stuard AI',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenRouter audio error ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const reader = (resp.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let audioB64 = '';
  let transcript = '';
  let usage: any = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json: any;
    try { json = JSON.parse(data); } catch { return; }
    const choice = json?.choices?.[0];
    const audio = choice?.delta?.audio || choice?.message?.audio;
    if (audio?.data) audioB64 += audio.data;
    if (audio?.transcript) transcript += audio.transcript;
    if (json?.usage) usage = json.usage;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      consumeLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer) consumeLine(buffer);

  return { audioB64, transcript, usage };
}

/**
 * Synthesize speech via OpenRouter. Streams the SSE response, concatenates the
 * base64 audio segments, and decodes once into a Buffer.
 */
export async function synthesizeSpeechOpenRouter(params: {
  model: string;
  text: string;
  voice?: string;
  format?: string;
}): Promise<OpenRouterTtsResult> {
  const model = normalizeTtsModelId(params.model);
  const voice = resolveVoice(params.voice);
  const format = resolveFormat(params.format);

  const { audioB64, transcript, usage } = await streamAudioCompletion({
    model,
    messages: [{ role: 'user', content: params.text }],
    modalities: ['text', 'audio'],
    audio: { voice, format },
    stream: true,
    usage: { include: true },
  });

  if (!audioB64) throw new Error('no_audio_generated');

  const costUsd = Number(usage?.cost);
  return {
    audioBuffer: Buffer.from(audioB64, 'base64'),
    format,
    mimeType: mimeForFormat(format),
    transcript: transcript || undefined,
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    usage,
    model,
  };
}

/**
 * Compose music via OpenRouter (Google Lyria). Unlike speech, music takes no
 * voice — just a descriptive prompt and an output format. Lyria controls its
 * own clip length, so callers can't pass a duration.
 */
export async function composeMusicOpenRouter(params: {
  model: string;
  prompt: string;
  format?: string;
}): Promise<OpenRouterMusicResult> {
  const model = normalizeMusicModelId(params.model);
  const format = resolveFormat(params.format);

  const { audioB64, usage } = await streamAudioCompletion({
    model,
    messages: [{ role: 'user', content: params.prompt }],
    modalities: ['text', 'audio'],
    audio: { format },
    stream: true,
    usage: { include: true },
  });

  if (!audioB64) throw new Error('no_audio_generated');

  const costUsd = Number(usage?.cost);
  return {
    audioBuffer: Buffer.from(audioB64, 'base64'),
    format,
    mimeType: mimeForFormat(format),
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    usage,
    model,
  };
}
