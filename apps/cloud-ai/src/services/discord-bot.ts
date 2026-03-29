/**
 * Discord Bot Service — DM-based personal assistant (like SMS integration).
 *
 * Users DM the bot directly. The bot maps the Discord user ID → StuardAI user
 * (via external_accounts), processes the message through the agent, and sends
 * the reply back as a Discord DM.
 *
 * Supports: text, images, attachments, reactions, slash commands, voice calls.
 * Voice: bridges Discord DM voice to the voice provider system (OpenAI Realtime, etc.).
 *
 * Start: call startDiscordBot() on server boot (gated by DISCORD_BOT_TOKEN).
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  Message,
  Events,
  ActivityType,
  REST,
  Routes,
  EmbedBuilder,
  AttachmentBuilder,
  type Interaction,
  type Attachment,
} from 'discord.js';
import { generateText } from 'ai';
import {
  findUserIdByDiscordId,
  getDiscordUserState,
  upsertDiscordUserState,
  createConversation,
  addUserMessage,
  addAssistantMessage,
  checkAccess,
  debitCredits,
  logUsageEvent,
  getCloudEngine,
} from '../supabase';
import { getAgentForQuery } from '../agents/stuard/index';
import { runWithSecrets } from '../tools/bridge';
import { getDefaultModelForCategory, messagingCreditCost } from '../pricing';
import { buildProviderModel } from '../utils/models';
import { DISCORD_BOT_TOKEN, PUBLIC_BASE_URL, DISCORD_CLIENT_ID } from '../utils/config';
import { getOrCreateQueryEmbedding } from '../utils/shared-embedding';
import { sendVMCommand } from './vm-command';
import { bridgeDiscordVoice, disconnectDiscordVoice, getActiveDiscordCall } from './discord-voice-bridge';
import type { ModelChoice } from '../router/model-router';
import { MediaProcessor, fromDiscordAttachments } from '../media';

const LOG_PREFIX = '[discord-bot]';

// ── Typing indicator management ──────────────────────────────────────────────
const activeTyping = new Map<string, NodeJS.Timeout>();

function startTyping(channel: Message['channel']): void {
  const id = channel.id;
  stopTyping(id);
  if (!('sendTyping' in channel)) return;
  channel.sendTyping().catch(() => {});
  const interval = setInterval(() => {
    if ('sendTyping' in channel) channel.sendTyping().catch(() => {});
  }, 8000);
  activeTyping.set(id, interval);
}

function stopTyping(channelId: string): void {
  const interval = activeTyping.get(channelId);
  if (interval) {
    clearInterval(interval);
    activeTyping.delete(channelId);
  }
}

// ── Message formatting ───────────────────────────────────────────────────────

/** Split text into Discord-safe chunks (max 2000 chars). */
function formatForDiscord(text: string): string[] {
  const clean = text.trim();
  if (!clean) return ['I processed your request but had no text to send.'];

  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > 0) {
    if (remaining.length <= 2000) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', 2000);
    if (splitAt < 1000) splitAt = remaining.lastIndexOf(' ', 2000);
    if (splitAt < 1000) splitAt = 2000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ── Attachment handling ──────────────────────────────────────────────────────

interface ParsedAttachment {
  type: 'image' | 'audio' | 'video' | 'document';
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

function classifyAttachment(att: Attachment): ParsedAttachment {
  const ct = (att.contentType || '').toLowerCase();
  let type: ParsedAttachment['type'] = 'document';
  if (ct.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(att.name || '')) type = 'image';
  else if (ct.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(att.name || '')) type = 'audio';
  else if (ct.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(att.name || '')) type = 'video';

  return {
    type,
    url: att.url,
    filename: att.name || 'attachment',
    contentType: att.contentType || 'application/octet-stream',
    size: att.size,
  };
}

/** Download an image attachment and return as a base64 data URL for multimodal models. */
async function downloadImageAsBase64(url: string): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    return { base64: buffer.toString('base64'), mediaType: contentType };
  } catch {
    return null;
  }
}

