import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, debitCredits } from '../supabase';
import { getBridgeSecrets, execLocalTool } from './bridge';
import { TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID } from '../utils/config';
import { messagingCreditCost } from '../pricing';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { uploadUserFileBuffer } from '../services/cold-storage';
import { randomUUID } from 'crypto';
import {
  getVoiceProvider,
  getDefaultProviderId,
  listActiveCalls,
  removeActiveCall,
} from '../voice';

const TELNYX_API = 'https://api.telnyx.com/v2';

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

async function getVerifiedPhone(userId: string): Promise<string> {
  const acc = await getExternalAccount(userId, 'telnyx');
  if (!acc) throw new Error('telnyx_not_connected: No verified phone number found. The user must verify their phone number in Integrations before using SMS/Call tools.');
  const meta = acc.meta || {};
  if (!meta.verified) throw new Error('telnyx_not_verified: Phone number has not been verified yet.');
  return meta.phone;
}

async function telnyxRequest(path: string, method: string, body?: any): Promise<any> {
  if (!TELNYX_API_KEY) throw new Error('Telnyx API key not configured on server.');
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (json as any)?.errors?.[0]?.detail || (json as any)?.error || res.statusText;
    throw new Error(`Telnyx API error (${res.status}): ${errMsg}`);
  }
  return json;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = (stream as any).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = Buffer.alloc(totalLen);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf;
}

// ── Send SMS ────────────────────────────────────────────────────────────────

