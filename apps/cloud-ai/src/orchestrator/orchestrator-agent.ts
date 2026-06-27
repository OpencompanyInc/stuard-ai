/**
 * Orchestrator Agent
 *
 * Thin top-level agent that only sees delegation tools + meta-tools + singleton
 * fallbacks. Does NOT receive the full 180+ tool universe, drastically cutting
 * token usage for most conversations.
 */

import { Agent } from "@mastra/core/agent";
import os from "node:os";
import {
  getModel,
  getModelForUser,
  getAgentName,
} from "../agents/stuard/models";
import type { ModelSourcePreference } from "../utils/models";
import {
  buildAvailableSkillsPromptSection,
  type SkillSummary,
} from "../tools/skill-tools";
import {
  buildConversationBlock,
  buildProjectContextBlock,
  buildProjectModeSystemPrompt,
  buildOrchestratorToolDatabaseSection,
  PROJECT_MODE_GUIDANCE,
  type ProjectContextPayload,
  type JournalEntryPayload,
  type ProjectRetrievedContextPayload,
} from "../agents/stuard/prompts";
import {
  buildResearchModeSystemPrompt,
  RESEARCH_MODE_GUIDANCE,
} from "../agents/stuard/research-prompts";
import {
  RESEARCH_MODE_TOOLS,
  type ResearchSessionView,
} from "../tools/research-mode";
import type { ModelChoice } from "../router/model-router";
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from "../../../../shared/integration-flags";
import { ORCHESTRATOR_DELEGATION_TOOLS } from "./delegation-tools";
import { wrapToolWithBridge } from "./subagent-runtime";

// Re-use meta tools from the existing registry
import {
  search_tools,
  get_tool_schema,
  execute_tool,
  chatUiTool,
} from "../tools/meta-tools";
import {
  list_projects,
  create_project,
  update_project,
  delete_project,
  enter_project_mode,
  exit_project_mode,
  journal_add,
  memory_add,
  project_search,
  search_project_conversations,
  pin_file,
  add_project_context,
  unpin_file,
} from "../tools/device/projects";
import { task_crud, task_reminders } from "../tools/device/productivity";
import { ask_user } from "../tools/ask-user";
import { waitTool } from "../tools/wait";
import { runSequentialTool, runParallelTool } from "../tools/workflow-system";
import { web_search } from "../tools/perplexity-tools";
import { scrape_url } from "../tools/tavily-tools";
import { analyzeMediaTool } from "../tools/analyze-media";
import { get_skill_info } from "../tools/skill-tools";
import {
  search_past_conversations,
  get_conversation_context,
  agent_todo,
  search_local_workflows,
  run_workflow,
  create_knowledge_pack,
  list_knowledge_packs,
  query_knowledge_pack,
  start_live_session,
} from "../tools/device-tools";
// Mobile/phone-mode media-send tools — lifted inline when the turn originates
// from a phone (SMS/MMS/WhatsApp) so the orchestrator can reply with a voice
// note or image without the search_tools discovery dance.
import { telnyx_send_voice_note, telnyx_send_mms } from "../tools/telnyx-tools";
import {
  whatsapp_send_voice_note,
  whatsapp_send_media,
} from "../tools/whatsapp-tools";
import {
  hasClientBridge,
  getBridgeWs,
  getBridgeSecrets,
} from "../tools/bridge";
import {
  createVariablesTool,
  wrapToolWithVariables,
  conversationKeyFromSecrets,
} from "../tools/chat-variables";

// Resolved at startup via execution-tools-resolver to break the circular
// dependency: orchestrator-agent → stuard/tools → meta-tools → workflow-subagent → orchestrator.
import { resolveExecutionTools } from "./execution-tools-resolver";
function getExecutionToolsLazy(
  mcpTools: Record<string, any> = {},
): Record<string, any> {
  return resolveExecutionTools(mcpTools);
}

