/**
 * Discord ↔ Voice Provider Bridge
 *
 * Bridges Discord DM voice calls to the voice provider system (OpenAI Realtime,
 * Grok, Gemini Live, ElevenLabs) — the same providers used by Telnyx telephony
 * and the browser voice bridge.
 *
 * Audio flow:
 *   Discord Opus 48kHz stereo → decode → PCM S16LE → downsample to 24kHz mono
 *   → Voice Provider (base64 PCM16) → upsample to 48kHz → encode Opus → Discord
 *
 * This is NOT SIP/VoIP — it uses Discord's native voice protocol via @discordjs/voice.
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioPlayer,
  type AudioReceiveStream,
} from '@discordjs/voice';
import opusModule from '@discordjs/opus';
const { OpusEncoder } = opusModule;
import { Transform, Readable, PassThrough } from 'stream';
import {
  getVoiceProvider,
  getDefaultProviderId,
  getConfiguredProviders,
  getTelephonyProviderOrder,
  supportsVoiceToolCalling,
  buildVoiceContext,
  type VoiceSession,
  type VoiceSessionConfig,
} from '../voice';
import { findUserIdByDiscordId } from '../supabase';
import {
  executeVoiceToolCall,
  truncateVoiceToolResult,
} from '../voice/voice-runtime-tools';
import {
  requestDesktopBridge,
  cleanupVoiceBridge,
} from '../voice/voice-bridge-manager';

const LOG_PREFIX = '[discord-voice]';

// ── Audio format constants ───────────────────────────────────────────────────
const DISCORD_SAMPLE_RATE = 48000;
const DISCORD_CHANNELS = 2; // stereo from Discord
const PROVIDER_SAMPLE_RATE = 24000; // PCM16 24kHz for providers
const PROVIDER_CHANNELS = 1; // mono

// ── PCM Resampling ───────────────────────────────────────────────────────────

/** Downsample PCM S16LE: 48kHz stereo → 24kHz mono */
function downsample48kStereoTo24kMono(input: Buffer): Buffer {
  const sampleCount = input.length / (2 * DISCORD_CHANNELS); // 2 bytes per sample, 2 channels
  const outSamples = Math.floor(sampleCount / 2); // 48k → 24k = skip every other sample
  const output = Buffer.alloc(outSamples * 2); // 16-bit mono

  for (let i = 0; i < outSamples; i++) {
    const srcIdx = i * 2; // every other frame (48→24k)
    const left = input.readInt16LE(srcIdx * 4); // left channel
    const right = input.readInt16LE(srcIdx * 4 + 2); // right channel
    const mono = Math.round((left + right) / 2);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), i * 2);
  }
  return output;
}

/** Upsample PCM S16LE: 24kHz mono → 48kHz stereo (linear interpolation) */
function upsample24kMonoTo48kStereo(input: Buffer): Buffer {
  const inSamples = input.length / 2; // 16-bit samples
  const outSamples = inSamples * 2; // 24k → 48k
  const output = Buffer.alloc(outSamples * 4); // 16-bit stereo = 4 bytes per frame

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i / 2;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    let sample: number;
    if (srcIdx >= inSamples - 1) {
      sample = input.readInt16LE(Math.min(srcIdx, inSamples - 1) * 2);
    } else {
      const s0 = input.readInt16LE(srcIdx * 2);
      const s1 = input.readInt16LE((srcIdx + 1) * 2);
      sample = Math.round(s0 + frac * (s1 - s0));
    }

    const clamped = Math.max(-32768, Math.min(32767, sample));
    const offset = i * 4;
    output.writeInt16LE(clamped, offset);     // left
    output.writeInt16LE(clamped, offset + 2); // right (duplicate for stereo)
  }
  return output;
}

// ── Active voice sessions ────────────────────────────────────────────────────

