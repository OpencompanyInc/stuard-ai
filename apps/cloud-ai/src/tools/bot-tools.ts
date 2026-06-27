import { z } from 'zod';
import { makeLocalTool } from './device/shared';

export const BOT_TOOL_NAMES = [
  'bot_list',
  'bot_get_status',
  'bot_create',
  'bot_deploy',
  'bot_pause',
  'bot_delete',
  'ask_bot',
  'bot_ask',
] as const;

export const AGENT_TOOL_NAMES = [
  'agent_list',
  'agent_get_status',
  'agent_create',
  'agent_deploy',
  'agent_pause',
  'agent_delete',
  'ask_agent',
  'agent_ask',
] as const;

const botIdentifierSchema = z.object({
  bot_id: z.string().optional().describe('Legacy bot id, for example bot_default or bot_... . Accepts bot://... too.'),
  agent_id: z.string().optional().describe('Agent id. Accepts agent://... and legacy bot://... ids too.'),
  name: z.string().optional().describe('Agent display name. Accepts a leading @, for example @Research.'),
});

const genericBotOutput = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
}).passthrough();

const scheduleSchema = z.object({
  kind: z.enum(['manual', 'interval', 'cron']).optional().describe('How the bot should wake up. Defaults to manual when omitted.'),
  every: z.enum(['10m', '15m', '30m', '1h', '2h', 'random', 'manual']).optional().describe('Interval for interval schedules.'),
  cron: z.string().optional().describe('Cron expression for cron schedules.'),
  tz: z.string().optional().describe('IANA timezone for cron schedules.'),
}).passthrough();

const botAskSchema = botIdentifierSchema.extend({
  question: z.string().optional().describe('The user question addressed to the bot.'),
  run_now: z.boolean().optional().default(false).describe('Start a manual wake-up for the bot in addition to returning its current status snapshot.'),
  task_limit: z.number().int().min(1).max(50).optional().default(12),
  wake_limit: z.number().int().min(1).max(20).optional().default(8),
  memory_limit: z.number().int().min(1).max(50).optional().default(20),
  pull_vm_memory: z.boolean().optional().default(true),
});

export const bot_list = makeLocalTool(
  'bot_list',
  'List proactive bots configured in the user\'s desktop app, including ids, names, status, triggers, and optional config.',
  z.object({
    include_paused: z.boolean().optional().default(true).describe('Include paused bots. Defaults to true.'),
    include_config: z.boolean().optional().default(false).describe('Include each bot\'s effective config.'),
  }),
  genericBotOutput,
  15000,
  { noFallback: true },
);

export const bot_get_status = makeLocalTool(
  'bot_get_status',
  'Get a bot status snapshot: status, triggers, config, active tasks, recent wakeups, and private bot memory. Use when the user asks for a bot status update.',
  botIdentifierSchema.extend({
    task_limit: z.number().int().min(1).max(50).optional().default(10),
    wake_limit: z.number().int().min(1).max(20).optional().default(5),
    memory_limit: z.number().int().min(1).max(50).optional().default(12),
    pull_vm_memory: z.boolean().optional().default(true).describe('Pull latest VM memory first when the bot is deployed to VM.'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const bot_create = makeLocalTool(
  'bot_create',
  'Create a proactive bot from normal chat. Use this when the user asks to make a bot/agent that can wake up later, monitor something, or be deployed.',
  z.object({
    name: z.string().min(1).describe('Bot display name.'),
    emoji: z.string().optional().describe('Short icon/emoji for display.'),
    system_prompt: z.string().optional().describe('Identity and objective for this bot.'),
    instructions: z.string().optional().describe('Initial focus or operating instructions.'),
    stored_facts: z.string().optional().describe('Persistent facts the bot should remember.'),
    schedule: scheduleSchema.optional().describe('Wake schedule. Omit for a manual-only bot.'),
    model_mode: z.enum(['auto', 'fast', 'balanced', 'smart']).optional().default('balanced'),
    model_id: z.string().optional(),
    allowed_tools: z.array(z.string()).optional(),
    notification_channels: z.array(z.string()).optional(),
    memory_enabled: z.boolean().optional().default(true),
    deploy: z.enum(['paused', 'local', 'vm', 'both']).optional().default('paused').describe('Where to start the bot after creating it. Use vm or both when the user says deploy to VM/cloud.'),
  }),
  genericBotOutput,
  45000,
  { noFallback: true },
);

export const bot_deploy = makeLocalTool(
  'bot_deploy',
  'Deploy/start an existing bot locally, on the VM, or both. Use when the user asks to deploy, start, or run a bot.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both']).optional().default('local'),
  }),
  genericBotOutput,
  45000,
  { noFallback: true },
);

