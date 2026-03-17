import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getExternalAccount, debitCredits } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { waSendText, waSendMedia, waSendReaction, waMarkRead, waUploadMediaFromUrl, waGetMediaUrl } from '../routes/integrations/whatsapp';
import { messagingCreditCost } from '../pricing';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { uploadUserFileBuffer } from '../services/cold-storage';

async function requireUserId(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

async function getConnectedWaId(userId: string): Promise<{ waId: string; phone: string }> {
  const acc = await getExternalAccount(userId, 'whatsapp');
  if (!acc) throw new Error('whatsapp_not_connected: No connected WhatsApp number. The user must connect their WhatsApp number in Integrations first.');
  const meta = acc.meta || {};
  if (!meta.connected) throw new Error('whatsapp_not_connected: WhatsApp number is not connected.');
  // waId is the raw digits (no +), phone is the formatted number
  return { waId: String(meta.waId || meta.phone || '').replace(/^\+/, ''), phone: String(meta.phone || '') };
}

// ── Send Text ───────────────────────────────────────────────────────────────

export const whatsapp_send_message = createTool({
  id: 'whatsapp_send_message',
  description: "Send a WhatsApp text message to the user's connected WhatsApp number.",
  inputSchema: z.object({
    message: z.string().describe('The message text to send (max 4096 characters).'),
    preview_url: z.boolean().default(false).describe('Whether to show a URL preview if the message contains a link.'),
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
      const { waId, phone } = await getConnectedWaId(userId);
      const result = await waSendText(waId, String(input.message || '').slice(0, 4096), !!input.preview_url);
      // Deduct messaging credits
      const credits = messagingCreditCost('whatsapp');
      if (credits > 0) {
        debitCredits(userId, {
          sourceType: 'messaging:whatsapp',
          sourceRef: `wa_tool:${result?.messages?.[0]?.id || Date.now()}`,
          credits,
          amountUsd: 0.005,
          metadata: { provider: 'whatsapp', tool: 'whatsapp_send_message' },
        }).catch((e: any) => console.error('[whatsapp-tools] credit deduction failed:', e?.message));
      }
      return { ok: true, messageId: result?.messages?.[0]?.id, to: phone };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Send Media (image / audio voice note / video / document) ────────────────

export const whatsapp_send_media = createTool({
  id: 'whatsapp_send_media',
  description: "Send a media message (image, audio/voice note, video, or document) to the user's WhatsApp. Provide a public URL to the file.",
  inputSchema: z.object({
    type: z.enum(['image', 'audio', 'video', 'document']).describe('Type of media: image, audio (voice note), video, or document.'),
    url: z.string().describe('Public URL of the media file.'),
    caption: z.string().optional().describe('Optional caption for image, video, or document (max 1024 chars).'),
    filename: z.string().optional().describe('Optional filename for documents (e.g. "report.pdf").'),
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
      const { waId, phone } = await getConnectedWaId(userId);
      const result = await waSendMedia(waId, input.type, {
        link: input.url,
        caption: input.caption,
        filename: input.filename,
      });
      return { ok: true, messageId: result?.messages?.[0]?.id, to: phone };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Send Reaction ───────────────────────────────────────────────────────────

export const whatsapp_send_reaction = createTool({
  id: 'whatsapp_send_reaction',
  description: "React to a WhatsApp message with an emoji.",
  inputSchema: z.object({
    message_id: z.string().describe('The WhatsApp message ID to react to.'),
    emoji: z.string().describe('The emoji to react with (e.g. "👍", "❤️", "😂").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const { waId } = await getConnectedWaId(userId);
      await waSendReaction(waId, input.message_id, input.emoji);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Mark as Read ────────────────────────────────────────────────────────────

export const whatsapp_mark_read = createTool({
  id: 'whatsapp_mark_read',
  description: "Mark a WhatsApp message as read (sends read receipt).",
  inputSchema: z.object({
    message_id: z.string().describe('The WhatsApp message ID to mark as read.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await waMarkRead(input.message_id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Upload Media ────────────────────────────────────────────────────────────

export const whatsapp_upload_media = createTool({
  id: 'whatsapp_upload_media',
  description: "Upload a media file to WhatsApp servers from a URL and get a reusable media ID. Useful to avoid re-uploading the same file multiple times.",
  inputSchema: z.object({
    url: z.string().describe('Public URL of the file to upload.'),
    mime_type: z.string().describe('MIME type of the file (e.g. "image/jpeg", "audio/ogg", "video/mp4", "application/pdf").'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    mediaId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await requireUserId();
      const mediaId = await waUploadMediaFromUrl(input.url, input.mime_type);
      return { ok: true, mediaId };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Get Media URL ────────────────────────────────────────────────────────────

export const whatsapp_get_media_url = createTool({
  id: 'whatsapp_get_media_url',
  description: "Get the temporary download URL and metadata for a received WhatsApp media message (image, audio/voice note, video, document). The URL is valid for a short time — download the file promptly.",
  inputSchema: z.object({
    media_id: z.string().describe('The WhatsApp media ID from a received message (e.g. from step.mediaId in an incoming trigger).'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
    fileSize: z.number().optional(),
    sha256: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await requireUserId();
      const info = await waGetMediaUrl(String(input.media_id));
      return { ok: true, url: info.url, mimeType: info.mimeType, fileSize: info.fileSize, sha256: info.sha256 };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Download Media ────────────────────────────────────────────────────────────

export const whatsapp_download_media = createTool({
  id: 'whatsapp_download_media',
  description: "Download a received WhatsApp media file (image, audio/voice note, video, or document) to a local temp file. Returns the file path so you can process, analyze, or upload it.",
  inputSchema: z.object({
    media_id: z.string().describe('The WhatsApp media ID from a received message.'),
    filename: z.string().optional().describe('Optional filename override (e.g. "voice-note.ogg"). If not provided, a name is inferred from the MIME type.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    filePath: z.string().optional(),
    mimeType: z.string().optional(),
    fileSize: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await requireUserId();
      const { WA_ACCESS_TOKEN } = await import('../utils/config');
      if (!WA_ACCESS_TOKEN) throw new Error('WhatsApp not configured on server.');

      const info = await waGetMediaUrl(String(input.media_id));

      // Download the media file
      const res = await fetch(info.url, { headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` } });
      if (!res.ok) throw new Error(`Failed to download media (${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // Determine file extension from MIME type
      const extMap: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
        'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
        'video/mp4': 'mp4', 'video/3gpp': '3gp',
        'application/pdf': 'pdf', 'application/octet-stream': 'bin',
      };
      const ext = extMap[info.mimeType] || info.mimeType.split('/')[1] || 'bin';
      const name = input.filename || `wa_media_${randomUUID().slice(0, 8)}.${ext}`;
      const dir = join(tmpdir(), 'stuard-wa-media');
      await mkdir(dir, { recursive: true }).catch(() => {});
      const filePath = join(dir, name);
      await writeFile(filePath, buffer);

      return { ok: true, filePath, mimeType: info.mimeType, fileSize: buffer.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Status ──────────────────────────────────────────────────────────────────

export const whatsapp_status = createTool({
  id: 'whatsapp_status',
  description: "Check if the user has a connected WhatsApp number for messaging.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    connected: z.boolean(),
    phone: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const userId = await requireUserId();
      const acc = await getExternalAccount(userId, 'whatsapp');
      if (!acc) return { ok: true, connected: false };
      const meta = acc.meta || {};
      return {
        ok: true,
        connected: !!meta.connected,
        phone: meta.connected ? meta.phone : undefined,
      };
    } catch (e: any) {
      return { ok: false, connected: false, error: String(e?.message || e) };
    }
  },
});

// ── Send Voice Note ─────────────────────────────────────────────────────────
// Generates audio with ElevenLabs TTS, uploads, and sends as WhatsApp audio.

export const whatsapp_send_voice_note = createTool({
  id: 'whatsapp_send_voice_note',
  description: "Generate a voice note using ElevenLabs TTS and send it as a WhatsApp audio message.",
  inputSchema: z.object({
    message: z.string().describe('The text to convert to a voice note and send.'),
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
      const { waId, phone } = await getConnectedWaId(userId);

      const el = new ElevenLabsClient();
      const audioStream = await el.textToSpeech.convert(input.voice_id, {
        text: String(input.message || '').slice(0, 3000),
        modelId: input.model_id || 'eleven_turbo_v2_5',
        outputFormat: 'opus_48000_64',
      } as any);

      // Buffer the stream
      const chunks: Uint8Array[] = [];
      const reader = (audioStream as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const buf = Buffer.alloc(totalLen);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }

      // Upload to cloud storage
      const filename = `wa_voice_${randomUUID().slice(0, 8)}.ogg`;
      const uploadResult = await uploadUserFileBuffer(userId, filename, buf, 'audio/ogg', 'voice-notes', 'public');
      const audioUrl = uploadResult.url;

      // Send as WhatsApp audio message
      const result = await waSendMedia(waId, 'audio', { link: audioUrl });

      const credits = messagingCreditCost('whatsapp');
      if (credits > 0) {
        debitCredits(userId, {
          sourceType: 'messaging:whatsapp',
          sourceRef: `wa_voice:${result?.messages?.[0]?.id || Date.now()}`,
          credits: credits * 2,
          amountUsd: 0.008,
          metadata: { provider: 'whatsapp', tool: 'whatsapp_send_voice_note' },
        }).catch((e: any) => console.error('[whatsapp-tools] voice note credit deduction failed:', e?.message));
      }

      return { ok: true, messageId: result?.messages?.[0]?.id, audioUrl, to: phone };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Transcribe Voice Note ───────────────────────────────────────────────────
// Downloads a received voice note and transcribes it using OpenAI Whisper.

export const whatsapp_transcribe_voice_note = createTool({
  id: 'whatsapp_transcribe_voice_note',
  description: "Download and transcribe a received WhatsApp voice note using speech-to-text.",
  inputSchema: z.object({
    media_id: z.string().describe('The WhatsApp media ID of the voice note to transcribe.'),
    language: z.string().optional().describe('Language code hint (e.g. "en", "es") for better transcription accuracy.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    transcript: z.string().optional(),
    language: z.string().optional(),
    duration: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      await requireUserId();
      const { WA_ACCESS_TOKEN } = await import('../utils/config');
      if (!WA_ACCESS_TOKEN) throw new Error('WhatsApp not configured on server.');

      const info = await waGetMediaUrl(String(input.media_id));
      const mediaRes = await fetch(info.url, { headers: { 'Authorization': `Bearer ${WA_ACCESS_TOKEN}` } });
      if (!mediaRes.ok) throw new Error(`Failed to download voice note (${mediaRes.status})`);
      const buffer = Buffer.from(await mediaRes.arrayBuffer());

      // Save to temp file for transcription
      const dir = join(tmpdir(), 'stuard-wa-media');
      await mkdir(dir, { recursive: true }).catch(() => {});
      const ext = info.mimeType.includes('ogg') ? 'ogg' : info.mimeType.includes('mp4') ? 'm4a' : 'mp3';
      const tempPath = join(dir, `transcribe_${randomUUID().slice(0, 8)}.${ext}`);
      await writeFile(tempPath, buffer);

      // Transcribe using OpenAI Whisper API
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!openaiKey) throw new Error('OPENAI_API_KEY not configured for transcription.');

      const form = new FormData();
      form.append('file', new Blob([buffer], { type: info.mimeType }), `audio.${ext}`);
      form.append('model', 'whisper-1');
      if (input.language) form.append('language', input.language);

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: form,
      });
      if (!whisperRes.ok) throw new Error(`Transcription failed (${whisperRes.status})`);
      const whisperJson = await whisperRes.json() as any;

      return {
        ok: true,
        transcript: whisperJson.text || '',
        language: whisperJson.language,
        duration: whisperJson.duration,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Voice Call (via Telnyx bridge to WhatsApp number) ───────────────────────
// WhatsApp doesn't have native VoIP API, but we can call the user's phone
// number (same number as their WhatsApp) via Telnyx and bridge to an AI voice.

export const whatsapp_voice_call = createTool({
  id: 'whatsapp_voice_call',
  description: "Make a real-time AI voice call to the user's WhatsApp phone number using a selected voice provider (ElevenLabs, OpenAI Realtime, Grok, Gemini). The call goes to their phone number via Telnyx.",
  inputSchema: z.object({
    provider: z.enum(['elevenlabs', 'openai-realtime', 'grok-realtime', 'gemini-live', 'auto']).default('auto')
      .describe('Voice provider for the AI conversation.'),
    agent_id: z.string().optional().describe('Agent ID (required for ElevenLabs).'),
    voice_id: z.string().optional().describe('Voice ID or name.'),
    initial_message: z.string().optional().describe('First thing the AI says when the call connects.'),
    system_prompt: z.string().optional().describe('System prompt for the AI conversation.'),
    model: z.string().optional().describe('Model override for the voice provider.'),
    metadata: z.record(z.string(), z.any()).optional().describe('Context data passed to the voice agent.'),
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
      const { phone } = await getConnectedWaId(userId);
      if (!phone) throw new Error('No phone number associated with WhatsApp account.');

      const { TELNYX_API_KEY, TELNYX_FROM_NUMBER } = await import('../utils/config');
      if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) throw new Error('Telnyx not configured on server.');

      const publicUrl = process.env.CLOUD_PUBLIC_URL || '';
      if (!publicUrl) throw new Error('CLOUD_PUBLIC_URL not configured.');

      const { getVoiceProvider, getDefaultProviderId } = await import('../voice');
      const providerId = input.provider === 'auto' ? getDefaultProviderId() : input.provider;
      const provider = getVoiceProvider(providerId);
      if (!provider) throw new Error(`Voice provider "${providerId}" not available.`);
      if (!provider.isConfigured()) throw new Error(`Voice provider "${providerId}" is not configured.`);

      if (providerId === 'elevenlabs' && !input.agent_id) {
        const defaultAgentId = process.env.ELEVENLABS_DEFAULT_AGENT_ID || '';
        if (!defaultAgentId) throw new Error('agent_id required for ElevenLabs voice calls.');
        input.agent_id = defaultAgentId;
      }

      const phoneE164 = phone.startsWith('+') ? phone : `+${phone}`;

      const bridgeConfig = Buffer.from(JSON.stringify({
        providerId,
        agentId: input.agent_id,
        voiceId: input.voice_id,
        model: input.model,
        initialMessage: input.initial_message || '',
        systemPrompt: input.system_prompt || '',
        metadata: { ...input.metadata, userId, source: 'whatsapp_voice_call' },
        userId,
        callerNumber: phoneE164,
        direction: 'outbound',
      })).toString('base64');

      const TELNYX_API = 'https://api.telnyx.com/v2';
      const callRes = await fetch(`${TELNYX_API}/calls`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: process.env.TELNYX_SIP_CONNECTION_ID || '',
          to: phoneE164,
          from: TELNYX_FROM_NUMBER,
          webhook_url: `${publicUrl}/integrations/telnyx/call-webhook`,
          webhook_url_method: 'POST',
          custom_headers: [
            { name: 'X-Voice-Bridge', value: bridgeConfig },
            { name: 'X-Bridge-Ws-Url', value: Buffer.from(`${publicUrl.replace(/^http/, 'ws')}/ws/telnyx-bridge`).toString('base64') },
          ],
        }),
      });
      const callJson = await callRes.json() as any;
      if (!callRes.ok) throw new Error(callJson?.errors?.[0]?.detail || `Call failed (${callRes.status})`);

      return {
        ok: true,
        callControlId: callJson?.data?.call_control_id || '',
        to: phoneE164,
        provider: providerId,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── WhatsApp Make Basic Call (TTS) ──────────────────────────────────────────

export const whatsapp_make_call = createTool({
  id: 'whatsapp_make_call',
  description: "Call the user's WhatsApp phone number and speak a message using basic TTS.",
  inputSchema: z.object({
    message: z.string().describe('The message to speak when the call is answered.'),
    voice: z.enum(['female', 'male']).default('female').describe('TTS voice gender.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    callControlId: z.string().optional(),
    to: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const userId = await requireUserId();
      const { phone } = await getConnectedWaId(userId);
      if (!phone) throw new Error('No phone number associated with WhatsApp account.');

      const { TELNYX_API_KEY, TELNYX_FROM_NUMBER } = await import('../utils/config');
      if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) throw new Error('Telnyx not configured.');

      const phoneE164 = phone.startsWith('+') ? phone : `+${phone}`;
      const publicUrl = process.env.CLOUD_PUBLIC_URL || '';
      const TELNYX_API = 'https://api.telnyx.com/v2';

      const callRes = await fetch(`${TELNYX_API}/calls`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: process.env.TELNYX_SIP_CONNECTION_ID || '',
          to: phoneE164,
          from: TELNYX_FROM_NUMBER,
          answering_machine_detection: 'detect',
          webhook_url: `${publicUrl}/integrations/telnyx/call-webhook`,
          webhook_url_method: 'POST',
          custom_headers: [
            { name: 'X-Tts-Message', value: Buffer.from(input.message).toString('base64') },
            { name: 'X-Tts-Voice', value: input.voice || 'female' },
          ],
        }),
      });
      const callJson = await callRes.json() as any;
      if (!callRes.ok) throw new Error(callJson?.errors?.[0]?.detail || `Call failed (${callRes.status})`);

      return {
        ok: true,
        callControlId: callJson?.data?.call_control_id || '',
        to: phoneE164,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});

// ── Send WhatsApp Template ──────────────────────────────────────────────────

export const whatsapp_send_template = createTool({
  id: 'whatsapp_send_template',
  description: "Send a WhatsApp template message. Templates must be pre-approved in the Meta Business dashboard.",
  inputSchema: z.object({
    template_name: z.string().describe('Name of the approved WhatsApp message template.'),
    language_code: z.string().default('en_US').describe('Template language code (e.g. "en_US", "es", "pt_BR").'),
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
      const { waId, phone } = await getConnectedWaId(userId);
      const { waSendTemplate } = await import('../routes/integrations/whatsapp');
      const result = await waSendTemplate(waId, input.template_name, input.language_code);
      return { ok: true, messageId: result?.messages?.[0]?.id, to: phone };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
});
