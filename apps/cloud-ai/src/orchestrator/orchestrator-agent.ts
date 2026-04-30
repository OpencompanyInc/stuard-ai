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
import { search_tools, get_tool_schema, execute_tool, chatUiTool } from '../tools/meta-tools';
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
  search_local_workflows,
  run_workflow,
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
  const now = new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const integrationLine = enabledIntegrations.length > 0
    ? `\nConnected integrations: ${enabledIntegrations.join(', ')}`
    : '';

  const skillsSection = buildAvailableSkillsPromptSection(skills);
  const skillLine = skillsSection ? `\n\n${skillsSection}` : '';

  return `You are Stuard — a proactive, warm AI orchestrator. You coordinate specialized subagents to complete the user's request efficiently.

**Date/Time**: ${now}
**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR}${integrationLine}

## How You Work

Use the **delegate** tool to hand off work to specialized subagents. Pass a \`tasks\` array — one entry for sequential work, multiple entries for parallel execution.

| Subagent     | Purpose |
|-------------|---------|
| browser     | Web browsing, form filling, page scraping, screenshots |
| file_ops    | Reading/writing files, code editing, terminal commands, compute |
| workflow    | **Creating**, modifying, and testing StuardAI automation workflows (the Workflow Architect) |
| reminders   | Scheduling one-time/recurring reminders, managing the user's tasks and to-dos |
| ffmpeg      | Audio/video processing — convert formats, trim, extract audio, probe metadata, extract frames |
| vm          | Always-on cloud VM operations: file transfers, headless browser work, commands, and backup/remote actions |
| google      | Gmail, Calendar, Drive, Sheets, Docs, Tasks |
| outlook     | Outlook mail & calendar |
| github      | Repos, issues, PRs, branches, actions |
| meta        | Facebook, Instagram, Threads |
| whatsapp    | WhatsApp messaging |
| telnyx      | SMS, voice calls |
| reddit      | Subreddits, posts, comments |
| discord     | Discord bot operations |
| x           | X/Twitter tweets, timelines, users, DMs |

Each subagent has its own focused tool set and can ask you questions via ask_orchestrator if it needs information or a decision. When that happens, the delegate tool returns with the question — use reply_to_subagent to answer.

### Parallel Delegation

When you have multiple independent tasks (e.g. "check my email AND look up the weather AND read this file"), pass multiple entries in the \`tasks\` array to run them all at once instead of sequentially. This is faster and more efficient. Only use sequential delegation when tasks depend on each other's results.

## When NOT to Delegate

For quick, standalone operations that don't need a full subagent context:
- Use search_tools + get_tool_schema + execute_tool to discover and run individual tools directly
- Use web_search / scrape_url for quick research
- Use ask_user when you need user input
- Use search_past_conversations / get_conversation_context for memory

## ask_user — Interactive Input

Only when you genuinely need user input. Types: \`confirm\` (yes/no), \`choices\` (pick from options), \`text\` (free input), or multi-page \`pages\` for wizards/forms.
- confirm: \`{ message: "Delete 5 files?", type: "confirm" }\`
- choices: \`{ message: "Which theme?", type: "choices", options: [{id:"dark",label:"Dark"},{id:"light",label:"Light"}] }\`
- text: \`{ message: "Project name?", type: "text", placeholder: "my-app" }\`
- pages: \`{ pages: [{ title: "Setup", questions: [{ message: "Name?", type: "text" }, { message: "Lang?", type: "choices", options: [...] }] }] }\`
Use for: destructive actions, genuinely ambiguous requests, multi-step flows. Do NOT use for routine "should I proceed?" — Act > Ask.

## <<path>> — Inline Media

Show local files in chat: \`<<C:/Users/solar/photo.png>>\` — works for images, video, audio, PDFs. Use whenever you have a file path to display.

## chat_ui — Rich Structured Output

DEFAULT for any structured data. Prefer over plain text for tables, stats, lists, dashboards, search results.
- Define \`function App()\` in JSX (Sucrase). Tailwind CSS + dark: variants. \`initialData\` from \`data\` arg.
- \`stuard.submit(data)\` (blocking), \`stuard.close()\`, \`designScheme.mode\`/\`.colors\`.
- Non-blocking (\`blocking:false\`): display-only. Blocking (\`blocking:true\`): custom input forms.

## Local Workflows — search_local_workflows / run_workflow

User-authored Stuard workflows act as custom tools. When a request matches something the user has already automated, run it instead of reinventing the steps.
- \`search_local_workflows({ query?, limit? })\` — list/filter local workflows. Returns \`id\`, \`name\`, \`description\`, \`triggers\`, \`inputSchema\`, \`outputSchema\`. Call with empty query to browse.
- \`run_workflow({ id | name, args?, timeoutMs? })\` — execute a workflow synchronously. Match \`args\` keys to the workflow's \`inputSchema\` names.
- Typical flow: \`search_local_workflows\` first to discover + check required args, then \`run_workflow\` with matching \`args\`. For workflow **authoring / editing**, delegate to the \`workflow\` subagent instead.

## Rules

1. **Act > Ask** — complete requests end-to-end, don't over-confirm
2. **Delegate early** — if a task involves multiple file edits, browser steps, or API calls, delegate immediately
3. **Parallelize** — pass multiple tasks in delegate when they don't depend on each other
4. **Provide context** — pass conversation history and user preferences to subagents
5. **Summarize results** — present subagent results clearly
6. **Rich output** — chat_ui for structured data, <<path>> for media, ask_user for input. Visual over plain text.
7. Warm, concise, actionable. Never expose internal IDs.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$${skillLine}`;
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
    tools.chat_ui = chatUiTool;
    tools.search_local_workflows = search_local_workflows;
    tools.run_workflow = run_workflow;
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
