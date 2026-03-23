/**
 * Discord Bot Service — DM-based personal assistant (like SMS integration).
 *
 * Users DM the bot directly. The bot maps the Discord user ID → StuardAI user
 * (via external_accounts), processes the message through the agent, and sends
 * the reply back as a Discord DM.
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
  type Interaction,
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
} from '../supabase';
import { getAgentForQuery } from '../agents/stuard/index';
import { runWithSecrets } from '../tools/bridge';
import { getDefaultModelForCategory } from '../pricing';
import { buildProviderModel } from '../utils/models';
import { DISCORD_BOT_TOKEN, PUBLIC_BASE_URL, DISCORD_CLIENT_ID } from '../utils/config';
import { messagingCreditCost } from '../pricing';
import { getOrCreateQueryEmbedding } from '../utils/shared-embedding';
import { sendVMCommand } from './vm-command';
import { getCloudEngine } from '../supabase';
import type { ModelChoice } from '../router/model-router';

const LOG_PREFIX = '[discord-bot]';

// ── Typing indicator management ──────────────────────────────────────────────
const activeTyping = new Map<string, NodeJS.Timeout>();

function startTyping(channel: Message['channel']) {
  const id = channel.id;
  // Clear any existing interval for this channel
  stopTyping(id);
  // Send typing immediately, then every 8s (Discord typing lasts ~10s)
  channel.sendTyping().catch(() => {});
  const interval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 8000);
  activeTyping.set(id, interval);
}

function stopTyping(channelId: string) {
  const interval = activeTyping.get(channelId);
  if (interval) {
    clearInterval(interval);
    activeTyping.delete(channelId);
  }
}

// ── Message formatting ───────────────────────────────────────────────────────

/** Discord supports markdown natively, so we keep it mostly as-is. Just cap length. */
function formatForDiscord(text: string): string[] {
  const clean = text.trim();
  if (!clean) return ['I processed your request but had no text to send.'];

  // Discord max message length is 2000 chars. Split into chunks if needed.
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > 0) {
    if (remaining.length <= 2000) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf('\n', 2000);
    if (splitAt < 1000) splitAt = remaining.lastIndexOf(' ', 2000);
    if (splitAt < 1000) splitAt = 2000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ── Slash commands ───────────────────────────────────────────────────────────

const DISCORD_HELP_TEXT =
  '**Stuard AI — Discord DM Assistant**\n\n' +
  '💬 Just type a message to chat with your AI agent.\n\n' +
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
        `Conversation: ${state.conversation_id ? `Active (\`${state.conversation_id.slice(0, 8)}…\`)` : 'None'}`
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

async function processMessage(userId: string, discordUserId: string, text: string, state: Awaited<ReturnType<typeof getDiscordUserState>>): Promise<string> {
  const model = (state.preferred_model || 'balanced') as ModelChoice;

  // Check credits
  const access = await checkAccess(userId);
  if (!access.allowed) {
    return 'You\'ve reached your usage limit. Please upgrade your plan or wait for the next billing cycle.';
  }

  // Create or continue conversation
  let convId = state.conversation_id;
  if (!convId) {
    convId = await createConversation(userId, text, model, { mode: model }, 'stuard', true);
    await upsertDiscordUserState({ userId, discordUserId, conversationId: convId });
  } else {
    await addUserMessage(userId, convId, text, { mode: model }, true);
  }

  // Try VM agent first (if user has a running VM)
  const engine = await getCloudEngine(userId);
  const vmRunning = !!(engine && engine.status === 'running');

  if (vmRunning) {
    try {
      let queryEmbedding: number[] | undefined;
      try { queryEmbedding = await getOrCreateQueryEmbedding(text); } catch {}

      const vmResult = await sendVMCommand(userId, 'agent_chat', {
        message: text,
        conversationId: convId || undefined,
        model,
        context: { source: 'discord', discordUserId },
        memoryQuery: text,
        ...(queryEmbedding ? { queryEmbedding } : {}),
      }, 60_000);

      if (vmResult.ok && vmResult.result?.text) {
        const replyText = String(vmResult.result.text);
        // Store assistant reply
        const vmConvId = vmResult.result?.conversationId || convId;
        if (vmConvId) {
          await addAssistantMessage(userId, vmConvId, replyText, { mode: model }, true);
        }
        if (vmConvId && vmConvId !== state.conversation_id) {
          await upsertDiscordUserState({ userId, conversationId: vmConvId });
        }
        return replyText;
      }
    } catch (err: any) {
      console.warn(LOG_PREFIX, 'VM agent failed, falling back to direct:', err?.message);
    }
  }

  // Direct agent processing (no VM)
  try {
    const agent = await getAgentForQuery(model, text, 'medium', ['discord']);

    const messages = [{ role: 'user' as const, content: text }];

    const result = await runWithSecrets({ userId }, async () => {
      return (agent as any).generate(messages, { maxSteps: 10 });
    });

    const replyText = String(result?.text || result?.content || '').trim();
    if (!replyText) return 'I processed your request but couldn\'t generate a response. Please try again.';

    // Store assistant reply
    if (convId) {
      await addAssistantMessage(userId, convId, replyText, { mode: model }, true);
    }

    // Log usage
    try {
      await logUsageEvent(userId, convId, model, {
        ...(result?.usage || {}),
        sourceType: 'discord_dm',
      });
    } catch {}

    return replyText;
  } catch (err: any) {
    console.error(LOG_PREFIX, 'Agent processing failed:', err?.message || err);

    // Fallback: simple generateText without tools
    try {
      const modelId = getDefaultModelForCategory(model);
      const providerModel = buildProviderModel(modelId);
      const result = await generateText({
        model: providerModel as any,
        messages: [{ role: 'user' as const, content: text }],
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
      return replyText || 'Sorry, I couldn\'t generate a response.';
    } catch (fallbackErr: any) {
      console.error(LOG_PREFIX, 'Fallback generateText also failed:', fallbackErr?.message);
      return 'I\'m having trouble processing your request right now. Please try again later.';
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
  const connectUrl = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/integrations/discord/connect`
    : 'your Stuard dashboard → Settings → Integrations → Discord';
  return (
    '👋 Hi! I\'m **Stuard AI**, your personal assistant.\n\n' +
    'To get started, you need to link your Discord account to your Stuard account.\n\n' +
    `**Connect here:** Log in to your Stuard dashboard and connect Discord under Settings → Integrations.\n\n` +
    'Once connected, you can DM me anytime and I\'ll respond just like a text message!'
  );
}