interface DiscordVoiceCall {
  discordUserId: string;
  userId: string;
  voiceSessionId: string;
  connection: VoiceConnection;
  player: AudioPlayer;
  session: VoiceSession;
  opusDecoder: InstanceType<typeof OpusEncoder>;
  opusEncoder: InstanceType<typeof OpusEncoder>;
  audioQueue: Buffer[];
  isPlaying: boolean;
  startedAt: number;
}

const activeCalls = new Map<string, DiscordVoiceCall>(); // keyed by discordUserId

export function getActiveDiscordCall(discordUserId: string): DiscordVoiceCall | undefined {
  return activeCalls.get(discordUserId);
}

export function getActiveDiscordCallCount(): number {
  return activeCalls.size;
}

// ── Bridge a Discord DM voice channel to a voice provider ────────────────────

export async function bridgeDiscordVoice(opts: {
  channelId: string;
  guildId: string; // For DM voice, this is the DM channel's guild-like ID
  discordUserId: string;
  adapterCreator: any; // VoiceAdapterCreator from client
  providerId?: string;
  voiceId?: string;
  model?: string;
}): Promise<DiscordVoiceCall | null> {
  const { channelId, guildId, discordUserId, adapterCreator, voiceId, model } = opts;

  // Look up StuardAI user
  const userId = await findUserIdByDiscordId(discordUserId);
  if (!userId) {
    console.warn(LOG_PREFIX, 'Cannot bridge voice: user not linked', { discordUserId });
    return null;
  }

  // Select voice provider. If the caller didn't pick one, prefer
  // tool-capable providers (OpenAI Realtime, Grok Realtime) so delegate
  // and web_search actually work, and fall back to Gemini/ElevenLabs for
  // conversation-only calls when no tool-capable provider is configured.
  let providerId = opts.providerId || '';
  if (!providerId) {
    const configured = getConfiguredProviders();
    const preferred = getTelephonyProviderOrder();
    providerId = preferred.find((id) => configured.some((p) => p.id === id))
      || configured[0]?.id
      || getDefaultProviderId();
  }

  const provider = getVoiceProvider(providerId);

  if (!provider || !provider.isConfigured()) {
    console.error(LOG_PREFIX, `Voice provider not available: ${providerId}`);
    return null;
  }
  let enableVoiceTools = true;
  if (!supportsVoiceToolCalling(provider)) {
    enableVoiceTools = false;
    console.log(LOG_PREFIX, 'Provider does not support tool calling, continuing without live tools', {
      discordUserId,
      providerId,
    });
  }

  const voiceSessionId = `discord-${discordUserId}-${Date.now()}`;
  console.log(LOG_PREFIX, 'Starting voice bridge', { discordUserId, userId: userId.slice(0, 8), providerId, voiceSessionId });

  // Desktop bridge first, then build voice context through it so knowledge
  // lookups (identity / directives / bio) flow through the same WS and the
  // model knows who it's talking to before answering.
  let voiceContext: Awaited<ReturnType<typeof buildVoiceContext>> | null = null;
  const bridgeWs = await requestDesktopBridge(userId, voiceSessionId, 'discord').catch(() => null);
  if (bridgeWs) {
    console.log(LOG_PREFIX, 'Desktop bridge established', { voiceSessionId });
  } else {
    console.log(LOG_PREFIX, 'Desktop bridge not available', { voiceSessionId });
  }

  try {
    voiceContext = await buildVoiceContext({
      userId,
      direction: 'inbound',
      customPrompt: 'This is a Discord voice call (not a phone call). The user is talking to you through Discord DMs.',
      bridgeWs: bridgeWs || undefined,
      enableTools: enableVoiceTools,
    });
  } catch (err: any) {
    console.warn(LOG_PREFIX, 'Failed to load voice context:', err?.message);
  }

  // Join the voice channel
  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Wait for connection to be ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err: any) {
    console.error(LOG_PREFIX, 'Failed to join voice channel:', err?.message);
    connection.destroy();
    return null;
  }

  // Create Opus encoder/decoder (48kHz stereo for Discord)
  const opusDecoder = new OpusEncoder(DISCORD_SAMPLE_RATE, DISCORD_CHANNELS);
  const opusEncoder = new OpusEncoder(DISCORD_SAMPLE_RATE, DISCORD_CHANNELS);

  // Create audio player for sending audio to Discord
  const player = createAudioPlayer();
  connection.subscribe(player);

  // Create voice provider session
  const sessionConfig: VoiceSessionConfig = {
    providerId,
    voiceId: voiceId || undefined,
    model: model || undefined,
    systemPrompt: voiceContext?.systemPrompt || 'You are Stuard, a helpful AI assistant on a Discord voice call. Be concise and conversational.',
    language: 'en',
    inputAudioFormat: 'pcm_24000',
    outputAudioFormat: 'pcm_24000',
    tools: voiceContext?.tools || [],
    onTranscript: (role, text, isFinal) => {
      if (isFinal) {
        console.log(LOG_PREFIX, `[${role}] ${text}`);
      }
    },
    onSessionEnd: (reason) => {
      console.log(LOG_PREFIX, 'Voice session ended:', reason);
      cleanupCall(discordUserId);
    },
    onInterruption: () => {
      // Stop current playback when user interrupts
      const call = activeCalls.get(discordUserId);
      if (call) {
        call.audioQueue.length = 0;
        call.player.stop();
      }
    },
    onFunctionCall: (callId, name, argsJson) => {
      handleFunctionCall(callId, name, argsJson, userId, voiceSessionId, session)
        .catch(err => {
          console.error(LOG_PREFIX, 'Function call error:', err?.message);
          // Always feed an error back so the AI can apologise verbally
          // rather than leaving the caller in silence.
          try {
            session?.sendFunctionResult?.(callId, JSON.stringify({
              ok: false,
              error: err?.message || 'Tool execution failed',
              hint: 'Tell the caller you hit an issue, apologise briefly, and either retry, summarise verbally, or move on.',
            }));
          } catch (sendErr: any) {
            console.error(LOG_PREFIX, 'Failed to deliver function error result:', sendErr?.message);
          }
        });
    },
  };

  let session: VoiceSession;
  try {
    session = await provider.createSession(sessionConfig);
  } catch (err: any) {
    console.error(LOG_PREFIX, `Failed to create ${providerId} session:`, err?.message);
    connection.destroy();
    return null;
  }

  const call: DiscordVoiceCall = {
    discordUserId,
    userId,
    voiceSessionId,
    connection,
    player,
    session,
    opusDecoder,
    opusEncoder,
    audioQueue: [],
    isPlaying: false,
    startedAt: Date.now(),
  };

  activeCalls.set(discordUserId, call);

  // ── Receive audio from Discord user → send to voice provider ───────────
  const receiver = connection.receiver;

  receiver.speaking.on('start', (speakingUserId: string) => {
    if (speakingUserId !== discordUserId) return; // Only listen to the calling user

    const opusStream = receiver.subscribe(speakingUserId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 300 },
    });

    opusStream.on('data', (chunk: Buffer) => {
      if (!session.isActive()) return;
      try {
        // Decode Opus → PCM S16LE 48kHz stereo
        const pcm48k = opusDecoder.decode(chunk);
        // Downsample → PCM16 24kHz mono
        const pcm24k = downsample48kStereoTo24kMono(pcm48k);
        // Send to voice provider as base64
        session.sendAudio(pcm24k.toString('base64'));
      } catch (err: any) {
        // Opus decode errors are normal during silence/packet loss
      }
    });
  });

  // ── Receive audio from voice provider → send to Discord ────────────────
  session.onAudio((audioBase64: string) => {
    const call = activeCalls.get(discordUserId);
    if (!call || connection.state.status !== VoiceConnectionStatus.Ready) return;

    try {
      // Provider sends PCM16 24kHz mono
      const pcm24k = Buffer.from(audioBase64, 'base64');
      // Upsample → PCM16 48kHz stereo
      const pcm48k = upsample24kMonoTo48kStereo(pcm24k);
      // Queue for playback
      call.audioQueue.push(pcm48k);
      drainAudioQueue(call);
    } catch (err: any) {
      console.error(LOG_PREFIX, 'Audio output error:', err?.message);
    }
  });

  // ── Connection lifecycle ───────────────────────────────────────────────
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log(LOG_PREFIX, 'Voice connection disconnected', { discordUserId });
    cleanupCall(discordUserId);
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    cleanupCall(discordUserId);
  });

  console.log(LOG_PREFIX, 'Voice bridge active', {
    discordUserId,
    providerId,
    userName: voiceContext?.userName,
  });

  return call;
}

