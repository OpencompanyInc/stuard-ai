/**
 * Orchestrator Agent
 *
 * Thin top-level agent that only sees delegation tools + meta-tools + singleton
 * fallbacks. Does NOT receive the full 180+ tool universe, drastically cutting
 * token usage for most conversations.
 */

import { Agent } from '@mastra/core/agent';
import os from 'node:os';
import { getModel, getAgentName } from '../agents/stuard/models';
import { buildAvailableSkillsPromptSection, type SkillSummary } from '../tools/skill-tools';
import type { ModelChoice } from '../router/model-router';
import { ORCHESTRATOR_DELEGATION_TOOLS } from './delegation-tools';
import { wrapToolWithBridge } from './subagent-runtime';

// Re-use meta tools from the existing registry
import { search_tools, get_tool_schema, execute_tool } from '../tools/meta-tools';
import { ask_user } from '../tools/ask-user';
import { waitTool } from '../tools/wait';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url } from '../tools/tavily-tools';
import { analyzeMediaTool } from '../tools/analyze-media';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../tools/list-headless-agent-tasks';
import { stopHeadlessAgent } from '../tools/stop-headless-agent';
import { get_skill_info } from '../tools/skill-tools';
import {
  search_past_conversations,
  get_conversation_context,
  agent_todo,
  capture_screen,
} from '../tools/device-tools';
import { hasClientBridge, getBridgeWs, getBridgeSecrets } from '../tools/bridge';

// Resolved at startup via execution-tools-resolver to break the circular
// dependency: orchestrator-agent → stuard/tools → meta-tools → workflow-subagent → orchestrator.
import { resolveExecutionTools } from './execution-tools-resolver';
function getExecutionToolsLazy(mcpTools: Record<string, any> = {}): Record<string, any> {
  return resolveExecutionTools(mcpTools);
}

const DEFAULT_USER_HOME_DIR = (() => {
  const envHome = process.env.USERPROFILE || os.homedir();
  return envHome.replace(/\\/g, '/');
})();

function buildOrchestratorPrompt(enabledIntegrations: string[] = [], skills: SkillSummary[] = []): string {
  const integrationLine = enabledIntegrations.length > 0
    ? `\nConnected integrations: ${enabledIntegrations.join(', ')}`
    : '';

  const skillsSection = buildAvailableSkillsPromptSection(skills);
  const skillLine = skillsSection ? `\n\n${skillsSection}` : '';

  return `You are Stuard — a proactive, warm AI orchestrator. You coordinate specialized subagents to complete the user's request efficiently.

**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR}${integrationLine}

## How You Work

Use the **delegate** tool to hand off work to specialized subagents. Pass a \`tasks\` array — one entry for sequential work, multiple entries for parallel execution.

| Subagent     | Purpose |
|-------------|---------|
| browser     | Web browsing, form filling, page scraping, screenshots |
| file_ops    | Reading/writing files, code editing, terminal commands, compute |
| workflow    | Creating/modifying/testing StuardAI automation workflows |
| google      | Gmail, Calendar, Drive, Sheets, Docs, Tasks |
| outlook     | Outlook mail & calendar |
| github      | Repos, issues, PRs, branches, actions |
| meta        | Facebook, Instagram, Threads |
| whatsapp    | WhatsApp messaging |
| telnyx      | SMS, voice calls |
| reddit      | Subreddits, posts, comments |
| discord     | Discord bot operations |

Each subagent has its own focused tool set and can ask you questions via ask_orchestrator if it needs information or a decision. When that happens, the delegate tool returns with the question — use reply_to_subagent to answer.

### Parallel Delegation

When you have multiple independent tasks (e.g. "check my email AND look up the weather AND read this file"), pass multiple entries in the \`tasks\` array to run them all at once instead of sequentially. This is faster and more efficient. Only use sequential delegation when tasks depend on each other's results.

## When NOT to Delegate

For quick, standalone operations that don't need a full subagent context:
- Use search_tools + get_tool_schema + execute_tool to discover and run individual tools directly
- Use web_search / scrape_url for quick research
- Use ask_user when you need user input
- Use search_past_conversations / get_conversation_context for memory

## Rules

1. **Act > Ask** — complete requests end-to-end, don't over-confirm
2. **Delegate early** — if a task involves multiple file edits, browser steps, or API calls, delegate immediately
3. **Parallelize independent work** — pass multiple tasks in the delegate tool when they don't depend on each other
4. **Provide context** — pass relevant conversation history and user preferences to subagents
5. **Summarize results** — when a subagent returns, present the result clearly to the user
6. **ask_user** — only for destructive actions, ambiguous requests, or genuine need for clarification
7. Be warm, concise, actionable. Never expose internal IDs.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$
Show local media in chat with <<path>> syntax.${skillLine}`;
}