const DEFAULT_USER_HOME_DIR = (() => {
  const envHome = process.env.USERPROFILE || os.homedir();
  return envHome.replace(/\\/g, "/");
})();

const DELEGATED_AGENT_TOOL_NAMES = new Set([
  "bot_list",
  "agent_list",
  "ask_bot",
  "ask_agent",
  "bot_ask",
  "agent_ask",
  "bot_get_status",
  "agent_get_status",
]);

// Research tools split: `enter_research_mode` is the always-visible "door"; the
// rest of the gather/compile loop is gated to an active research session. On the
// turn that enters research mode there's no session yet, so the loop is re-armed
// mid-turn via prepareStep (see __rearmOnResearch + stream-runner). On later
// turns the session is known at turn start, so they're surfaced natively.
const { enter_research_mode: ENTER_RESEARCH_MODE, ...RESEARCH_SESSION_TOOLS } =
  RESEARCH_MODE_TOOLS;
const RESEARCH_SESSION_TOOL_NAMES = Object.keys(RESEARCH_SESSION_TOOLS);

function withoutDelegatedAgentTools(
  tools: Record<string, any>,
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([name]) => !DELEGATED_AGENT_TOOL_NAMES.has(name),
    ),
  );
}

export interface BotPromptSummary {
  id?: string;
  name?: string;
  kind?: "bot" | "agent";
  status?: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  vmDeployedAt?: string | null;
}

