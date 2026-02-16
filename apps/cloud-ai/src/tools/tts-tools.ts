import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execLocalTool } from './bridge';

const ELEVENLABS_DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

const ELEVENLABS_MODELS = [
  'eleven_multilingual_v2',
  'eleven_monolingual_v1',
  'eleven_turbo_v2_5',
  'eleven_turbo_v2',
  'eleven_multilingual_v1',
] as const;

const OUTPUT_FORMATS = [
  'mp3_22050_32', 'mp3_24000_48', 'mp3_44100_32', 'mp3_44100_64',
  'mp3_44100_96', 'mp3_44100_128', 'mp3_44100_192',
  'opus_48000_32', 'opus_48000_64', 'opus_48000_96', 'opus_48000_128', 'opus_48000_192',
  'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_32000', 'pcm_44100', 'pcm_48000', 'pcm_8000',
  'wav_16000', 'wav_22050', 'wav_24000', 'wav_32000', 'wav_44100', 'wav_48000', 'wav_8000',
  'alaw_8000', 'ulaw_8000',
] as const;

let _client: ElevenLabsClient | null = null;

function getElevenLabsClient(): ElevenLabsClient {
  if (!_client) {
    _client = new ElevenLabsClient();
  }
  return _client;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(result);
}

const FORMAT_TO_ELEVENLABS: Record<string, string> = {
  mp3: 'mp3_44100_128',
  opus: 'opus_48000_128',
  wav: 'wav_44100',
  aac: 'mp3_44100_128',
  flac: 'wav_44100',
};

export const text_to_speech = createTool({
  id: 'text_to_speech',
  description: 'Convert text to speech audio using ElevenLabs TTS. Supports multiple languages and voices. Can optionally save to file and/or play the audio immediately.',
  inputSchema: z.object({
    text: z.string().min(1).max(5000).describe('Text to convert to speech (max 5000 characters)'),
    voice_id: z.string().default(ELEVENLABS_DEFAULT_VOICE_ID).describe('ElevenLabs voice ID. Use list_tts_voices to see available voices.'),
    model_id: z.enum(ELEVENLABS_MODELS).default('eleven_multilingual_v2').describe('Model to use: eleven_multilingual_v2 (recommended), eleven_turbo_v2_5 (faster), or eleven_monolingual_v1'),
    language_code: z.string().optional().describe('Language code (ISO 639-1) to enforce language for text normalization (e.g., "en", "es", "fr", "de", "ja")'),
    speed: z.number().min(0.25).max(2.0).default(1.0).describe('Speech speed multiplier (0.25 to 2.0)'),
    stability: z.number().min(0).max(1).optional().describe('Voice stability (0-1). Lower = more emotion, Higher = more stable'),
    similarity_boost: z.number().min(0).max(1).optional().describe('How closely AI adheres to original voice (0-1)'),
    style: z.number().min(0).max(1).optional().describe('Style exaggeration (0-1). Higher = more expressive'),
    format: z.enum(['mp3', 'opus', 'wav', 'aac', 'flac']).default('mp3').describe('Output audio format'),
    save: z.boolean().default(true).describe('Whether to save the audio to a file'),
    play: z.boolean().default(false).describe('Whether to play the audio immediately after generation'),
    outputPath: z.string().optional().describe('Custom output path. If not provided and save=true, saves to temp directory.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    filePath: z.string().optional(),
    format: z.string().optional(),
    voice: z.string().optional(),
    textLength: z.number().optional(),
    played: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { text, voice_id, model_id, language_code, speed, stability, similarity_boost, style, format, save, play, outputPath } = inputData;

    try {
      const client = getElevenLabsClient();
      const outputFormat = FORMAT_TO_ELEVENLABS[format] || 'mp3_44100_128';

      const voiceSettings: Record<string, any> = {};
      if (speed !== undefined && speed !== 1.0) voiceSettings.speed = speed;
      if (stability !== undefined) voiceSettings.stability = stability;
      if (similarity_boost !== undefined) voiceSettings.similarity_boost = similarity_boost;
      if (style !== undefined) voiceSettings.style = style;

      const requestParams: Record<string, any> = {
        text,
        modelId: model_id,
        outputFormat,
      };

      if (language_code) requestParams.languageCode = language_code;
      if (Object.keys(voiceSettings).length > 0) {
        requestParams.voiceSettings = voiceSettings;
      }

      const audioStream = await client.textToSpeech.convert(voice_id, requestParams as any);

      const audioBuffer = await streamToBuffer(audioStream);

      let filePath: string | undefined;
      let played = false;

      if (save || play) {
        const fileName = `tts_${randomUUID().slice(0, 8)}.${format}`;
        filePath = outputPath || join(tmpdir(), 'stuard-tts', fileName);

        const dir = filePath.substring(0, filePath.lastIndexOf('/') || filePath.lastIndexOf('\\'));
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => {});
        }

        await writeFile(filePath, audioBuffer);
      }

      if (play && filePath) {
        try {
          await execLocalTool('launch_application_or_uri', { target: filePath }, writer as any);
          played = true;
        } catch (e: any) {
          console.warn('[tts-tools] Failed to play audio:', e?.message);
        }
      }

      return {
        ok: true,
        filePath: save ? filePath : undefined,
        format,
        voice: voice_id,
        textLength: text.length,
        played,
      };
    } catch (e: any) {
      console.error('[tts-tools] text_to_speech error:', e);
      return {
        ok: false,
        error: e?.message || 'Failed to generate speech',
      };
    }
  },
});

export const list_tts_voices = createTool({
  id: 'list_tts_voices',
  description: 'List all available ElevenLabs text-to-speech voices.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    voices: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      labels: z.record(z.string(), z.string()).optional(),
    })),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const client = getElevenLabsClient();
      const voicesResponse = await client.voices.search();

      const voices = (voicesResponse.voices || []).map((v: any) => ({
        id: v.voice_id,
        name: v.name,
        description: v.description || `Voice: ${v.name}`,
        labels: v.labels,
      }));

      return { ok: true, voices };
    } catch (e: any) {
      console.error('[tts-tools] list_tts_voices error:', e);
      return {
        ok: false,
        voices: [],
        error: e?.message || 'Failed to list voices',
      };
    }
  },
});

export const get_tts_models = createTool({
  id: 'get_tts_models',
  description: 'List available ElevenLabs TTS models.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    models: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const client = getElevenLabsClient();
      const modelsResponse = await client.models.list();

      const models = (modelsResponse || [])
        .filter((m: any) => m.can_do_text_to_speech)
        .map((m: any) => ({
          id: m.model_id,
          name: m.name,
          description: m.description || `Model: ${m.name}`,
        }));

      return { ok: true, models };
    } catch (e: any) {
      console.error('[tts-tools] get_tts_models error:', e);
      const fallbackModels = ELEVENLABS_MODELS.map(id => ({
        id,
        name: id.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        description: id.includes('turbo') ? 'Fast, lower quality' : id.includes('multilingual') ? 'Supports multiple languages' : 'High quality English',
      }));
      return { ok: true, models: fallbackModels };
    }
  },
});