// ── Register slash commands ──────────────────────────────────────────────────

async function registerSlashCommands() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) return;
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  const commands = [
    { name: 'model', description: 'Set AI model tier (fast, balanced, smart, research)', options: [{ name: 'tier', description: 'Model tier', type: 3, required: true, choices: [{ name: 'Fast', value: 'fast' }, { name: 'Balanced', value: 'balanced' }, { name: 'Smart', value: 'smart' }, { name: 'Research', value: 'research' }] }] },
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

// ── Interaction handler (slash commands via interaction API) ──────────────────

async function handleInteraction(interaction: Interaction) {
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
        content: `**Stuard DM Status**\nModel: **${state.preferred_model}**\nCloud VM: ${vmStatus}\nConversation: ${state.conversation_id ? `Active` : 'None'}`,
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

// ── Main bot startup ─────────────────────────────────────────────────────────

let botClient: Client | null = null;

export function getDiscordBotClient(): Client | null {
  return botClient;
}

export async function startDiscordBot(): Promise<void> {
  if (!DISCORD_BOT_TOKEN) {
    console.log(LOG_PREFIX, 'DISCORD_BOT_TOKEN not set, skipping bot startup');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.DirectMessageTyping,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.Channel, // Required for DM events
      Partials.Message,
    ],
  });

  // ── Ready ──
  client.once(Events.ClientReady, (c) => {
    console.log(LOG_PREFIX, `Bot online as ${c.user.tag} (${c.user.id})`);
    c.user.setActivity('DM me to chat!', { type: ActivityType.Custom });
    // Register slash commands after login
    registerSlashCommands().catch(() => {});
  });

  // ── Interaction (slash commands) ──
  client.on(Events.InteractionCreate, async (interaction) => {
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
    // Ignore bots (including self)
    if (message.author.bot) return;

    // Only handle DMs
    if (message.channel.type !== ChannelType.DM) return;

    const discordUserId = message.author.id;
    const text = message.content?.trim();

    // Ignore empty messages (e.g. sticker-only, image-only for now)
    if (!text) {
      // Handle attachments in the future
      if (message.attachments.size > 0) {
        await message.reply('I can see you sent an attachment. Text messages are supported for now — image/file support is coming soon!');
      }
      return;
    }

    console.log(LOG_PREFIX, 'DM received', {
      from: message.author.username,
      discordUserId,
      textPreview: text.slice(0, 80),
    });

    // Look up StuardAI user
    const userId = await findUserIdByDiscordId(discordUserId);

    if (!userId) {
      await message.reply(getNotLinkedMessage());
      return;
    }

    // Handle text slash commands (e.g. /help, /model fast)
    if (text.startsWith('/')) {
      try {
        const handled = await handleSlashCommand(userId, text, message);
        if (handled) return;
      } catch (err: any) {
        console.error(LOG_PREFIX, 'Slash command error:', err?.message);
      }
    }

    // Process message through agent
    try {
      startTyping(message.channel);

      const state = await getDiscordUserState(userId);
      // Store discord_user_id in state if not already set
      if (!state.discord_user_id) {
        await upsertDiscordUserState({ userId, discordUserId });
      }

      const replyText = await processMessage(userId, discordUserId, text, state);

      stopTyping(message.channel.id);

      // Send reply (split into chunks if >2000 chars)
      const chunks = formatForDiscord(replyText);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }

      // Deduct messaging credit
      await deductDiscordCredit(userId);

    } catch (err: any) {
      stopTyping(message.channel.id);
      console.error(LOG_PREFIX, 'Message processing error:', err?.message || err);
      try {
        await message.reply('Sorry, something went wrong processing your message. Please try again.');
      } catch {}
    }
  });

  // ── Error handling ──
  client.on(Events.Error, (err) => {
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
    botClient.destroy();
    botClient = null;
  }
}