function formatAgentRosterSection(agents: BotPromptSummary[] = []): string {
  const lines = agents
    .map((entry) => {
      const name = String(entry?.name || "").trim();
      const id = String(entry?.id || "").trim();
      if (!name && !id) return "";
      const kind = entry?.kind === "agent" ? "agent" : "bot";
      const details = [
        `type=${kind}`,
        id ? `id=${id}` : "",
        entry?.status ? `status=${entry.status}` : "",
        entry?.lastRunAt ? `lastRunAt=${entry.lastRunAt}` : "",
        entry?.nextRunAt ? `nextRunAt=${entry.nextRunAt}` : "",
        entry?.vmDeployedAt ? "vm=deployed" : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `- @${name || id}${details ? ` (${details})` : ""}`;
    })
    .filter(Boolean);

  const roster =
    lines.length > 0
      ? `\n\nKnown configured agents/bots from context (use these ids when delegating):\n${lines.join("\n")}`
      : "";

  return `\n\n## Configured Agents - Delegated Status / Ask

The top-level orchestrator does not call ask_bot/ask_agent or list bots directly.
- To ask a configured agent or get its status/details, call \`delegate\` with subagent \`agent\` and pass \`agent_id\` or \`agent_name\`.
- For legacy bot entries, call \`delegate\` with subagent \`bot\` and pass \`bot_id\` or \`bot_name\`.
- To create, deploy, pause, or wake a proactive agent/bot, delegate that workflow to \`agent\` or \`bot\`.
- If no matching id/name is present in the roster or user context, ask the user which agent they mean instead of calling a list tool.${roster}`;
}

export interface OrchestratorPromptOptions {
  conversationId?: string | null;
  activeProject?: ProjectContextPayload | null;
  recentJournal?: JournalEntryPayload[];
  retrievedContext?: ProjectRetrievedContextPayload | null;
  /** Active deep-research session — takes over the prompt like Project Mode. */
  activeResearch?: ResearchSessionView | null;
  /** Live client bridge (desktop/VM) at request time — gates the browser-fallback guidance in Research Mode. */
  browserConnected?: boolean;
  /** Compact Tab quick send: plain Q&A, no tools or delegation. */
  quickResponse?: boolean;
  /**
   * Mobile-origin turn (SMS/MMS/WhatsApp). When set, the orchestrator's plain-
   * text reply is auto-delivered to the phone as it streams, and the matching
   * media-send tools (voice note / image+file) are lifted into the native tool
   * set so the AI can reply with media directly.
   */
  mobileMessaging?: { provider: "telnyx" | "whatsapp" } | null;
}

function buildMobileMessagingSection(mobile: {
  provider: "telnyx" | "whatsapp";
}): string {
  const isWa = mobile.provider === "whatsapp";
  const channel = isWa ? "WhatsApp" : "SMS/MMS";
  const voiceTool = isWa
    ? "whatsapp_send_voice_note"
    : "telnyx_send_voice_note";
  const mediaTool = isWa ? "whatsapp_send_media" : "telnyx_send_mms";
  const urlArg = isWa ? "a public URL" : "a public `media_url`";
  return `

## You're texting (${channel} mode)

The user is messaging you from their phone. **Your plain-text reply is delivered to them automatically** — never call a send-text tool for a normal reply, that double-sends. Just answer in plain text (no markdown, no headers, no bullet syntax).

To send **rich media** back to their phone you have these tools natively (no discovery needed):
- \`${voiceTool}\` — reply with a spoken **voice note**. Great for longer, warmer, or hands-free answers.
- \`${mediaTool}\` — send an **image, audio clip, or file** (a photo, a generated image, a chart/screenshot you produced, etc.). Pass a local file \`path\`, ${urlArg}, or base64 \`data\`.

Any media the user sent you was downloaded to this device and its local path is included with the message — re-open it with \`read_file\` / \`analyze_media\`, or send it back with \`${mediaTool}\` { path }. Only send media when it genuinely helps or the user asked for it.`;
}

function buildQuickResponsePrompt(): string {
  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `You are Stuard — a helpful assistant in **quick-response mode**.

**Date/Time**: ${now}

Answer the user's question directly in plain text. Be concise and accurate.
You have **no tools** in this mode — do not attempt tool calls, delegation, subagents, or multi-step plans.
If the request requires actions on the user's device, browsing, files, or integrations, say so briefly and suggest they use full mode (Enter) instead.`;
}

export function buildOrchestratorPrompt(
  enabledIntegrations: string[] = [],
  skills: SkillSummary[] = [],
  bots: BotPromptSummary[] = [],
  promptOptions: OrchestratorPromptOptions = {},
): string {
  // Research Mode wins over everything: the user explicitly entered a deep-
  // research engagement, and its discipline (distill-don't-dump, source
  // registry, compile step) breaks if the generic voice bleeds through.
  if (promptOptions.activeResearch) {
    return buildResearchModeSystemPrompt(promptOptions.activeResearch, {
      conversationId: promptOptions.conversationId,
      enabledIntegrations,
      homeDir: DEFAULT_USER_HOME_DIR,
      browserConnected: promptOptions.browserConnected,
    });
  }

  // When Project Mode is active, fully take over the system prompt with a
  // research-lab persona that knows the project's native tool surface and
  // disciplines (journal types, memory, scoped search). The generic orchestrator
  // voice would otherwise bleed through.
  if (promptOptions.activeProject) {
    return buildProjectModeSystemPrompt(promptOptions.activeProject, {
      conversationId: promptOptions.conversationId,
      recentJournal: promptOptions.recentJournal,
      retrievedContext: promptOptions.retrievedContext,
      enabledIntegrations,
      skills,
      bots: bots.map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        status: b.status,
      })),
      homeDir: DEFAULT_USER_HOME_DIR,
    });
  }

  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const integrationLine =
    enabledIntegrations.length > 0
      ? `\nConnected integrations: ${enabledIntegrations.join(", ")}`
      : "";

  const skillsSection = buildAvailableSkillsPromptSection(skills);
  const skillLine = skillsSection ? `\n\n${skillsSection}` : "";
  const botSection = formatAgentRosterSection(bots);

  const conversationBlock = buildConversationBlock(
    promptOptions.conversationId,
  );
  const projectBlock = "";
  const projectModeIntroLine = "";
  const toolDatabaseSection = buildOrchestratorToolDatabaseSection();
  const mobileSection = promptOptions.mobileMessaging
    ? buildMobileMessagingSection(promptOptions.mobileMessaging)
    : "";

  return `You are Stuard — a proactive, warm AI orchestrator. You coordinate specialized subagents to complete the user's request efficiently.

**Date/Time**: ${now}
**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR}${integrationLine}${conversationBlock}${projectBlock}${projectModeIntroLine}${mobileSection}

## How You Work

Use the **delegate** tool to hand off work to specialized subagents. Pass a \`tasks\` array — one entry for sequential work, multiple entries for parallel execution.

| Subagent     | Purpose |
|-------------|---------|
| browser     | Web browsing, form filling, page scraping, screenshots |
| file_ops    | Reading/writing files, code editing, terminal commands, compute |
| cli_agent   | Drive installed coding-agent CLIs (Codex, Cursor Agent, Antigravity, Claude Code) for codebase Q&A and agentic coding tasks — runs interactively so it uses the user's own subscription |
| workflow    | **Creating**, modifying, and testing StuardAI automation workflows (the Workflow Architect) |
| integration_builder | **Building** a custom integration/tool for an API you don't already have: researches the API, authors + deploys a manifest, then calls it. Use when the user needs to connect a service Stuard has no built-in tool for. |
| skills      | **Recording** a reusable skill from work that needs repeating — captures the successful steps + tools so the assistant doesn't have to be re-taught. Use when the user says "remember how to do this" / "save this as a skill". |
| reminders   | Scheduling one-time/recurring reminders, managing the user's tasks and to-dos |
| ffmpeg      | Media processing — convert formats, trim, extract audio, probe metadata, extract frames |
| data_analysis | Charts & data — load CSV/XLSX/JSON, summarize, correlate, and render charts |
| vm          | Always-on cloud VM operations: file transfers, headless browser work, commands, and backup/remote actions |
| agent       | Proactive agent status/ask workflows, including agent ids/names and manual wake-ups |
| bot         | Legacy proactive bot status/ask workflows, including bot ids/names and manual wake-ups |
| custom      | An ad-hoc subagent you define on the fly. Pass \`tools\` (exact tool names it may use) and \`system_prompt\` (its role/instructions) alongside \`instruction\`. Use when no built-in subagent fits the job. |
| google      | Gmail, Calendar, Drive, Sheets, Docs, Tasks |
${OUTLOOK_INTEGRATION_ENABLED ? "| outlook     | Outlook mail & calendar |\n" : ""}| github      | Repos, issues, PRs, branches, actions |
${META_INTEGRATION_ENABLED ? "| meta        | Facebook, Instagram, Threads |\n" : ""}${WHATSAPP_INTEGRATION_ENABLED ? "| whatsapp    | WhatsApp messaging |\n" : ""}| telnyx      | SMS, voice calls |
${REDDIT_INTEGRATION_ENABLED ? "| reddit      | Subreddits, posts, comments |\n" : ""}${DISCORD_INTEGRATION_ENABLED ? "| discord     | Discord bot operations |\n" : ""}| x           | X/Twitter tweets, timelines, users, DMs |
| notion      | Notion pages, databases, blocks, comments — search, read, create, update |

Each subagent can call **ask_orchestrator** when it needs information or a decision. When that happens, **delegate** returns early with the question and a **questionId**.

### Subagent Questions (ask_orchestrator)

When delegate pauses with a subagent question:
1. Read the question (and any choices) from the delegate result.
2. If you already have the answer from conversation context, your own tools, or a safe default — call **reply_to_subagent** with that answer and the **questionId**.
3. If the subagent needs something only the **user** can provide (credentials, confirmation, preference, ambiguous choice) — call **ask_user** first. Map subagent \`choices\` to ask_user \`options\` (\`{id, label}\`) when present; use \`confirm\` for yes/no, \`text\` for free-form.
4. Pass the user's answer (or a concise summary) to **reply_to_subagent** with the same **questionId**. Never invent user answers.
5. If ask_user is dismissed or fails, still **reply_to_subagent** with that outcome so the subagent can adapt.

**Never end your turn while a subagent is awaiting a reply.** Any delegate/reply_to_subagent result with \`awaitingReply: true\` means a subagent is BLOCKED and cannot finish until you respond. Resolve every such question (via reply_to_subagent, after ask_user if a person must decide) before you write your final answer. An unanswered subagent hangs forever — treat a dangling \`questionId\` as unfinished work, not a completed step.

### Parallel Delegation

When you have multiple independent tasks (e.g. "check my email AND look up the weather AND read this file"), pass them as **multiple entries in ONE \`delegate\` call's \`tasks\` array** — never as several separate \`delegate\` calls. One call runs them in parallel AND coordinates them: it surfaces their \`ask_orchestrator\` questions one at a time (answer each with reply_to_subagent) and only reports the batch complete once **every** task has returned control. Only use sequential delegation when tasks depend on each other's results.

## When NOT to Delegate

For quick, standalone operations that don't need a full subagent context:
- Use \`run_sequential\` / \`run_parallel\` to batch multiple direct tool calls (see below)
- Use \`search_tools\` + \`get_tool_schema\` + \`execute_tool\` to discover and run tools from the database (pick category first — see below)
- Use \`web_search\` / \`scrape_url\` for quick online research (facts/news/policies — not as a substitute for finding nearby places)
- Use \`ask_user\` when you need user input
- Use \`search_past_conversations\` / \`get_conversation_context\` for memory

${toolDatabaseSection}

## Tool Batching — run_sequential / run_parallel

Batch several **direct tool calls** without a subagent (each step \`{ tool, args, kind? }\`, kind = auto|cloud|local). \`run_sequential\` stops on first error unless \`continueOnError\`; \`run_parallel\` runs independent steps concurrently. Use for predictable chains; for open-ended reasoning (browser, code edits, workflow authoring), delegate instead.

## ask_user — Interactive Input

Use when **you** need user input, or when a subagent question requires the user's decision/credentials/confirmation (ask_user first, then reply_to_subagent). Types: \`confirm\` (yes/no), \`choices\` (\`options: [{id,label}]\`), \`text\` (free input), or multi-page \`pages\` for wizards/forms. Use for destructive actions, genuinely ambiguous requests, or multi-step flows — NOT for routine "should I proceed?" (Act > Ask).

## <<path>> — Inline Media

Show local files in chat: \`<<C:/Users/solar/photo.png>>\` — works for images, video, audio, PDFs. Also works with https media URLs (e.g. from cloud_storage_upload / cloud_storage_get_url): \`<<https://…/video.mp4>>\`. Use whenever you have a file path or media URL to display.

## Large values — pass {{var:…}} handles, never raw bytes

Big payloads (base64 media, long documents, fat API responses) must NOT sit in your messages — they balloon context and re-send every step. Large tool outputs are auto-stored and returned as \`{ _ref: "{{var:NAME}}" }\` — reuse that handle string directly as the next tool's argument (it's rehydrated right before that tool runs). Use the \`variables\` tool to set/list/delete deliberately; prefer passing handles over \`get\`.

## chat_ui — Rich Output

DEFAULT for structured data (tables, stats, lists, dashboards, search results) — prefer it over plain text. The chat_ui tool description carries the authoring API and theming rules.

## Local Workflows — search_local_workflows / run_workflow

The user's saved Stuard workflows act as custom tools — when a request matches one they've automated, \`search_local_workflows\` to find it (and check its \`inputSchema\`), then \`run_workflow\` with matching \`args\`, instead of reinventing the steps. For workflow **authoring / editing**, delegate to the \`workflow\` subagent instead.

## Document context

When the user wants to study, quiz on, prep for an interview from, or repeatedly ask about a set of documents outside Project Mode, use the document-context tools: \`create_knowledge_pack\` ingests sources (inline text or local files — PDFs/DOCX/XLSX included) and returns an internal id; \`query_knowledge_pack\` retrieves relevant passages to ground answers/questions. Do not mention "RAG", "packs", or internal ids unless the user explicitly asks how it works — present it as Stuard using their documents.

For a **spoken** session (quiz me out loud, mock interview, voice tutoring), call \`start_live_session\` with the relevant document context ids. It opens the voice pill and the live assistant can retrieve passages from those documents. The conversation then continues live by voice, not in chat — don't keep waiting on the tool. When that session ends, its summary and feedback come back to you as a follow-up message (prefixed \`[Live voice session ended]\`); relay that wrap-up to the user and save anything worth remembering.

## Skills — when to delegate to \`skills\`

Proactively delegate to the **skills** subagent (passing the relevant steps/tools) when you finished a clearly repeatable multi-step procedure, when the user **had to correct or guide you** (capture the golden path), or when they say "remember/save this." Don't bank one-off tasks, pure Q&A, or casual chat. When unsure, briefly offer rather than saving silently.

${PROJECT_MODE_GUIDANCE}

${RESEARCH_MODE_GUIDANCE}
${botSection}

## Rules

1. **Act > Ask** — complete requests end-to-end, don't over-confirm
2. **Database first** — specialized capabilities (Maps, device control, integrations, etc.) live in the tool database; pick the category and search before browser, web_search, or "I can't do that"
3. **Delegate early** — if a task involves multiple file edits, browser steps, or API calls, delegate immediately
4. **Parallelize** — pass multiple tasks in delegate when they don't depend on each other
5. **Provide context** — pass conversation history and user preferences to subagents
6. **Summarize results** — present subagent results clearly
7. **Subagent questions** — ask_user when the user must decide; reply_to_subagent to unblock the subagent. Never finish a turn with a question still awaitingReply
8. **Rich output** — chat_ui for structured data, <<path>> for media, ask_user for input. Visual over plain text.
9. Warm, concise, actionable. Never expose internal IDs.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$${skillLine}`;
}