// ── Audio playback queue ─────────────────────────────────────────────────────
// Discord audio player needs a continuous stream. We queue provider audio chunks
// and play them sequentially.

function drainAudioQueue(call: DiscordVoiceCall): void {
  if (call.isPlaying || call.audioQueue.length === 0) return;
  call.isPlaying = true;

  // Combine all queued chunks into one buffer
  const combined = Buffer.concat(call.audioQueue.splice(0));

  // Create a readable stream from the PCM buffer
  const stream = new PassThrough();
  stream.end(combined);

  // Create an audio resource (raw PCM S16LE 48kHz stereo)
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw,
  });

  call.player.play(resource);

  call.player.once(AudioPlayerStatus.Idle, () => {
    call.isPlaying = false;
    // Drain any audio that arrived during playback
    drainAudioQueue(call);
  });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

function cleanupCall(discordUserId: string): void {
  const call = activeCalls.get(discordUserId);
  if (!call) return;

  console.log(LOG_PREFIX, 'Cleaning up voice call', {
    discordUserId,
    duration: `${Math.round((Date.now() - call.startedAt) / 1000)}s`,
  });

  try { call.session.close('call_ended'); } catch {}
  try { call.player.stop(true); } catch {}
  try {
    if (call.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      call.connection.destroy();
    }
  } catch {}
  cleanupVoiceBridge(call.voiceSessionId);

  activeCalls.delete(discordUserId);
}

