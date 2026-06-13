import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mediaGalleryDir } from '../utils/platform';
import { execLocalTool, getBridgeSecrets } from './bridge';
import { logUsageEvent } from '../supabase';
import { isOpenRouterTtsModel, synthesizeSpeechOpenRouter } from '../media/openrouter-tts';

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

function errorMessage(e: any, fallback: string): string {
  return String(e?.body?.detail || e?.body?.message || e?.message || fallback);
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
  description: 'Convert text to speech audio. Defaults to ElevenLabs TTS (rich voice library, use list_tts_voices); also supports the audio models openai/gpt-audio and openai/gpt-audio-mini — pass that model id and a voice like alloy/echo/nova. Can optionally save to file and/or play the audio immediately.',
  inputSchema: z.object({
    text: z.string().min(1).max(5000).describe('Text to convert to speech (max 5000 characters)'),
    voice_id: z.string().default(ELEVENLABS_DEFAULT_VOICE_ID).describe('Voice. For ElevenLabs: a voice ID (use list_tts_voices). For the gpt-audio models: a voice name like alloy, echo, nova, shimmer.'),
    model_id: z.string().default('eleven_multilingual_v2').describe('TTS model. ElevenLabs: eleven_multilingual_v2 (default), eleven_turbo_v2_5 (faster), eleven_monolingual_v1. Audio models: openai/gpt-audio, openai/gpt-audio-mini.'),
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
  execute: async (inputData: any, { writer }) => {
    const { text, voice_id, model_id, language_code, speed, stability, similarity_boost, style, format, save, play, outputPath } = inputData;

    try {
      // Resolve audio + effective format from the selected provider.
      let audioBuffer: Buffer;
      let effectiveFormat: string = format;
      let usageModel: string = `elevenlabs/${model_id}`;
      let usageCostUsd: number | undefined;
      let usageProvider = 'elevenlabs';

      if (isOpenRouterTtsModel(model_id)) {
        const tts = await synthesizeSpeechOpenRouter({ model: model_id, text, voice: voice_id, format });
        audioBuffer = tts.audioBuffer;
        effectiveFormat = tts.format;
        usageModel = tts.model;
        usageCostUsd = tts.costUsd > 0 ? tts.costUsd : undefined;
        usageProvider = 'openrouter';
      } else {
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
        audioBuffer = await streamToBuffer(audioStream);
      }

      // Bill the call — the /tools route doesn't auto-bill, each LLM/media tool
      // logs its own usage. Best-effort; never breaks the result.
      try {
        const userId = getBridgeSecrets()?.userId;
        if (userId && typeof userId === 'string') {
          await logUsageEvent(userId, null, usageModel, {
            totalTokens: 0,
            ...(usageCostUsd != null ? { costUsd: usageCostUsd } : {}),
            provider: usageProvider,
            endpoint: '/tools/text_to_speech',
            textLength: text.length,
            source_label: 'Text to Speech',
            format: effectiveFormat,
          });
        }
      } catch {}

      let filePath: string | undefined;
      let played = false;

      if (save || play) {
        const fileName = `tts_${randomUUID().slice(0, 8)}.${effectiveFormat}`;
        const resolvedFilePath: string = outputPath || join(mediaGalleryDir('generated-audio'), fileName);
        filePath = resolvedFilePath;

        const dir = resolvedFilePath.substring(0, resolvedFilePath.lastIndexOf('/') || resolvedFilePath.lastIndexOf('\\'));
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => {});
        }

        await writeFile(resolvedFilePath, audioBuffer);

        // Register saved audio in the desktop media library via bridge (best-effort, silent)
        try {
          await execLocalTool('_media_register', {
            b64: audioBuffer.toString('base64'),
            fileName,
            format: effectiveFormat,
            mimeType: effectiveFormat === 'mp3' ? 'audio/mpeg' : `audio/${effectiveFormat}`,
            source: 'generated-audio',
            toolName: 'text_to_speech',
            classification: 'Generated audio',
            tags: ['tts', 'audio'],
            metadata: {
              voice_id,
              model_id,
              textLength: text.length,
            },
          }, writer as any, 30000, { silent: true });
        } catch (regErr: any) {
          console.warn('[tts-tools] Media register (best-effort):', regErr?.message || regErr);
        }
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
        format: effectiveFormat,
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

const MUSIC_DEFAULT_LENGTH_MS = 30000;
const MUSIC_MIN_LENGTH_MS = 3000;
const MUSIC_MAX_LENGTH_MS = 600000;

export const generate_music = createTool({
  id: 'generate_music',
  description: 'Generate original music/songs from a text prompt using ElevenLabs Music (model music_v1). Describe genre, mood, instruments, tempo, and optionally lyrics or a theme; set force_instrumental to guarantee no vocals. Saves the track to the media library. This is true music composition — distinct from text_to_speech, which only narrates text in a voice.',
  inputSchema: z.object({
    prompt: z.string().min(1).max(2000).describe('Description of the music to generate, e.g. "upbeat lo-fi hip hop with mellow piano and vinyl crackle" or "epic orchestral trailer score". Can include a theme or lyric direction.'),
    length_ms: z.number().int().min(MUSIC_MIN_LENGTH_MS).max(MUSIC_MAX_LENGTH_MS).default(MUSIC_DEFAULT_LENGTH_MS).describe('Length of the song in milliseconds (3000–600000). Defaults to 30s.'),
    force_instrumental: z.boolean().default(false).describe('If true, guarantees the generated song has no vocals.'),
    format: z.enum(['mp3', 'opus', 'wav']).default('mp3').describe('Output audio format'),
    save: z.boolean().default(true).describe('Whether to save the audio to a file'),
    play: z.boolean().default(false).describe('Whether to play the audio immediately after generation'),
    outputPath: z.string().optional().describe('Custom output path. If not provided and save=true, saves to the media gallery.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    filePath: z.string().optional(),
    format: z.string().optional(),
    lengthMs: z.number().optional(),
    played: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }) => {
    const { prompt, length_ms, force_instrumental, format, save, play, outputPath } = inputData;

    try {
      const client = getElevenLabsClient();
      const outputFormat = FORMAT_TO_ELEVENLABS[format] || 'mp3_44100_128';

      const audioStream = await client.music.compose({
        prompt,
        musicLengthMs: length_ms,
        forceInstrumental: force_instrumental,
        modelId: 'music_v1',
        outputFormat: outputFormat as any,
      });
      const audioBuffer = await streamToBuffer(audioStream);

      // Bill the call — the /tools route doesn't auto-bill, each media tool logs
      // its own usage. Best-effort; never breaks the result.
      try {
        const userId = getBridgeSecrets()?.userId;
        if (userId && typeof userId === 'string') {
          await logUsageEvent(userId, null, 'elevenlabs/music_v1', {
            totalTokens: 0,
            provider: 'elevenlabs',
            endpoint: '/tools/generate_music',
            source_label: 'Music Generation',
            format,
            lengthMs: length_ms,
          });
        }
      } catch {}

      let filePath: string | undefined;
      let played = false;

      if (save || play) {
        const fileName = `music_${randomUUID().slice(0, 8)}.${format}`;
        const resolvedFilePath: string = outputPath || join(mediaGalleryDir('generated-audio'), fileName);
        filePath = resolvedFilePath;

        const dir = resolvedFilePath.substring(0, resolvedFilePath.lastIndexOf('/') || resolvedFilePath.lastIndexOf('\\'));
        if (dir) {
          await mkdir(dir, { recursive: true }).catch(() => {});
        }

        await writeFile(resolvedFilePath, audioBuffer);

        // Register saved audio in the desktop media library via bridge (best-effort, silent)
        try {
          await execLocalTool('_media_register', {
            b64: audioBuffer.toString('base64'),
            fileName,
            format,
            mimeType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}`,
            source: 'generated-audio',
            toolName: 'generate_music',
            classification: 'Generated music',
            tags: ['music', 'audio'],
            metadata: {
              prompt,
              lengthMs: length_ms,
              force_instrumental,
            },
          }, writer as any, 30000, { silent: true });
        } catch (regErr: any) {
          console.warn('[tts-tools] Media register (best-effort):', regErr?.message || regErr);
        }
      }

      if (play && filePath) {
        try {
          await execLocalTool('launch_application_or_uri', { target: filePath }, writer as any);
          played = true;
        } catch (e: any) {
          console.warn('[tts-tools] Failed to play music:', e?.message);
        }
      }

      return {
        ok: true,
        filePath: save ? filePath : undefined,
        format,
        lengthMs: length_ms,
        played,
      };
    } catch (e: any) {
      console.error('[tts-tools] generate_music error:', e);
      return {
        ok: false,
        error: errorMessage(e, 'Failed to generate music'),
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

export const elevenlabs_list_agents = createTool({
  id: 'elevenlabs_list_agents',
  description: 'List available ElevenLabs Conversational AI agents for live voice conversations, workflow hooks, and telephony bridges.',
  inputSchema: z.object({
    cursor: z.string().optional(),
    search: z.string().optional(),
    archived: z.boolean().optional(),
    show_only_owned_agents: z.boolean().optional(),
    sort_by: z.string().optional(),
    sort_direction: z.enum(['asc', 'desc']).optional(),
    page_size: z.number().int().min(1).max(100).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    agents: z.array(z.any()),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const client = getElevenLabsClient();
      const response = await client.conversationalAi.agents.list({
        cursor: inputData.cursor,
        search: inputData.search,
        archived: inputData.archived,
        showOnlyOwnedAgents: inputData.show_only_owned_agents,
        sortBy: inputData.sort_by as any,
        sortDirection: inputData.sort_direction as any,
        pageSize: inputData.page_size,
      });

      return {
        ok: true,
        agents: response?.agents || [],
        nextCursor: response?.nextCursor,
        hasMore: response?.hasMore,
      };
    } catch (e: any) {
      console.error('[tts-tools] elevenlabs_list_agents error:', e);
      return { ok: false, agents: [], error: errorMessage(e, 'Failed to list ElevenLabs agents') };
    }
  },
});

export const elevenlabs_get_signed_conversation_url = createTool({
  id: 'elevenlabs_get_signed_conversation_url',
  description: 'Create a signed ElevenLabs live conversation URL for launching an authenticated voice session from custom UIs, apps, or external voice bridges.',
  inputSchema: z.object({
    agent_id: z.string().min(1).describe('ElevenLabs Conversational AI agent ID'),
    include_conversation_id: z.boolean().optional().default(true),
    branch_id: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    agentId: z.string().optional(),
    signedUrl: z.string().optional(),
    includeConversationId: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const client = getElevenLabsClient();
      const response = await client.conversationalAi.conversations.getSignedUrl({
        agentId: inputData.agent_id,
        includeConversationId: inputData.include_conversation_id,
        branchId: inputData.branch_id,
      });

      return {
        ok: true,
        agentId: inputData.agent_id,
        signedUrl: response?.signedUrl,
        includeConversationId: inputData.include_conversation_id,
      };
    } catch (e: any) {
      console.error('[tts-tools] elevenlabs_get_signed_conversation_url error:', e);
      return { ok: false, error: errorMessage(e, 'Failed to create signed conversation URL') };
    }
  },
});

export const elevenlabs_get_webrtc_token = createTool({
  id: 'elevenlabs_get_webrtc_token',
  description: 'Create an ElevenLabs WebRTC token for low-latency live voice conversations in custom clients or embedded workflow UIs.',
  inputSchema: z.object({
    agent_id: z.string().min(1).describe('ElevenLabs Conversational AI agent ID'),
    participant_name: z.string().optional(),
    branch_id: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    agentId: z.string().optional(),
    token: z.string().optional(),
    participantName: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const client = getElevenLabsClient();
      const response = await client.conversationalAi.conversations.getWebrtcToken({
        agentId: inputData.agent_id,
        participantName: inputData.participant_name,
        branchId: inputData.branch_id,
      });

      return {
        ok: true,
        agentId: inputData.agent_id,
        token: response?.token,
        participantName: inputData.participant_name,
      };
    } catch (e: any) {
      console.error('[tts-tools] elevenlabs_get_webrtc_token error:', e);
      return { ok: false, error: errorMessage(e, 'Failed to create WebRTC token') };
    }
  },
});

export const elevenlabs_list_conversations = createTool({
  id: 'elevenlabs_list_conversations',
  description: 'List ElevenLabs conversation sessions for an agent so workflows can inspect recent live calls or voice chats.',
  inputSchema: z.object({
    cursor: z.string().optional(),
    agent_id: z.string().optional(),
    search: z.string().optional(),
    branch_id: z.string().optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    summary_mode: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversations: z.array(z.any()),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const client = getElevenLabsClient();
      const response = await client.conversationalAi.conversations.list({
        cursor: inputData.cursor,
        agentId: inputData.agent_id,
        search: inputData.search,
        branchId: inputData.branch_id,
        pageSize: inputData.page_size,
        summaryMode: inputData.summary_mode as any,
      });

      return {
        ok: true,
        conversations: response?.conversations || [],
        nextCursor: response?.nextCursor,
        hasMore: response?.hasMore,
      };
    } catch (e: any) {
      console.error('[tts-tools] elevenlabs_list_conversations error:', e);
      return { ok: false, conversations: [], error: errorMessage(e, 'Failed to list conversations') };
    }
  },
});

export const elevenlabs_get_conversation = createTool({
  id: 'elevenlabs_get_conversation',
  description: 'Get detailed metadata for a specific ElevenLabs conversation session.',
  inputSchema: z.object({
    conversation_id: z.string().min(1),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    conversation: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const client = getElevenLabsClient();
      const conversation = await client.conversationalAi.conversations.get(inputData.conversation_id);
      return { ok: true, conversation };
    } catch (e: any) {
      console.error('[tts-tools] elevenlabs_get_conversation error:', e);
      return { ok: false, error: errorMessage(e, 'Failed to get conversation') };
    }
  },
});

