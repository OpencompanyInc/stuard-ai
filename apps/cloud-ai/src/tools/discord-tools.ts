import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccount, getExternalAccessToken, upsertExternalAccount } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets } from './device/shared';
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from '../utils/config';

const DISCORD_API = 'https://discord.com/api/v10';

const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
    return (secrets as any)?.discordProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

function requireUserId(): string {
  const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

/**
 * Refresh a Discord OAuth2 token using the refresh_token grant.
 * Returns the new access token, or null if refresh failed.
 */
async function refreshDiscordToken(userId: string, acc: any): Promise<string | null> {
  if (!acc?.refresh_token || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return null;
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: String(acc.refresh_token),
      }),
    });
    const tBody: any = await (async () => { try { return await tokenRes.json(); } catch { return null; } })();
    if (tokenRes.ok && tBody?.access_token) {
      const newAccess = String(tBody.access_token);
      const expiresIn = Number(tBody.expires_in || 604800);
      const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
      const refresh_token = String(tBody.refresh_token || acc.refresh_token || '');
      const scopeStr = String(tBody.scope || '');
      const scopes = scopeStr ? scopeStr.split(' ').map((s: string) => s.trim()).filter(Boolean) : (Array.isArray(acc.scopes) ? acc.scopes : []);
      try {
        await upsertExternalAccount({
          userId,
          provider: 'discord',
          access_token: newAccess,
          scopes,
          refresh_token: refresh_token || null,
          expires_at,
          meta: { token_type: tBody.token_type || 'Bearer' },
          profileLabel: acc.profile_label || 'default',
          accountEmail: acc.account_email || null,
        });
      } catch {}
      return newAccess;
    }
  } catch {}
  return null;
}

/**
 * Fetch from Discord API with automatic token refresh on 401.
 * Mirrors the googleAuthorizedFetch pattern.
 */