export function disconnectDiscordVoice(discordUserId: string): void {
  cleanupCall(discordUserId);
}

// ── Function Call Handler (same as telnyx-bridge) ────────────────────────────

async function handleFunctionCall(
  callId: string,
  name: string,
  argsJson: string,
  userId: string,
  voiceSessionId: string,
  session: VoiceSession | null,
): Promise<void> {
  const startTime = Date.now();
  console.log(LOG_PREFIX, 'Executing function call', { callId, name, userId: userId.slice(0, 8) });

  let result: any;
  try {
    result = await executeVoiceToolCall({
      name,
      argsJson,
      userId,
      channel: 'discord',
      voiceSessionId,
    });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'executeVoiceToolCall threw:', err?.message);
    result = {
      ok: false,
      error: err?.message || 'Tool crashed',
      hint: 'Tell the caller you hit an unexpected error, apologise briefly, and either try again or move on.',
    };
  }

  const elapsed = Date.now() - startTime;
  console.log(LOG_PREFIX, 'Function call completed', { callId, name, elapsed: `${elapsed}ms` });

  if (!session || !session.isActive?.()) {
    console.warn(LOG_PREFIX, 'Function call finished but session is not active; skipping result', {
      callId,
      name,
      elapsed: `${elapsed}ms`,
    });
    return;
  }

  try {
    session.sendFunctionResult?.(callId, truncateVoiceToolResult(result));
  } catch (sendErr: any) {
    console.error(LOG_PREFIX, 'Failed to send function result to session:', sendErr?.message);
  }
}