// ─── Orchestrator tool set ───────────────────────────────────────────────────

/**
 * The lean tool set the orchestrator LLM actually sees.
 * Much smaller than the full Stuard tool surface.
 */
function getOrchestratorActiveTools(mcpTools: Record<string, any> = {}): Record<string, any> {
  const tools: Record<string, any> = {
    // Delegation tools (the core of the orchestrator)
    ...ORCHESTRATOR_DELEGATION_TOOLS,

    // Meta-tools for singleton/fallback tool discovery
    search_tools,
    get_tool_schema,
    execute_tool,

    // User interaction
    ask_user,

    // Core utilities always needed
    wait: waitTool,
    web_search,
    scrape_url,
    analyze_media: analyzeMediaTool,

    // Memory
    search_past_conversations,
    get_conversation_context,

    // Task tracking
    agent_todo,

    // Vision
    capture_screen,

    // Background agents
    deploy_headless_agent: deployHeadlessAgent,
    get_headless_agent_status: getHeadlessAgentStatus,
    list_headless_agent_tasks: listHeadlessAgentTasks,
    stop_headless_agent: stopHeadlessAgent,

    // Skills
    get_skill_info,

    // MCP tools
    ...mcpTools,
  };

  // Desktop UI tools only when bridge is active
  if (hasClientBridge()) {
    try {
      const { chat_ui } = require('../tools/device-tools');
      if (chat_ui) tools.chat_ui = chat_ui;
    } catch { }
  }

  return tools;
}

// ─── Agent Factory ───────────────────────────────────────────────────────────

export function getOrchestratorAgent(
  model: ModelChoice,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  skills: SkillSummary[] = [],
): Agent {
  const activeTools = getOrchestratorActiveTools(mcpTools);
  // Full execution universe so meta-tools (execute_tool) still work
  const executionTools = { ...getExecutionToolsLazy(mcpTools), ...activeTools };
  const selectedModel = getModel(model, modelId);
  const name = getAgentName(model);

  // Capture bridge context NOW (while ALS is active) and wrap all tools so they
  // survive Mastra's agent.stream() breaking AsyncLocalStorage propagation.
  // Without this, the delegate tool loses bridge context and subagents can't
  // reach the desktop browser.
  const bridgeWs = getBridgeWs();
  const bridgeSecrets = getBridgeSecrets();
  if (bridgeWs) {
    for (const toolName of Object.keys(executionTools)) {
      executionTools[toolName] = wrapToolWithBridge(executionTools[toolName], bridgeWs, bridgeSecrets);
    }
  }

  const instructions = [
    {
      role: 'system',
      content: buildOrchestratorPrompt(enabledIntegrations, skills),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
  ];

  const agent = new Agent({
    id: `orchestrator-${name}`,
    name: `Orchestrator ${name}`,
    instructions: instructions as any,
    model: selectedModel as any,
    tools: executionTools,
  });

  (agent as any).__diagTools = activeTools;
  (agent as any).__diagInstructions = instructions;
  (agent as any).__activeToolNames = Object.keys(activeTools);
  return agent;
}