async function discordFetch(path: string, profileLabel?: string, init?: RequestInit) {
  const userId = requireUserId();
  const profile = resolveProfile(profileLabel);
  let acc = await getExternalAccount(userId, 'discord', profile);
  if (!acc?.access_token) throw new Error('discord_not_connected');

  let accessToken = acc.access_token;

  // Proactively refresh if token is expired or about to expire (within 5 min)
  if (acc.expires_at) {
    const expiresAt = new Date(acc.expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshDiscordToken(userId, acc);
      if (refreshed) accessToken = refreshed;
    }
  }

  async function doFetch(token: string) {
    const url = path.startsWith('http') ? path : `${DISCORD_API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'StuardAI-Cloud',
      ...(init?.headers as any),
    };
    // Only set Content-Type for non-GET requests
    if (init?.method && init.method !== 'GET') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    const res = await fetch(url, { ...init, headers });
    return res;
  }

  let res = await doFetch(accessToken);

  // On 401, try refreshing the token once
  if (res.status === 401 && acc.refresh_token) {
    const refreshed = await refreshDiscordToken(userId, acc);
    if (refreshed) {
      accessToken = refreshed;
      res = await doFetch(accessToken);
    }
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw new Error(`Discord rate limited. Retry after ${retryAfter || 'a few'} seconds.`);
  }

  // For 204 No Content (e.g. reactions), return success
  if (res.status === 204) return { _noContent: true };

  let body: any = null;
  try { body = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Discord authentication failed. The token may have expired or permissions changed. Please reconnect Discord in Settings → Integrations.');
    }
    const msg = (body && (body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

// ── List Guilds (Servers) ──

export const discord_list_guilds = createTool({
  id: 'discord_list_guilds',
  description: 'List Discord servers (guilds) the connected user is a member of.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const guilds = await discordFetch('/users/@me/guilds', profile);
    return {
      guilds: guilds.map((g: any) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        owner: g.owner,
      })),
      count: Array.isArray(guilds) ? guilds.length : 0,
    };
  },
});

// ── List Channels in a Server ──

export const discord_list_channels = createTool({
  id: 'discord_list_channels',
  description: 'List text channels in a Discord server. Requires the guild/server ID.',
  inputSchema: z.object({
    guild_id: z.string().min(1).describe('The Discord server (guild) ID'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { guild_id, profile } = inputData as any;
    const channels = await discordFetch(`/guilds/${guild_id}/channels`, profile);
    // Type 0 = text, Type 5 = announcement, Type 15 = forum
    const textChannels = channels.filter((c: any) => c.type === 0 || c.type === 5);
    return {
      channels: textChannels.map((c: any) => ({
        id: c.id,
        name: c.name,
        type: c.type === 0 ? 'text' : 'announcement',
        category: c.parent_id,
        position: c.position,
      })),
      count: textChannels.length,
    };
  },
});

// ── List DM Conversations ──

export const discord_list_dms = createTool({
  id: 'discord_list_dms',
  description: "List the connected user's DM (direct message) conversations on Discord.",
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const channels = await discordFetch('/users/@me/channels', profile);
    return {
      dms: channels.map((c: any) => ({
        id: c.id,
        type: c.type === 1 ? 'dm' : 'group_dm',
        recipients: c.recipients?.map((r: any) => ({
          id: r.id,
          username: r.username,
          global_name: r.global_name,
        })),
      })),
      count: Array.isArray(channels) ? channels.length : 0,
    };
  },
});

// ── Read Messages ──

export const discord_read_messages = createTool({
  id: 'discord_read_messages',
  description: 'Read recent messages from a Discord channel or DM conversation. Works with both server channel IDs and DM channel IDs.',
  inputSchema: z.object({
    channel_id: z.string().min(1).describe('The channel or DM channel ID to read messages from'),
    limit: z.number().int().min(1).max(100).default(25).describe('Number of messages to fetch (1-100, default 25)'),
    before: z.string().optional().describe('Fetch messages before this message ID (for pagination)'),
    after: z.string().optional().describe('Fetch messages after this message ID (for pagination)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { channel_id, limit, before, after, profile } = inputData as any;
    const params = new URLSearchParams({ limit: String(limit || 25) });
    if (before) params.set('before', before);
    if (after) params.set('after', after);

    const messages = await discordFetch(`/channels/${channel_id}/messages?${params}`, profile);
    return {
      messages: messages.map((m: any) => ({
        id: m.id,
        author: {
          id: m.author.id,
          username: m.author.username,
          global_name: m.author.global_name,
          bot: m.author.bot || false,
        },
        content: m.content,
        timestamp: m.timestamp,
        attachments: m.attachments?.map((a: any) => ({ filename: a.filename, url: a.url })),
        embeds_count: m.embeds?.length || 0,
        reactions: m.reactions?.map((r: any) => ({ emoji: r.emoji.name, count: r.count })),
      })),
      count: Array.isArray(messages) ? messages.length : 0,
    };
  },
});

// ── Send DM ──

export const discord_send_dm = createTool({
  id: 'discord_send_dm',
  description: 'Send a direct message (DM) on Discord. Only works with DM channel IDs, NOT server channels. Use discord_list_dms to find DM channel IDs first.',
  inputSchema: z.object({
    channel_id: z.string().min(1).describe('The DM channel ID to send a message to. Get this from discord_list_dms.'),
    content: z.string().min(1).max(2000).describe('The message content (max 2000 characters)'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { channel_id, content, profile } = inputData as any;
    const result = await discordFetch(`/channels/${channel_id}/messages`, profile, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return {
      sent: true,
      id: result.id,
      channel_id: result.channel_id,
      content: result.content,
      timestamp: result.timestamp,
    };
  },
});

// ── Add Reaction ──

export const discord_add_reaction = createTool({
  id: 'discord_add_reaction',
  description: 'Add an emoji reaction to a Discord message. Works in both server channels and DMs.',
  inputSchema: z.object({
    channel_id: z.string().min(1).describe('The channel ID containing the message'),
    message_id: z.string().min(1).describe('The message ID to react to'),
    emoji: z.string().min(1).describe('The emoji to react with (e.g. "👍", "❤️", or custom format "name:id")'),
    profile: profileField,
  }),
  execute: async (inputData) => {
    const { channel_id, message_id, emoji, profile } = inputData as any;
    const encodedEmoji = encodeURIComponent(emoji);
    const result = await discordFetch(
      `/channels/${channel_id}/messages/${message_id}/reactions/${encodedEmoji}/@me`,
      profile,
      { method: 'PUT' }
    );
    return { success: true, emoji, message_id };
  },
});