export const bot_pause = makeLocalTool(
  'bot_pause',
  'Pause/stop an existing bot locally, on the VM, or both.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both', 'all']).optional().default('local'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const bot_delete = makeLocalTool(
  'bot_delete',
  'Delete an existing proactive bot. Use only after the user clearly asks to delete/remove it.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both', 'all']).optional().default('all'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const bot_ask = makeLocalTool(
  'bot_ask',
  'Ask an @mentioned bot for status/details by returning its current tasks, recent runs, and memory. Optionally trigger a manual run now.',
  botAskSchema,
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const agent_list = makeLocalTool(
  'agent_list',
  'List proactive agents configured in the user\'s desktop app, including ids, names, status, triggers, and optional config.',
  z.object({
    include_paused: z.boolean().optional().default(true).describe('Include paused agents. Defaults to true.'),
    include_config: z.boolean().optional().default(false).describe('Include each agent\'s effective config.'),
  }),
  genericBotOutput,
  15000,
  { noFallback: true },
);

export const agent_get_status = makeLocalTool(
  'agent_get_status',
  'Get an agent status snapshot: status, triggers, config, active tasks, recent wakeups, and private agent memory. Use when the user asks for an agent status update.',
  botIdentifierSchema.extend({
    task_limit: z.number().int().min(1).max(50).optional().default(10),
    wake_limit: z.number().int().min(1).max(20).optional().default(5),
    memory_limit: z.number().int().min(1).max(50).optional().default(12),
    pull_vm_memory: z.boolean().optional().default(true).describe('Pull latest VM memory first when the agent is deployed to VM.'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const agent_create = makeLocalTool(
  'agent_create',
  'Create a proactive agent from normal chat. Use this when the user asks to make an agent that can wake up later, monitor something, or be deployed.',
  z.object({
    name: z.string().min(1).describe('Agent display name.'),
    emoji: z.string().optional().describe('Short icon/emoji for display.'),
    system_prompt: z.string().optional().describe('Identity and objective for this agent.'),
    instructions: z.string().optional().describe('Initial focus or operating instructions.'),
    stored_facts: z.string().optional().describe('Persistent facts the agent should remember.'),
    schedule: scheduleSchema.optional().describe('Wake schedule. Omit for a manual-only agent.'),
    model_mode: z.enum(['auto', 'fast', 'balanced', 'smart']).optional().default('balanced'),
    model_id: z.string().optional(),
    allowed_tools: z.array(z.string()).optional(),
    notification_channels: z.array(z.string()).optional(),
    memory_enabled: z.boolean().optional().default(true),
    deploy: z.enum(['paused', 'local', 'vm', 'both']).optional().default('paused').describe('Where to start the agent after creating it. Use vm or both when the user says deploy to VM/cloud.'),
  }),
  genericBotOutput,
  45000,
  { noFallback: true },
);

export const agent_deploy = makeLocalTool(
  'agent_deploy',
  'Deploy/start an existing agent locally, on the VM, or both. Use when the user asks to deploy, start, or run an agent.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both']).optional().default('local'),
  }),
  genericBotOutput,
  45000,
  { noFallback: true },
);

export const agent_pause = makeLocalTool(
  'agent_pause',
  'Pause/stop an existing agent locally, on the VM, or both.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both', 'all']).optional().default('local'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const agent_delete = makeLocalTool(
  'agent_delete',
  'Delete an existing proactive agent. Use only after the user clearly asks to delete/remove it.',
  botIdentifierSchema.extend({
    target: z.enum(['local', 'vm', 'both', 'all']).optional().default('all'),
  }),
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const agent_ask = makeLocalTool(
  'agent_ask',
  'Ask an @mentioned agent for status/details by returning its current tasks, recent runs, and memory. Optionally trigger a manual run now.',
  botAskSchema,
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const ask_agent = makeLocalTool(
  'ask_agent',
  'Ask a configured agent by id or name for status/details by returning its current tasks, recent runs, and memory. Optionally trigger a manual run now.',
  botAskSchema,
  genericBotOutput,
  30000,
  { noFallback: true },
);

export const ask_bot = makeLocalTool(
  'ask_bot',
  'Ask a configured bot by id or name for status/details by returning its current tasks, recent runs, and memory. Optionally trigger a manual run now.',
  botAskSchema,
  genericBotOutput,
  30000,
  { noFallback: true },
);