/** Build the user message content including text + image attachments for multimodal. */
async function buildMessageContent(text: string, attachments: ParsedAttachment[]): Promise<string> {
  const images = attachments.filter(a => a.type === 'image');
  const others = attachments.filter(a => a.type !== 'image');

  const parts: string[] = [];
  if (text) parts.push(text);

  // Describe non-image attachments in text
  for (const att of others) {
    parts.push(`[${att.type}: ${att.filename} (${att.contentType}, ${(att.size / 1024).toFixed(1)}KB)]`);
  }

  // For images, add description hint (actual multimodal is handled in processMessage)
  for (const img of images) {
    parts.push(`[Image attached: ${img.filename}]`);
  }

  return parts.join('\n') || '[empty message]';
}

// ── Slash commands ───────────────────────────────────────────────────────────

const DISCORD_HELP_TEXT =
  '**Stuard AI — Discord DM Assistant**\n\n' +
  'Just type a message to chat with your AI agent.\n\n' +
  '**Features:**\n' +
  '- Text chat (just DM me)\n' +
  '- Image analysis (send images with your message)\n' +
  '- File sharing (attach documents)\n' +
  '- Full agent with tools (web search, email, calendar, etc.)\n\n' +
  '**Commands:**\n' +
  '`/model <fast|balanced|smart>` — Set AI model\n' +
  '`/new` — Start a new conversation\n' +
  '`/status` — Show current settings\n' +
  '`/help` — Show this help message\n\n' +
  '**Tip:** Connect your Discord account at your Stuard dashboard to enable DM access.';