// ─── Orchestrator tool set ───────────────────────────────────────────────────

/**
 * The lean tool set the orchestrator LLM actually sees.
 * Much smaller than the full Stuard tool surface.
 */
function getOrchestratorActiveTools(
  mcpTools: Record<string, any> = {},
  promptOptions: OrchestratorPromptOptions = {},
): Record<string, any> {
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
    run_sequential: runSequentialTool,
    run_parallel: runParallelTool,
    web_search,
    scrape_url,
    analyze_media: analyzeMediaTool,

    // Chat variables — store/recall large payloads by reference so base64 and
    // other blobs never sit in the model context. Bound to this conversation so
    // it resolves the right store even if ALS propagation is broken downstream.
    variables: createVariablesTool(conversationKeyFromSecrets()),

    // Memory
    search_past_conversations,
    get_conversation_context,

    // Task tracking
    agent_todo,

    // Research Mode — cloud-side (no bridge needed), so it works from desktop,
    // website, and VM chat alike. Only the entry "door" is always visible; the
    // gather/compile loop is gated to an active session (re-armed mid-turn via
    // prepareStep on the entry turn) to keep the default prompt lean.
    enter_research_mode: ENTER_RESEARCH_MODE,
    ...(promptOptions.activeResearch ? RESEARCH_SESSION_TOOLS : {}),

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
    // Document context tools. Native so the AI can prepare/query user documents
    // without the search_tools discovery dance.
    tools.create_knowledge_pack = create_knowledge_pack;
    tools.list_knowledge_packs = list_knowledge_packs;
    tools.query_knowledge_pack = query_knowledge_pack;
    tools.start_live_session = start_live_session;
    // Project Mode entry points — always native so the AI can discover / create /
    // enter a project from a cold start without the search_tools discovery dance.
    tools.list_projects = list_projects;
    tools.create_project = create_project;
    tools.enter_project_mode = enter_project_mode;

    // When Project Mode is **active**, surface the rest of the project tool
    // surface (edit/journal/memory/pin/scoped search) plus task management
    // natively. These all operate on the *active* project, so they're dead
    // weight on a cold "hey" and only meaningful once a project is entered —
    // entering flips activeProject (read at turn start), so the next turn loads
    // them. Mirrors the research-mode gating above.
    if (promptOptions.activeProject) {
      tools.update_project = update_project;
      tools.delete_project = delete_project;
      tools.exit_project_mode = exit_project_mode;
      tools.journal_add = journal_add;
      tools.memory_add = memory_add;
      tools.project_search = project_search;
      tools.pin_file = pin_file;
      tools.add_project_context = add_project_context;
      tools.unpin_file = unpin_file;
      tools.task_crud = task_crud;
      tools.task_reminders = task_reminders;
      tools.search_project_conversations = search_project_conversations;
    }
  }

  // Phone mode: lift the media-send tools inline so the AI can reply with a
  // voice note or an image/file directly. Plain text already auto-delivers as a
  // message, so the send-*text* tools are deliberately left out (using them
  // would double-send). These don't require the bridge — voice notes are
  // generated server-side and media can be sent from a path, URL, or base64.
  if (promptOptions.mobileMessaging) {
    if (
      promptOptions.mobileMessaging.provider === "whatsapp" &&
      WHATSAPP_INTEGRATION_ENABLED
    ) {
      tools.whatsapp_send_voice_note = whatsapp_send_voice_note;
      tools.whatsapp_send_media = whatsapp_send_media;
    } else {
      tools.telnyx_send_voice_note = telnyx_send_voice_note;
      tools.telnyx_send_mms = telnyx_send_mms;
    }
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
  bots: BotPromptSummary[] = [],
  promptOptions: OrchestratorPromptOptions = {},
): Agent {
  const activeTools = getOrchestratorActiveTools(mcpTools, promptOptions);
  // Full execution universe so meta-tools (execute_tool) still work
  const executionTools = withoutDelegatedAgentTools({
    ...getExecutionToolsLazy(mcpTools),
    ...activeTools,
  });
  // The orchestrator's OWN registry must hold the full research tool set so
  // prepareStep can re-arm the gather/compile loop mid-turn (the entry turn has
  // no active session yet, so getOrchestratorActiveTools only exposed the door).
  // getExecutionTools deliberately omits enter/exit/compile/report to keep them
  // out of parallel sub-researchers, so add them on the orchestrator here.
  Object.assign(executionTools, RESEARCH_MODE_TOOLS);
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
      executionTools[toolName] = wrapToolWithBridge(
        executionTools[toolName],
        bridgeWs,
        bridgeSecrets,
      );
    }
  }
  // Variable layer — OUTERMOST wrap (after bridge): rehydrate {{var:…}} handles
  // in tool args and capture oversized outputs to reusable handles. Applied
  // regardless of bridge so cloud-only chats benefit too.
  {
    const convKey = conversationKeyFromSecrets(bridgeSecrets);
    for (const toolName of Object.keys(executionTools)) {
      executionTools[toolName] = wrapToolWithVariables(
        executionTools[toolName],
        convKey,
      );
    }
  }

  const instructions = [
    {
      role: "system",
      content: buildOrchestratorPrompt(
        enabledIntegrations,
        skills,
        bots,
        promptOptions,
      ),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
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
  (agent as any).__executionToolNames = Object.keys(executionTools);
  // Mid-turn re-arm hint for stream-runner's prepareStep: when a research session
  // exists for this conversation (created same-turn by enter_research_mode), flip
  // the gather/compile loop on for the remaining steps. Pure in-memory check —
  // no desktop round-trip, no context refetch.
  (agent as any).__rearmOnResearch = {
    conversationId: promptOptions.conversationId || null,
    toolNames: RESEARCH_SESSION_TOOL_NAMES,
  };
  (agent as any).__modelSource = (selectedModel as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!((selectedModel as any)?.__stuardBillingExcluded);
  return agent;
}

export async function getOrchestratorAgentForUser(
  model: ModelChoice,
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  modelId?: string,
  skills: SkillSummary[] = [],
  bots: BotPromptSummary[] = [],
  userId?: string | null,
  modelSource?: ModelSourcePreference | string | null,
  promptOptions: OrchestratorPromptOptions = {},
): Promise<Agent> {
  const selectedModel = await getModelForUser(
    model,
    modelId,
    userId,
    modelSource,
  );
  const name = getAgentName(model);

  if (promptOptions.quickResponse) {
    const instructions = [
      {
        role: "system",
        content: buildQuickResponsePrompt(),
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
    ];

    const agent = new Agent({
      id: `orchestrator-${name}-quick`,
      name: `Orchestrator ${name} (quick)`,
      instructions: instructions as any,
      model: selectedModel as any,
      tools: {},
    });

    (agent as any).__diagTools = {};
    (agent as any).__diagInstructions = instructions;
    (agent as any).__activeToolNames = undefined;
    (agent as any).__executionToolNames = [];
    (agent as any).__modelSource = (
      selectedModel as any
    )?.__stuardResolvedSource;
    (agent as any).__billingExcluded = !!((selectedModel as any)?.__stuardBillingExcluded);
    return agent;
  }

  const activeTools = getOrchestratorActiveTools(mcpTools, promptOptions);
  const executionTools = withoutDelegatedAgentTools({
    ...getExecutionToolsLazy(mcpTools),
    ...activeTools,
  });
  // The orchestrator's OWN registry must hold the full research tool set so
  // prepareStep can re-arm the gather/compile loop mid-turn (the entry turn has
  // no active session yet, so getOrchestratorActiveTools only exposed the door).
  // getExecutionTools deliberately omits enter/exit/compile/report to keep them
  // out of parallel sub-researchers, so add them on the orchestrator here.
  Object.assign(executionTools, RESEARCH_MODE_TOOLS);

  const bridgeWs = getBridgeWs();
  const bridgeSecrets = getBridgeSecrets();
  if (bridgeWs) {
    for (const toolName of Object.keys(executionTools)) {
      executionTools[toolName] = wrapToolWithBridge(
        executionTools[toolName],
        bridgeWs,
        bridgeSecrets,
      );
    }
  }
  // Variable layer — OUTERMOST wrap (after bridge): rehydrate {{var:…}} handles
  // in tool args and capture oversized outputs to reusable handles. Applied
  // regardless of bridge so cloud-only chats benefit too.
  {
    const convKey = conversationKeyFromSecrets(bridgeSecrets);
    for (const toolName of Object.keys(executionTools)) {
      executionTools[toolName] = wrapToolWithVariables(
        executionTools[toolName],
        convKey,
      );
    }
  }

  const instructions = [
    {
      role: "system",
      content: buildOrchestratorPrompt(
        enabledIntegrations,
        skills,
        bots,
        promptOptions,
      ),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
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
  (agent as any).__executionToolNames = Object.keys(executionTools);
  // Mid-turn re-arm hint for stream-runner's prepareStep: when a research session
  // exists for this conversation (created same-turn by enter_research_mode), flip
  // the gather/compile loop on for the remaining steps. Pure in-memory check —
  // no desktop round-trip, no context refetch.
  (agent as any).__rearmOnResearch = {
    conversationId: promptOptions.conversationId || null,
    toolNames: RESEARCH_SESSION_TOOL_NAMES,
  };
  (agent as any).__modelSource = (selectedModel as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!((selectedModel as any)?.__stuardBillingExcluded);
  return agent;
}