export const telnyx_send_sms = createTool({
  id: 'telnyx_send_sms',
  description: 'Send an SMS message to the user\'s verified phone number. Only works with verified numbers.',
  inputSchema: z.object({
    message: z.string().describe('The text message to send (max 1600 characters).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    messageId: z.string().optional(),
    to: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);

      const body: any = {
        from: TELNYX_FROM_NUMBER,
        to: phone,
        text: String(input.message || '').slice(0, 1600),
      };
      if (TELNYX_MESSAGING_PROFILE_ID) {
        body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
      }

      const result = await telnyxRequest('/messages', 'POST', body);
      // Deduct messaging credits
      const credits = messagingCreditCost('telnyx');
      if (credits > 0) {
        debitCredits(userId, {
          sourceType: 'messaging:telnyx',
          sourceRef: `sms_tool:${result?.data?.id || Date.now()}`,
          credits,
          amountUsd: 0.004,
          metadata: { provider: 'telnyx', tool: 'telnyx_send_sms' },
        }).catch((e: any) => console.error('[telnyx-tools] credit deduction failed:', e?.message));
      }
      return {
        ok: true,
        messageId: result?.data?.id || '',
        to: phone,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});


// ── Call Control ─────────────────────────────────────────────────────────────

export const telnyx_call_control = createTool({
  id: 'telnyx_call_control',
  description: "Send a control action to an active Telnyx call (hang up, hold, transfer, speak more text, etc.).",
  inputSchema: z.object({
    call_control_id: z.string().describe('The callControlId returned by telnyx_voice_call.'),
    action: z.enum(['hangup', 'hold', 'unhold', 'speak', 'playback_stop']).describe('Action to send to the call.'),
    message: z.string().optional().describe('Text to speak (only used for action=speak).'),
    voice: z.enum(['female', 'male']).default('female').optional().describe('Voice gender (only used for action=speak).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    action: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const callControlId = input.call_control_id;
      const action = input.action;
      let body: any = {};

      if (action === 'speak') {
        body = { payload: (input.message || '').slice(0, 500), voice: input.voice || 'female', language: 'en-US' };
      }

      await telnyxRequest(`/calls/${callControlId}/actions/${action}`, 'POST', body);
      return { ok: true, action };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Get Phone Status ────────────────────────────────────────────────────────

export const telnyx_phone_status = createTool({
  id: 'telnyx_phone_status',
  description: 'Check if the user has a verified phone number for SMS/Call notifications.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    verified: z.boolean(),
    phone: z.string().optional(),
    phones: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const userId = await requireUserId();
      const acc = await getExternalAccount(userId, 'telnyx');
      if (!acc) return { ok: true, verified: false };
      const meta = acc.meta || {};
      const phones: string[] = [];
      if (meta.verified && meta.phone) phones.push(meta.phone);
      if (meta.verified2 && meta.phone2) phones.push(meta.phone2);
      if (meta.verified3 && meta.phone3) phones.push(meta.phone3);
      if (meta.verified4 && meta.phone4) phones.push(meta.phone4);
      if (meta.verified5 && meta.phone5) phones.push(meta.phone5);
      return {
        ok: true,
        verified: phones.length > 0,
        phone: phones[0],
        phones,
      };
    } catch (e: any) {
      return { ok: false, verified: false, error: String(e?.message || e) };
    }
  },
});

// ── Send MMS (Image/Media via Telnyx) ────────────────────────────────────────

function inferMimeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

export const telnyx_send_mms = createTool({
  id: 'telnyx_send_mms',
  description: "Send an MMS message with an image or media file to the user's verified phone number. Provide EITHER a public media_url, OR a local file path, OR base64 data. Local files and base64 data are automatically uploaded to get a public URL.",
  inputSchema: z.object({
    media_url: z.string().optional().describe('Public URL of the media file to send (image, gif, video, etc.). Use this if you already have a public URL.'),
    path: z.string().optional().describe('Local file path on the user\'s machine (e.g. C:\\Users\\me\\photo.jpg). The file will be uploaded automatically.'),
    data: z.string().optional().describe('Base64-encoded media data. Must also provide mimeType when using this.'),
    mimeType: z.string().optional().describe('MIME type of the base64 data (e.g. image/png, video/mp4). Required when using data.'),
    message: z.string().default('').describe('Optional text message to include with the media.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    messageId: z.string().optional(),
    to: z.string().optional(),
    mediaUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, execCtx: any) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);

      let resolvedUrl = input.media_url || '';

      // If a local file path is provided, read it via bridge and upload
      if (!resolvedUrl && input.path) {
        const bin = await execLocalTool('read_file_binary', { path: input.path }, execCtx?.writer);
        const fileData = bin?.data as string | undefined;
        if (!fileData) {
          throw new Error(`Could not read file at path: ${input.path}`);
        }
        const originalFilename = input.path.replace(/\\/g, '/').split('/').pop() || 'media_file';
        const contentType = input.mimeType || inferMimeFromFilename(originalFilename);
        const buffer = Buffer.from(fileData, 'base64');
        const filename = `mms_${randomUUID().slice(0, 8)}_${originalFilename}`;
        const uploadResult = await uploadUserFileBuffer(userId, filename, buffer, contentType, 'mms-media', 'public');
        resolvedUrl = uploadResult.url;
      }

      // If base64 data is provided directly, upload it
      if (!resolvedUrl && input.data) {
        const mime = input.mimeType || 'image/png';
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
        const filename = `mms_${randomUUID().slice(0, 8)}.${ext}`;
        const buffer = Buffer.from(input.data, 'base64');
        const uploadResult = await uploadUserFileBuffer(userId, filename, buffer, mime, 'mms-media', 'public');
        resolvedUrl = uploadResult.url;
      }

      if (!resolvedUrl) {
        throw new Error('No media provided. Supply one of: media_url (public URL), path (local file), or data (base64).');
      }

      const body: any = {
        from: TELNYX_FROM_NUMBER,
        to: phone,
        text: String(input.message || '').slice(0, 1600),
        media_urls: [resolvedUrl],
        type: 'MMS',
      };
      if (TELNYX_MESSAGING_PROFILE_ID) {
        body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
      }

      const result = await telnyxRequest('/messages', 'POST', body);
      const credits = messagingCreditCost('telnyx');
      if (credits > 0) {
        debitCredits(userId, {
          sourceType: 'messaging:telnyx',
          sourceRef: `mms_tool:${result?.data?.id || Date.now()}`,
          credits: credits * 2,
          amountUsd: 0.008,
          metadata: { provider: 'telnyx', tool: 'telnyx_send_mms' },
        }).catch((e: any) => console.error('[telnyx-tools] mms credit deduction failed:', e?.message));
      }
      return { ok: true, messageId: result?.data?.id || '', to: phone, mediaUrl: resolvedUrl };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Send Voice Note via Telnyx ──────────────────────────────────────────────
// Generates audio using ElevenLabs TTS, uploads it, and sends as MMS audio.

export const telnyx_send_voice_note = createTool({
  id: 'telnyx_send_voice_note',
  description: "Generate a voice note using ElevenLabs TTS and send it as an MMS audio message to the user's phone.",
  inputSchema: z.object({
    message: z.string().describe('The text to convert to a voice note.'),
    voice_id: z.string().default('JBFqnCBsd6RMkjVDRZzb').describe('ElevenLabs voice ID.'),
    model_id: z.enum(['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_turbo_v2', 'eleven_monolingual_v1'])
      .default('eleven_turbo_v2_5').describe('ElevenLabs model.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    messageId: z.string().optional(),
    audioUrl: z.string().optional(),
    to: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);

      const el = new ElevenLabsClient();
      const audioStream = await el.textToSpeech.convert(input.voice_id, {
        text: String(input.message || '').slice(0, 3000),
        modelId: input.model_id || 'eleven_turbo_v2_5',
        outputFormat: 'mp3_44100_128',
      } as any);

      const buf = await streamToBuffer(audioStream as any);

      const filename = `voice_note_${randomUUID().slice(0, 8)}.mp3`;
      const uploadResult = await uploadUserFileBuffer(userId, filename, buf, 'audio/mpeg', 'voice-notes', 'public');
      const audioUrl = uploadResult.url;

      const body: any = {
        from: TELNYX_FROM_NUMBER,
        to: phone,
        text: '',
        media_urls: [audioUrl],
        type: 'MMS',
      };
      if (TELNYX_MESSAGING_PROFILE_ID) {
        body.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
      }

      const result = await telnyxRequest('/messages', 'POST', body);
      return { ok: true, messageId: result?.data?.id || '', audioUrl, to: phone };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Voice Call with Provider Selection ───────────────────────────────────────
// Makes a voice call using any registered voice provider (ElevenLabs, OpenAI, etc.)

export const telnyx_voice_call = createTool({
  id: 'telnyx_voice_call',
  description: "Make a real-time AI voice call to the user's phone using a selected voice provider (ElevenLabs, OpenAI Realtime, etc.). The AI has a live two-way conversation.",
  inputSchema: z.object({
    provider: z.enum(['elevenlabs', 'openai-realtime', 'grok-realtime', 'gemini-live', 'auto']).default('auto')
      .describe('Voice provider: elevenlabs, openai-realtime, grok-realtime, gemini-live, or auto (picks best available).'),
    agent_id: z.string().optional().describe('Agent ID (required for ElevenLabs, optional for OpenAI).'),
    voice_id: z.string().optional().describe('Voice ID or name. For OpenAI: alloy, echo, fable, onyx, nova, shimmer.'),
    initial_message: z.string().optional().describe('First thing the AI says when the call connects.'),
    system_prompt: z.string().optional().describe('System prompt for the AI conversation (OpenAI Realtime).'),
    model: z.string().optional().describe('Model to use for the voice provider.'),
    metadata: z.record(z.string(), z.any()).optional().describe('Key-value context passed to the voice agent.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    callControlId: z.string().optional(),
    to: z.string().optional(),
    provider: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const phone = await getVerifiedPhone(userId);
      const publicUrl = process.env.CLOUD_PUBLIC_URL || '';
      if (!publicUrl) throw new Error('CLOUD_PUBLIC_URL not configured.');

      let providerId = input.provider === 'auto' ? getDefaultProviderId() : input.provider;
      const provider = getVoiceProvider(providerId);
      if (!provider) throw new Error(`Voice provider "${providerId}" not available.`);
      if (!provider.isConfigured()) throw new Error(`Voice provider "${providerId}" is not configured.`);

      if (providerId === 'elevenlabs' && !input.agent_id) {
        const defaultAgentId = process.env.ELEVENLABS_DEFAULT_AGENT_ID || '';
        if (!defaultAgentId) throw new Error('agent_id is required for ElevenLabs voice calls.');
        input.agent_id = defaultAgentId;
      }

      const bridgeConfig = Buffer.from(JSON.stringify({
        providerId,
        agentId: input.agent_id,
        voiceId: input.voice_id,
        model: input.model,
        initialMessage: input.initial_message || '',
        systemPrompt: input.system_prompt || '',
        metadata: { ...input.metadata, userId },
        userId,
        direction: 'outbound',
      })).toString('base64');

      const callResult = await telnyxRequest('/calls', 'POST', {
        connection_id: process.env.TELNYX_SIP_CONNECTION_ID || '',
        to: phone,
        from: TELNYX_FROM_NUMBER,
        webhook_url: `${publicUrl}/integrations/telnyx/call-webhook`,
        webhook_url_method: 'POST',
        custom_headers: [
          { name: 'X-Voice-Bridge', value: bridgeConfig },
          { name: 'X-Bridge-Ws-Url', value: Buffer.from(`${publicUrl.replace(/^http/, 'ws')}/ws/telnyx-bridge`).toString('base64') },
        ],
      });

      return {
        ok: true,
        callControlId: callResult?.data?.call_control_id || '',
        to: phone,
        provider: providerId,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── List Voice Providers ────────────────────────────────────────────────────

export const telnyx_list_voice_providers = createTool({
  id: 'telnyx_list_voice_providers',
  description: 'List available voice providers for real-time AI voice calls and their configuration status.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    providers: z.array(z.object({
      id: z.string(),
      name: z.string(),
      configured: z.boolean(),
      inputFormats: z.array(z.string()),
      outputFormats: z.array(z.string()),
    })),
    defaultProvider: z.string(),
  }),
  execute: async () => {
    const { listVoiceProviders, getDefaultProviderId } = await import('../voice');
    const providers = listVoiceProviders().map(p => ({
      id: p.id,
      name: p.name,
      configured: p.isConfigured(),
      inputFormats: p.supportedInputFormats,
      outputFormats: p.supportedOutputFormats,
    }));
    return { ok: true, providers, defaultProvider: getDefaultProviderId() };
  },
});

// ── List Active Calls ───────────────────────────────────────────────────────

export const telnyx_list_active_calls = createTool({
  id: 'telnyx_list_active_calls',
  description: 'List currently active voice calls with their status and duration.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    calls: z.array(z.object({
      callControlId: z.string(),
      provider: z.string(),
      direction: z.string(),
      durationMs: z.number(),
      callerNumber: z.string().optional(),
    })),
  }),
  execute: async () => {
    const calls = listActiveCalls().map(c => ({
      callControlId: c.callControlId,
      provider: c.bridgeConfig.providerId,
      direction: c.bridgeConfig.direction,
      durationMs: Date.now() - c.startedAt,
      callerNumber: c.bridgeConfig.callerNumber,
    }));
    return { ok: true, calls };
  },
});

// ── Hangup Active Call ──────────────────────────────────────────────────────

export const telnyx_hangup_call = createTool({
  id: 'telnyx_hangup_call',
  description: 'Hang up an active voice call by its call control ID.',
  inputSchema: z.object({
    call_control_id: z.string().describe('The call control ID of the active call to hang up.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      removeActiveCall(input.call_control_id);
      await telnyxRequest(`/calls/${input.call_control_id}/actions/hangup`, 'POST', {});
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});