async function handleSlashCommand(userId: string, command: string, message: Message): Promise<boolean> {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  switch (cmd) {
    case '/model': {
      const model = arg.toLowerCase();
      if (['fast', 'balanced', 'smart', 'research'].includes(model)) {
        await upsertDiscordUserState({ userId, preferredModel: model as any });
        await message.reply(`AI model set to **${model}**.`);
      } else {
        await message.reply('Usage: `/model <fast|balanced|smart|research>`');
      }
      return true;
    }
    case '/new': {
      await upsertDiscordUserState({ userId, conversationId: null });
      await message.reply('New conversation started. Previous context cleared.');
      return true;
    }
    case '/status': {
      const state = await getDiscordUserState(userId);
      const engine = await getCloudEngine(userId);
      const vmStatus = engine?.status === 'running' ? 'Running' : engine?.status || 'Not provisioned';
      await message.reply(
        `**Stuard DM Status**\n` +
        `Model: **${state.preferred_model}**\n` +
        `Cloud VM: ${vmStatus}\n` +
        `Conversation: ${state.conversation_id ? `Active (\`${state.conversation_id.slice(0, 8)}...\`)` : 'None'}`
      );
      return true;
    }
    case '/help': {
      await message.reply(DISCORD_HELP_TEXT);
      return true;
    }
    default:
      return false;
  }
}

// ── Agent processing ─────────────────────────────────────────────────────────

async function processMessage(
  userId: string,
  discordUserId: string,
  text: string,
  attachments: ParsedAttachment[],
  state: Awaited<ReturnType<typeof getDiscordUserState>>,
): Promise<{ text: string; images?: string[] }> {
  const model = (state.preferred_model || 'balanced') as ModelChoice;

  // Check credits
  const access = await checkAccess(userId);
  if (!access.allowed) {
    return { text: 'You\'ve reached your usage limit. Please upgrade your plan or wait for the next billing cycle.' };
  }

  // ── Process media through unified MediaProcessor ─────────────────────────
  const inboundMedia = fromDiscordAttachments(attachments);
  let mediaResult = { attachments: [] as any[], supplementaryText: '', items: [] as any[] };
  if (inboundMedia.length > 0) {
    try {
      mediaResult = await MediaProcessor.process(inboundMedia);
    } catch (e: any) {
      console.warn(LOG_PREFIX, 'MediaProcessor failed:', e?.message);
    }
  }

  // Build full message text: original text + descriptions for non-processed items + transcriptions
  const textParts: string[] = [];
  if (text) textParts.push(text);
  if (mediaResult.supplementaryText) textParts.push(mediaResult.supplementaryText);
  // For items that weren't turned into attachments (video), add text descriptions
  for (const att of attachments) {
    if (att.type === 'video') {
      textParts.push(`[Video attached: ${att.filename} (${att.contentType}, ${(att.size / 1024).toFixed(1)}KB)]`);
    }
  }
  const fullText = textParts.join('\n') || '[empty message]';
  const processedAttachments = mediaResult.attachments;

  // Create or continue conversation
  let convId = state.conversation_id;
  if (!convId) {
    convId = await createConversation(userId, fullText, model, { mode: model }, 'stuard', true);
    await upsertDiscordUserState({ userId, discordUserId, conversationId: convId });
  } else {
    await addUserMessage(userId, convId, fullText, { mode: model }, true);
  }

  // Try VM agent first (if user has a running VM)
  const engine = await getCloudEngine(userId);
  const vmRunning = !!(engine && engine.status === 'running');

  if (vmRunning) {
    try {
      let queryEmbedding: number[] | undefined;
      try { queryEmbedding = await getOrCreateQueryEmbedding(text || fullText); } catch {}

      const vmResult = await sendVMCommand(userId, 'agent_chat', {
        message: fullText,
        conversationId: convId || undefined,
        model,
        context: {
          source: 'discord',
          discordUserId,
        },
        ...(processedAttachments.length > 0 ? { attachments: processedAttachments } : {}),
        memoryQuery: text || fullText,
        ...(queryEmbedding ? { queryEmbedding } : {}),
      }, 60_000);

      if (vmResult.ok && vmResult.result?.text) {
        const replyText = String(vmResult.result.text);
        const vmConvId = vmResult.result?.conversationId || convId;
        if (vmConvId) {
          await addAssistantMessage(userId, vmConvId, replyText, { mode: model }, true);
        }
        if (vmConvId && vmConvId !== state.conversation_id) {
          await upsertDiscordUserState({ userId, conversationId: vmConvId });
        }
        return { text: replyText };
      }
    } catch (err: any) {
      console.warn(LOG_PREFIX, 'VM agent failed, falling back to direct:', err?.message);
    }
  }

  // Direct agent processing (no VM)
  try {
    const agent = await getAgentForQuery(model, text || fullText, 'medium', ['discord']);

    // Build multimodal message content if we have processed media
    let userContent: any = fullText;
    if (processedAttachments.length > 0) {
      const parts: any[] = [{ type: 'text', text: fullText }];
      for (const att of processedAttachments) {
        if (att.type === 'image' && att.data) {
          // data is a base64 data URI — extract for image part
          parts.push({ type: 'image', image: att.data });
        } else if (att.type === 'file' && att.data) {
          parts.push({ type: 'file', data: att.data, mediaType: att.mimeType, filename: att.name });
        }
      }
      userContent = parts;
    }

    const messages = [{ role: 'user' as const, content: userContent }];

    const result = await runWithSecrets({ userId }, async () => {
      return (agent as any).generate(messages, { maxSteps: 10 });
    });

    const replyText = String(result?.text || result?.content || '').trim();
    if (!replyText) return { text: 'I processed your request but couldn\'t generate a response. Please try again.' };

    if (convId) {
      await addAssistantMessage(userId, convId, replyText, { mode: model }, true);
    }

    try {
      await logUsageEvent(userId, convId, model, {
        ...(result?.usage || {}),
        sourceType: 'discord_dm',
      });
    } catch {}

    return { text: replyText };
  } catch (err: any) {
    console.error(LOG_PREFIX, 'Agent processing failed:', err?.message || err);

    // Fallback: simple generateText without tools
    try {
      const modelId = getDefaultModelForCategory(model);
      const providerModel = buildProviderModel(modelId);
      // Include images in fallback if available
      let fallbackContent: any = fullText;
      if (processedAttachments.length > 0) {
        const parts: any[] = [{ type: 'text', text: fullText }];
        for (const att of processedAttachments) {
          if (att.type === 'image' && att.data) {
            parts.push({ type: 'image', image: att.data });
          }
        }
        fallbackContent = parts;
      }
      const result = await generateText({
        model: providerModel as any,
        messages: [{ role: 'user' as const, content: fallbackContent }],
        temperature: 0.7,
      });
      const replyText = String(result?.text || '').trim();
      if (convId && replyText) {
        await addAssistantMessage(userId, convId, replyText, { mode: model }, true);
      }
      try {
        await logUsageEvent(userId, convId, modelId, {
          ...(result?.usage || {}),
          sourceType: 'discord_dm_fallback',
        });
      } catch {}
      return { text: replyText || 'Sorry, I couldn\'t generate a response.' };
    } catch (fallbackErr: any) {
      console.error(LOG_PREFIX, 'Fallback generateText also failed:', fallbackErr?.message);
      return { text: 'I\'m having trouble processing your request right now. Please try again later.' };
    }
  }
}

// ── Credit deduction ─────────────────────────────────────────────────────────

async function deductDiscordCredit(userId: string): Promise<void> {
  const credits = messagingCreditCost('discord');
  if (credits <= 0) return;
  try {
    await debitCredits(userId, {
      sourceType: 'messaging:discord',
      sourceRef: `discord_dm:${Date.now()}`,
      credits,
      amountUsd: 0.001,
      metadata: { provider: 'discord' },
    });
  } catch (e: any) {
    console.error(LOG_PREFIX, 'credit deduction failed:', e?.message);
  }
}

// ── Not-linked message ───────────────────────────────────────────────────────

function getNotLinkedMessage(): string {
  return (
    'Hi! I\'m **Stuard AI**, your personal assistant.\n\n' +
    'To get started, you need to link your Discord account to your Stuard account.\n\n' +
    '**Connect here:** Log in to your Stuard dashboard and connect Discord under Settings > Integrations.\n\n' +
    'Once connected, you can DM me anytime and I\'ll respond just like a text message!'
  );
}

// ── Register slash commands ──────────────────────────────────────────────────

async function registerSlashCommands(): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) return;
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  const commands = [
    {
      name: 'model',
      description: 'Set AI model tier (fast, balanced, smart, research)',
      options: [{
        name: 'tier', description: 'Model tier', type: 3, required: true,
        choices: [
          { name: 'Fast', value: 'fast' },
          { name: 'Balanced', value: 'balanced' },
          { name: 'Smart', value: 'smart' },
          { name: 'Research', value: 'research' },
        ],
      }],
    },
    { name: 'new', description: 'Start a new conversation (clear context)' },
    { name: 'status', description: 'Show current bot settings and status' },
    { name: 'help', description: 'Show help and available commands' },
  ];
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log(LOG_PREFIX, 'Slash commands registered');
  } catch (err: any) {
    console.warn(LOG_PREFIX, 'Failed to register slash commands:', err?.message);
  }
}

// ── Interaction handler (slash commands via Discord interaction API) ──────────

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const discordUserId = interaction.user.id;
  const userId = await findUserIdByDiscordId(discordUserId);

  if (!userId) {
    await interaction.reply({ content: getNotLinkedMessage(), ephemeral: true });
    return;
  }

  const cmd = interaction.commandName;

  switch (cmd) {
    case 'model': {
      const tier = interaction.options.getString('tier') || 'balanced';
      if (['fast', 'balanced', 'smart', 'research'].includes(tier)) {
        await upsertDiscordUserState({ userId, preferredModel: tier as any });
        await interaction.reply({ content: `AI model set to **${tier}**.`, ephemeral: true });
      }
      break;
    }
    case 'new': {
      await upsertDiscordUserState({ userId, conversationId: null });
      await interaction.reply({ content: 'New conversation started. Previous context cleared.', ephemeral: true });
      break;
    }
    case 'status': {
      const state = await getDiscordUserState(userId);
      const engine = await getCloudEngine(userId);
      const vmStatus = engine?.status === 'running' ? 'Running' : engine?.status || 'Not provisioned';
      await interaction.reply({
        content: `**Stuard DM Status**\nModel: **${state.preferred_model}**\nCloud VM: ${vmStatus}\nConversation: ${state.conversation_id ? 'Active' : 'None'}`,
        ephemeral: true,
      });
      break;
    }
    case 'help': {
      await interaction.reply({ content: DISCORD_HELP_TEXT, ephemeral: true });
      break;
    }
  }
}

// ── Reply helpers (text, embeds, images) ─────────────────────────────────────

/** Send a rich reply with optional embed and reaction. */
async function sendRichReply(
  message: Message,
  text: string,
  options?: { react?: string; embed?: EmbedBuilder; files?: AttachmentBuilder[] },
): Promise<void> {
  const chunks = formatForDiscord(text);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const replyOpts: any = { content: chunks[i] };

    // Attach embed and files only to the last chunk
    if (isLast) {
      if (options?.embed) replyOpts.embeds = [options.embed];
      if (options?.files?.length) replyOpts.files = options.files;
    }

    if (i === 0) {
      await message.reply(replyOpts);
    } else if ('send' in message.channel) {
      await message.channel.send(replyOpts);
    }
  }

  // Add reaction to the original user message
  if (options?.react) {
    try {
      await message.react(options.react);
    } catch {}
  }
}

// ── Main bot startup ─────────────────────────────────────────────────────────

let botClient: Client | null = null;

export function getDiscordBotClient(): Client | null {
  return botClient;
}

/**
 * Send a DM to a user by their Discord user ID.
 * Can be called from other services (e.g. proactive notifications, reminders).
 */
export async function sendDiscordDM(
  discordUserId: string,
  text: string,
  options?: { embed?: { title: string; description: string; color?: number } },
): Promise<boolean> {
  if (!botClient) return false;
  try {
    const user = await botClient.users.fetch(discordUserId);
    const dm = await user.createDM();
    const sendOpts: any = { content: text };
    if (options?.embed) {
      const embed = new EmbedBuilder()
        .setTitle(options.embed.title)
        .setDescription(options.embed.description)
        .setColor(options.embed.color || 0x5865f2);
      sendOpts.embeds = [embed];
    }
    await dm.send(sendOpts);
    return true;
  } catch (err: any) {
    console.error(LOG_PREFIX, 'Failed to send DM:', err?.message);
    return false;
  }
}

export async function startDiscordBot(): Promise<void> {
  if (!DISCORD_BOT_TOKEN) {
    console.log(LOG_PREFIX, 'DISCORD_BOT_TOKEN not set, skipping bot startup');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, // Needed to see shared servers and fetch users for DMs
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.DirectMessageTyping,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates, // For detecting DM voice calls
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.Reaction,
    ],
  });

  // ── Ready ──
  client.once(Events.ClientReady, (c: Client<true>) => {
    console.log(LOG_PREFIX, `Bot online as ${c.user.tag} (${c.user.id})`);
    c.user.setActivity('DM me to chat!', { type: ActivityType.Custom });
    registerSlashCommands().catch(() => {});
  });

  // ── Interaction (slash commands) ──
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (err: any) {
      console.error(LOG_PREFIX, 'Interaction error:', err?.message);
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true });
        }
      } catch {}
    }
  });

  // ── DM Messages ──
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.DM) return;

    const discordUserId = message.author.id;
    const text = message.content?.trim() || '';
    const parsedAttachments = [...message.attachments.values()].map(classifyAttachment);
    const hasContent = text || parsedAttachments.length > 0;

    if (!hasContent) return;

    // Stickers without text
    if (!text && message.stickers.size > 0 && parsedAttachments.length === 0) {
      return; // ignore sticker-only messages
    }

    console.log(LOG_PREFIX, 'DM received', {
      from: message.author.username,
      discordUserId,
      textPreview: text.slice(0, 80),
      attachments: parsedAttachments.length,
    });

    // Look up StuardAI user
    const userId = await findUserIdByDiscordId(discordUserId);

    if (!userId) {
      await message.reply(getNotLinkedMessage());
      return;
    }

    // Handle text slash commands (e.g. /help, /model fast)
    if (text.startsWith('/') && parsedAttachments.length === 0) {
      try {
        const handled = await handleSlashCommand(userId, text, message);
        if (handled) return;
      } catch (err: any) {
        console.error(LOG_PREFIX, 'Slash command error:', err?.message);
      }
    }

    // React with eyes to acknowledge receipt
    try { await message.react('\uD83D\uDC40'); } catch {} // 👀

    // Process message through agent
    try {
      startTyping(message.channel);

      const state = await getDiscordUserState(userId);
      if (!state.discord_user_id) {
        await upsertDiscordUserState({ userId, discordUserId });
      }

      const result = await processMessage(userId, discordUserId, text, parsedAttachments, state);

      stopTyping(message.channel.id);

      // Remove the eyes reaction, add checkmark
      try { await message.reactions.cache.get('\uD83D\uDC40')?.users.remove(client.user!.id); } catch {}

      await sendRichReply(message, result.text, { react: '\u2705' }); // ✅

      await deductDiscordCredit(userId);

    } catch (err: any) {
      stopTyping(message.channel.id);
      console.error(LOG_PREFIX, 'Message processing error:', err?.message || err);

      // Remove eyes, add error reaction
      try { await message.reactions.cache.get('\uD83D\uDC40')?.users.remove(client.user!.id); } catch {}
      try { await message.react('\u274C'); } catch {} // ❌

      try {
        await message.reply('Sorry, something went wrong processing your message. Please try again.');
      } catch {}
    }
  });

  // ── Reaction handling (user reacts to bot messages) ──
  client.on(Events.MessageReactionAdd, async (reaction: any, user: any) => {
    if (user.bot) return;

    // Fetch partial reactions
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }

    // Only handle DM reactions
    if (reaction.message.channel.type !== ChannelType.DM) return;

    const emoji = reaction.emoji.name;
    const discordUserId = user.id;

    // Thumbs down on bot message = negative feedback
    if (emoji === '\uD83D\uDC4E' && reaction.message.author?.id === client.user?.id) {
      console.log(LOG_PREFIX, 'Negative feedback received', { discordUserId, messageId: reaction.message.id });
      // Could log this feedback for quality tracking
    }

    // Thumbs up on bot message = positive feedback
    if (emoji === '\uD83D\uDC4D' && reaction.message.author?.id === client.user?.id) {
      console.log(LOG_PREFIX, 'Positive feedback received', { discordUserId, messageId: reaction.message.id });
    }
  });

  // ── Voice state changes (DM call detection) ──
  client.on(Events.VoiceStateUpdate, async (oldState: any, newState: any) => {
    try {
      const userId = newState.member?.user?.id || newState.id;
      if (!userId || userId === client.user?.id) return; // Ignore self

      const joinedChannel = !oldState.channelId && newState.channelId;
      const leftChannel = oldState.channelId && !newState.channelId;

      // User joined a DM voice channel → bridge to voice provider
      if (joinedChannel && newState.channel) {
        // Discord DM voice calls create a temporary voice channel in a private "guild".
        // Detect small voice channels (DM calls typically have 1-2 members).
        const memberCount = newState.channel.members?.size ?? 0;
        const isSmallVoice = memberCount <= 2;

        if (!isSmallVoice) return; // Only handle DM-style voice, not large guild channels

        const existing = getActiveDiscordCall(userId);
        if (existing) return; // Already in a call

        console.log(LOG_PREFIX, 'User joined DM voice', { userId, channelId: newState.channelId });

        const stuardUserId = await findUserIdByDiscordId(userId);
        if (!stuardUserId) {
          // Can't bridge without linked account — they'll need to link first
          return;
        }

        // Auto-join and bridge to voice provider
        await bridgeDiscordVoice({
          channelId: newState.channelId!,
          guildId: newState.guild?.id || newState.channelId!,
          discordUserId: userId,
          adapterCreator: newState.guild?.voiceAdapterCreator || client.guilds.cache.first()?.voiceAdapterCreator,
        });
      }

      // User left voice → disconnect bridge
      if (leftChannel) {
        const existing = getActiveDiscordCall(userId);
        if (existing) {
          console.log(LOG_PREFIX, 'User left DM voice', { userId });
          disconnectDiscordVoice(userId);
        }
      }
    } catch (err: any) {
      console.error(LOG_PREFIX, 'Voice state update error:', err?.message);
    }
  });

  // ── Error handling ──
  client.on(Events.Error, (err: Error) => {
    console.error(LOG_PREFIX, 'Client error:', err?.message || err);
  });

  // ── Login ──
  try {
    await client.login(DISCORD_BOT_TOKEN);
    botClient = client;
  } catch (err: any) {
    console.error(LOG_PREFIX, 'Failed to login:', err?.message || err);
    throw err;
  }
}

export async function stopDiscordBot(): Promise<void> {
  if (botClient) {
    console.log(LOG_PREFIX, 'Shutting down bot...');
    // Clear all typing intervals
    for (const [id] of activeTyping) {
      stopTyping(id);
    }
    botClient.destroy();
    botClient = null;
  }
}

// Re-export voice bridge functions for external use
export { bridgeDiscordVoice, disconnectDiscordVoice, getActiveDiscordCall } from './discord-voice-bridge';
