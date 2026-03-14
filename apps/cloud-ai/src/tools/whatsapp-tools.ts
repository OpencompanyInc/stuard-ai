import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, debitCredits } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { waSendText, waSendMedia, waSendReaction, waMarkRead, waUploadMediaFromUrl } from '../routes/integrations/whatsapp';
import { messagingCreditCost } from '../pricing';

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
