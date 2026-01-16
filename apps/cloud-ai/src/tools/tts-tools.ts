import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OpenAIVoice } from '@mastra/voice-openai';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execLocalTool } from './bridge';

// Voice IDs available in OpenAI TTS
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
type OpenAIVoiceId = typeof OPENAI_VOICES[number];

// Singleton voice instance (lazy-initialized)
let _voiceInstance: OpenAIVoice | null = null;

function getVoiceInstance(): OpenAIVoice {
  if (!_voiceInstance) {
    _voiceInstance = new OpenAIVoice({
      speechModel: { name: 'tts-1' },
      speaker: 'alloy',
    });
  }
  return _voiceInstance;
}

/**
 * Convert a readable stream to a buffer
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Text-to-speech tool using OpenAI's TTS models
 */
export const text_to_speech = createTool({
  id: 'text_to_speech',
  description: 'Convert text to speech audio using OpenAI TTS. Can optionally save to file and/or play the audio immediately.',
  inputSchema: z.object({
    text: z.string().min(1).max(4096).describe('Text to convert to speech (max 4096 characters)'),
    voice: z.enum(OPENAI_VOICES).default('alloy').describe('Voice to use: alloy, echo, fable, onyx, nova, or shimmer'),
    speed: z.number().min(0.25).max(4.0).default(1.0).describe('Speech speed multiplier (0.25 to 4.0)'),
    format: z.enum(['mp3', 'opus', 'aac', 'flac']).default('mp3').describe('Output audio format'),
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
  execute: async ({ context, writer }) => {
    const { text, voice, speed, format, save, play, outputPath } = context;

    try {
      const voice_instance = getVoiceInstance();

      // Generate speech
      const audioStream = await voice_instance.speak(text, {
        speaker: voice as OpenAIVoiceId,
        speed,
      });

      // Convert stream to buffer
      const audioBuffer = await streamToBuffer(audioStream);

      let filePath: string | undefined;
      let played = false;

      // Save to file if requested (or if play is requested, we need a temp file)
      if (save || play) {
        const fileName = `tts_${randomUUID().slice(0, 8)}.${format}`;
        filePath = outputPath || join(tmpdir(), 'stuard-tts', fileName);

        // Ensure directory exists
        const dir = filePath.substring(0, filePath.lastIndexOf('/') || filePath.lastIndexOf('\\'));
        if (dir) {
          await import('fs/promises').then(fs => fs.mkdir(dir, { recursive: true }).catch(() => {}));
        }

        // Write audio file
        await writeFile(filePath, audioBuffer);
      }

      // Play the audio if requested
      if (play && filePath) {
        try {
          // Use local tool to open/play the audio file
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
        voice,
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

/**
 * List available TTS voices
 */
export const list_tts_voices = createTool({
  id: 'list_tts_voices',
  description: 'List all available text-to-speech voices with their characteristics.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    voices: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })),
  }),
  execute: async () => {
    const voices = [
      { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice - good for general use' },
      { id: 'echo', name: 'Echo', description: 'Warm, confident male voice' },
      { id: 'fable', name: 'Fable', description: 'Expressive, British-accented voice - good for storytelling' },
      { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative male voice' },
      { id: 'nova', name: 'Nova', description: 'Friendly, upbeat female voice' },
      { id: 'shimmer', name: 'Shimmer', description: 'Clear, pleasant female voice' },
    ];

    return { ok: true, voices };
  },
});
