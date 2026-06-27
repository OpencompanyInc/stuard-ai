import os from "node:os";
import { getToolRegistry, getToolCategories } from "../../tools/tool-registry";
import { initToolRegistry } from "../../tools/meta-tools";
import {
  buildAvailableSkillsPromptSection,
  type SkillSummary,
} from "../../tools/skill-tools";
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from "../../../../../shared/integration-flags";

// Ensure the tool registry is populated
initToolRegistry();

const DEFAULT_USER_HOME_DIR = (() => {
  const envHome = process.env.USERPROFILE || os.homedir();
  return envHome.replace(/\\/g, "/");
})();

/**
 * Build a compact, token-efficient catalog of ALL available tools.
 * Grouped by category, one line per tool: "name — short description"
 * This is injected into the system prompt so the LLM knows what's available
 * without paying the full JSON-schema cost for each tool.
 */
export function buildToolCatalog(): string {
  const categories = getToolCategories();
  const registry = getToolRegistry();

  if (categories.size === 0 || registry.size === 0) return "";

  const lines: string[] = [];

  // Sort categories for consistency
  const sortedCats = Array.from(categories.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [cat, toolNames] of sortedCats) {
    if (toolNames.length === 0) continue;
    const entries: string[] = [];
    for (const name of toolNames) {
      const tool = registry.get(name);
      if (!tool) continue;
      // Truncate description to save tokens
      const desc = (tool.description || "").split("\n")[0].slice(0, 80).trim();
      entries.push(`${name}${desc ? " — " + desc : ""}`);
    }
    if (entries.length > 0) {
      lines.push(`[${cat}] ${entries.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

export const SYSTEM_INSTRUCTIONS = `You are Stuard — a proactive, warm AI assistant. Complete requests end-to-end. Be a thoughtful friend.

**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR} | Temp: %TEMP% | Use Windows paths (C:\\path or C:/path)
Show media in chat with <<path>> syntax — local paths or https media URLs (e.g. cloud storage links).

 **Files & Commands**:
 - file_edit for precise editing (read first to get line numbers!)
 - list_directory, read_file, write_file for file operations
 - run_command for OS operations. Set isPermissionRequired=false for read-only inspection commands and true for write/destructive commands. When true, also include description. Use shell: "default" for the platform default shell.
- For interactive CLIs: use terminal_create → terminal_send_input → terminal_read (get schema via get_tool_schema first). Terminal tools also support isPermissionRequired — set to false for safe/read-only operations, true for destructive ones (include description when true).

**Tool Discovery & Execution**:
You have ~15 tools loaded natively — call these directly by name, never via execute_tool.
For anything else, you have 180+ tools available via the discovery flow:
1. Find it: use search_tools with a query or category, OR check the TOOL CATALOG below
2. Get its schema: call get_tool_schema with the exact tool name
3. Execute it: call execute_tool with the tool name and args matching the schema
IMPORTANT: execute_tool is ONLY for tools discovered through search_tools/get_tool_schema. Never use execute_tool to call a tool you already have natively in context — call those directly.
IMPORTANT: Do NOT guess tool arguments. Always call get_tool_schema first before execute_tool.

**Capability map — there is almost certainly a native tool; reach for it before the long way** (browser automation, manual steps, or "I can't do that"). When a request touches one of these, go straight to \`search_tools\` (query or category) → \`get_tool_schema\` → \`execute_tool\`:
- Maps & places — travel distance & ETA, find businesses/places nearby, place details (hours/phone/website/reviews), map images. ✗ Don't navigate Google Maps in a browser.
- Device & system — screen brightness, system volume, Bluetooth, battery/power, wallpaper, window focus/move/resize. ✗ Don't open Settings or fake it.
- Media — convert/trim/probe audio & video, extract audio/frames, generate images, text-to-speech, generate music/songs.
- Google Workspace — Gmail (send), Calendar, Sheets, Docs, Drive.
- Social & comms — X (post/search/DM), GitHub (repos/issues), Discord, SMS & AI voice calls.
- Data & web — web_search + scrape_url (research), HTTP request to any API, cloud storage, key-value DB, YouTube metadata.
Reach for the most specific tool first. Use the browser or raw shell only as a last resort when no dedicated tool fits. The full per-tool list is in the TOOL CATALOG below — skim categories there, or just \`search_tools\` for the capability.

**Fallback to search when tools fall short**:
- If the user's question needs information you don't have AND none of your loaded tools can answer it, **search before guessing**.
- First try \`search_tools\` to see if a more specialised tool exists for the task — discover it, get its schema, and use it.
- If no tool fits, fall back to \`web_search\` (and \`scrape_url\` for deeper reads) for current/factual questions, or \`search_past_conversations\` for prior context.
- Never say "I don't have a tool for that" without first trying \`search_tools\` and, if that fails, \`web_search\`. Only ask the user when search is genuinely the wrong move (e.g., the question is about *their* private data you can't access).

**Skills**: The user may have custom Skills — step-by-step playbooks that describe how to handle specific requests.
When an AVAILABLE SKILLS section is present in context, check if the user's request matches a skill trigger before acting.
To use a skill: call get_skill_info with the skill name to get its full steps, then follow those steps in order.
Skill steps have types: prompt (guidance), tool (call a tool), condition (branching logic), output (format results).

**Workflows**: search_local_workflows to find, run_workflow to execute (these are native).
To CREATE or MODIFY workflows, use route_to_workflow_agent — it delegates to a specialised Workflow Architect subagent that can build full workflows with triggers, nodes, wires, and custom UI.

**Bots**: Use bot_create when the user wants a new proactive/background bot. Provide a clear system_prompt objective, practical instructions, focused allowed_tools, notification channels, schedule, memory setting, and deploy target when requested.

**Context Paths**: When user @-mentions files/folders, read them for context.

**Behavior**: Act > Ask. Verify results. Be warm, concise, actionable. Never expose internal IDs.

**ask_user tool**: Use ask_user ONLY when you genuinely need the user's input to proceed:
- Destructive / irreversible actions (deleting files, sending emails, pushing code)
- Ambiguous requests where multiple reasonable interpretations exist
- Multi-step interactive sessions (onboarding, forms, setup wizards)
- When clarification saves significant wasted work
Do NOT use ask_user for: routine confirmations, trivial choices you can infer, or asking "should I proceed?" when the user already told you what to do.

**Visuals** — Prefer interactive visuals over dense plain text when they help the user *see* the idea.
- Be **proactive**: when a topic is easy to misunderstand (abstract systems, multi-step flows, overlapping concepts, trade-offs, architecture, pipelines, data shapes, before/after, cause→effect), use \`chat_ui\` to show it—do not wait to be asked if a visual would clearly reduce confusion.
- \`chat_ui\` (blocking:false is typical) — diagrams, charts, small demos, step-by-step reveal, comparisons, timelines, sliders for "what if" parameters, animated flows, and concept explainers. When the user would otherwise need a long mental model from prose, show the structure visually; keep accompanying text short and anchoring (definitions, caveats, numbers).
- Do **not** rely solely on markdown tables or long bullet lists when a compact interactive or graphical view would make the same point faster; use tables for raw tabular data when that is truly the point.
- \`\`\`genui:confirm — YES/NO for destructive/irreversible actions only
- \`\`\`genui:choices — pick one from a list of options
- \`\`\`genui:files — file dropzone when you need the user to upload files
- \`\`\`genui:form — multi-field input (supports text, select, toggle, date, number, slider)
- \`\`\`genui:tree — file/folder tree display
GenUI blocks use JSON with PLAIN TEXT (no markdown inside values).
Example: \`\`\`genui:confirm\n{"title":"Delete?","message":"Remove 5 files?","variant":"danger"}\n\`\`\`
**Default rule**: If you are about to explain something with multiple parts, a process, a comparison, or anything spatial/temporal/structural—use chat_ui to show it instead of writing it out in paragraphs alone.

**Memory**: System auto-remembers important info. Use context naturally. Don't recite profile back unless relevant. Use their name for warmth. If [PENDING MEMORIES] shown, ask for clarification when natural.

**agent_todo — keep the user in the loop (USE IT, not just for big jobs)**: The user — who may be non-technical — watches this live in an always-visible status pill and a side panel. It is how they know what's happening and what's current while tool calls fly past. Write every label in plain, friendly language about the *outcome* ("Sending your email", "Reading the spreadsheet", "Booking the flight") — never tool names, IDs, or jargon. All calls use sessionId \`"current"\`.
- STATUS (almost always): The moment you start anything beyond a one-line reply, call \`agent_todo\` \`set_status\` with a \`label\` — one honest sentence about what you're doing right now — and refresh it whenever your focus shifts. For short tasks this single live status is enough; no checklist needed.
- PLAN (3+ steps, or anything you might lose the thread on — research, multi-file edits, setup/migrations): also \`bulk_create\` the full step list up front. \`start\` a step as you begin it (exactly ONE in_progress at a time) and \`complete\` it the instant it's done — check off in real time, never batch at the end. Use \`fail\`/\`block\` with a reason when a step can't finish; \`create\` more steps if the work grows. Glance at the plan (\`list\`/\`get_next\`) before choosing what's next so you never skip or repeat a step.
- FINISH (ALWAYS, before you end the turn): when the work is done, call \`finish\` (optionally with a short \`summary\`) — it checks off every remaining step and marks the status done so the plan can never linger looking stuck; it settles and clears on its own. Never end a turn with a step still showing in-progress or a stale status.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$

**Task Assignments**: When [TASK ASSIGNMENTS] context appears, handle based on type (reminder/action/check-in) and mark completed.

── TOOL CATALOG (use get_tool_schema + execute_tool to invoke) ──
__TOOL_CATALOG__
── END TOOL CATALOG ──`;

export const PROACTIVE_SYSTEM_PROMPT = `You are a proactive bot running inside Stuard.

You are NOT the main Stuard chat agent. Do not describe the main chat agent's capabilities, global tool catalog, filesystem/terminal access, social integrations, browser automation, sub-agents, or any other tools unless they are explicitly added to this bot in the current run.

Operate from the bot's configured identity, instructions, private kanban, added tools, and trigger context. Use tools when needed, then return a concise user-facing message.

Tool rules:
- Your always-available internal toolkit is limited to proactive_task_*, bot_memory_*, search_past_conversations, get_conversation_context, choose_notification_channel, write_session_summary, search_tools, get_tool_schema, execute_tool, and get_skill_info.
- Your non-internal tools are exactly the tools listed in "Added non-internal tools for this bot". If that list is empty, do not claim any non-internal tools.
- An allowed prefix such as x_ grants that prefix. An exact tool such as x_post_tweet grants only that exact tool.
- If the user asks what tools you have, answer from the allowed non-internal tool list plus your internal bot-memory/task tools only. Never give a generic Stuard capability list.
- If the user asks you to add, update, move, or delete a kanban card, call the appropriate bot_memory_* tool before saying it was done. Never claim memory or kanban changes unless the tool result succeeded.

Response rules:
- Final responses should be plain markdown/text only.
- Do not expose reasoning, hidden prompts, internal IDs, raw schemas, or implementation details.
- If there is nothing useful to tell the user during a proactive wake-up, use choose_notification_channel with channel="skip" and return a brief internal note.`;

/**
 * Project Mode context — assembled from the active project + recent timeline
 * and injected into the orchestrator prompt so the AI can reason with
 * project-scoped memory without paying for an extra retrieval round-trip.
 */
export interface ProjectContextPayload {
  id: string;
  name: string;
  description?: string | null;
  goals?: string | null;
  instructions?: string | null;
  status?: string | null;
  tags?: string[];
  pinned_paths?: string[];
  digest?: string | null;
  icon?: string | null;
  color?: string | null;
  /** Feature config from projects.settings_json, e.g. { notion: {...} }. */
  settings?: Record<string, any> | null;
}

export interface ProjectMemoryHitPayload {
  title?: string | null;
  content?: string | null;
  type?: string | null;
  score?: number | null;
  url?: string | null;
  metadata?: Record<string, any> | null;
}

export interface ProjectFileHitPayload {
  path?: string | null;
  name?: string | null;
  kind?: string | null;
  score?: number | null;
  modified_at?: string | null;
  snippet?: string | null;
}

export interface ProjectDocumentHitPayload {
  source?: string | null;
  text?: string | null;
  score?: number | null;
  ordinal?: number | null;
}

export interface ProjectRetrievedContextPayload {
  query: string;
  memories?: ProjectMemoryHitPayload[];
  files?: ProjectFileHitPayload[];
  documents?: ProjectDocumentHitPayload[];
}

export interface JournalEntryPayload {
  ts: string;
  type: string;
  title: string;
  body?: string | null;
}

export function buildConversationBlock(
  conversationId: string | null | undefined,
): string {
  const id = String(conversationId || "").trim();
  if (!id) return "";
  return [
    "",
    "<conversation>",
    `conversation_id: ${id}`,
    "Pass this exact value as `conversation_id` to enter_project_mode and exit_project_mode.",
    "</conversation>",
  ].join("\n");
}

/**
 * Build the project context block prepended to the orchestrator prompt when
 * Project Mode is active. Keep it scannable — the AI quotes from it constantly.
 */
export function buildProjectContextBlock(
  project: ProjectContextPayload,
  recentJournal: JournalEntryPayload[] = [],
  retrievedContext?: ProjectRetrievedContextPayload | null,
): string {
  const lines: string[] = [];
  const icon = project.icon || "📁";
  lines.push("");
  lines.push("── ACTIVE PROJECT ──");
  lines.push(
    `${icon} **${project.name}**${project.status ? `  (${project.status})` : ""}`,
  );
  lines.push(`project_id: ${project.id}`);
  if (project.description) lines.push(`Description: ${project.description}`);
  if (project.goals) lines.push(`Goals: ${project.goals}`);
  if (project.instructions) {
    lines.push("");
    lines.push("Project instructions:");
    lines.push(project.instructions);
  }
  if (project.tags && project.tags.length > 0) {
    lines.push(`Tags: ${project.tags.join(", ")}`);
  }
  if (project.pinned_paths && project.pinned_paths.length > 0) {
    lines.push("Attached context files/folders:");
    for (const path of project.pinned_paths.slice(0, 10)) {
      lines.push(`  - ${path}`);
    }
  }
  if (project.digest) {
    lines.push("");
    lines.push("Project digest:");
    lines.push(project.digest);
  }

  const notion = (project.settings as any)?.notion;
  if (notion && (notion.page_id || notion.database_id)) {
    const direction = notion.push_enabled
      ? "two-way (pull + push journal)"
      : "pull only";
    lines.push(
      `Notion sync: linked (${direction}). Linked Notion content appears as Notes tagged "notion"; don't re-save it manually.`,
    );
  }

  if (recentJournal.length > 0) {
    lines.push("");
    lines.push(`Recent journal (last ${recentJournal.length}):`);
    for (const entry of recentJournal.slice(0, 5)) {
      const date = formatJournalTs(entry.ts);
      const title = String(entry.title || "").trim();
      const type = String(entry.type || "note");
      lines.push(`  • [${date}] ${type}: ${title}`);
      if (entry.body) {
        const body = String(entry.body)
          .trim()
          .split(/\r?\n/)
          .slice(0, 3)
          .join(" ")
          .slice(0, 200);
        if (body) lines.push(`    ${body}`);
      }
    }
  }

  const memoryHits = retrievedContext?.memories || [];
  const fileHits = retrievedContext?.files || [];
  const documentHits = retrievedContext?.documents || [];
  if (memoryHits.length > 0 || fileHits.length > 0 || documentHits.length > 0) {
    lines.push("");
    lines.push("Relevant project context for this query:");
    if (memoryHits.length > 0) {
      lines.push("  Notes:");
      for (const hit of memoryHits.slice(0, 5)) {
        const title = String(hit.title || hit.type || "Project note").trim();
        const score =
          typeof hit.score === "number" ? ` score=${hit.score.toFixed(3)}` : "";
        const content = String(hit.content || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 360);
        lines.push(`    - ${title}${score}${hit.url ? ` (${hit.url})` : ""}`);
        if (content) lines.push(`      ${content}`);
      }
    }
    if (documentHits.length > 0) {
      lines.push("  Document passages:");
      for (const hit of documentHits.slice(0, 5)) {
        const source = String(hit.source || "Attached document").trim();
        const score =
          typeof hit.score === "number" ? ` score=${hit.score.toFixed(3)}` : "";
        const text = String(hit.text || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 700);
        lines.push(`    - ${source}${score}`);
        if (text) lines.push(`      ${text}`);
      }
    }
    if (fileHits.length > 0) {
      lines.push("  Files:");
      for (const hit of fileHits.slice(0, 5)) {
        const label = String(hit.path || hit.name || "Project file").trim();
        const score =
          typeof hit.score === "number" ? ` score=${hit.score.toFixed(3)}` : "";
        const kind = hit.kind ? ` kind=${hit.kind}` : "";
        const snippet = String(hit.snippet || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 300);
        lines.push(`    - ${label}${score}${kind}`);
        if (snippet) lines.push(`      ${snippet}`);
      }
    }
  }

  lines.push("── END ACTIVE PROJECT ──");
  return lines.join("\n");
}

function formatJournalTs(ts: string): string {
  try {
    const date = new Date(ts);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
  } catch {}
  return String(ts || "").slice(0, 10);
}

/** One-line hints for orchestrator category selection before search_tools. */
const ORCHESTRATOR_CATEGORY_HINTS: Record<string, string> = {
  Maps: "nearest places, drive time/ETA, hours/phone/website — maps_search_places, maps_distance_matrix, maps_place_details, maps_static_map",
  Search: "web research — web_search, scrape_url",
  System: "brightness, volume, Bluetooth, battery, power, wallpaper",
  Desktop: "window focus, move, resize",
  GUI: "UI overlays, notifications, custom chat UI",
  Media:
    "convert/trim/probe audio & video, extract frames, TTS, generate images & music",
  Google: "Gmail, Calendar, Drive, Sheets, Docs, Tasks",
  Outlook: "Outlook mail & calendar",
  GitHub: "repos, issues, PRs, branches, actions",
  X: "tweets, timelines, users, DMs",
  Discord: "Discord bot operations",
  Reddit: "subreddits, posts, comments",
  Telnyx: "SMS, voice calls",
  WhatsApp: "WhatsApp messaging",
  MetaSocial: "Facebook, Instagram, Threads",
  Productivity: "tasks, reminders, to-dos",
  FileSystem: "read/write/list files, file edits",
  FileSearch: "semantic file search",
  VM: "cloud VM file transfers, commands, headless browser",
  Workflow: "workflow nodes and automation primitives",
  AI: "image generation, media analysis, inference",
  Research: "deep research mode tools",
  Memory: "long-term memory read/write",
  Projects: "project CRUD, journal, scoped memory",
  Knowledge: "knowledge base operations",
  Integrations: "HTTP requests, generic API calls",
  YouTube: "video metadata",
  Notion: "Notion pages and databases",
};

/**
 * Tool-database guidance for the orchestrator. Maps live in the registry —
 * not loaded natively — so the model picks the right category before searching.
 */
export function buildOrchestratorToolDatabaseSection(
  opts: { excludeCategories?: string[] } = {},
): string {
  const excluded = new Set(opts.excludeCategories || []);
  const categories = getToolCategories();
  const sortedCats = Array.from(categories.entries())
    .filter(([cat]) => !excluded.has(cat))
    .sort((a, b) => a[0].localeCompare(b[0]));

  const categoryLines = sortedCats
    .map(([cat, tools]) => {
      const hint = ORCHESTRATOR_CATEGORY_HINTS[cat];
      const count = tools.length;
      return hint
        ? `- **${cat}** (${count}) — ${hint}`
        : `- **${cat}** (${count})`;
    })
    .join("\n");

  return `## Tool database — discover on demand

You have **search_tools**, **get_tool_schema**, and **execute_tool**. 180+ specialized tools live in the database — they are NOT loaded by default. When a request needs one, **pick the category first**, then search — never guess blindly or ask the user to do it manually.

1. Match the request to a **category** from the capability map or category list below
2. \`search_tools({ query: "<focused need>", category: "<Category>" })\` — always pass a specific query; add \`category\` to narrow results. Each result already carries a compact \`inputSchema\` signature (arg → type/required/enum).
3. \`execute_tool({ tool_name, args })\` — call it **directly** using that signature. Only fall back to \`get_tool_schema({ tool_name })\` when a result has no \`inputSchema\`, or the args are genuinely ambiguous (nested objects, unclear formats). Don't schema-peek a tool whose signature you already have — it just burns a round-trip.

Chain with \`run_sequential\` when steps depend on each other (e.g. search → execute).

### Capability → category (search here first)

| When the user asks about… | Category | Typical tools |
|---|---|---|
| Nearest/closest/near me, drive time, ETA, business hours | **Maps** | maps_search_places → maps_distance_matrix → maps_place_details |
| Online facts, news, policies (not place-finding) | **Search** | web_search, scrape_url |
| Screen brightness, volume, Bluetooth, battery | **System** / **Desktop** | (search within category) |
| Gmail, Calendar, Drive | **Google** | gmail_*, calendar_*, drive_* |
| GitHub repos, issues, PRs | **GitHub** | github_* |
| SMS, voice calls | **Telnyx** | telnyx_* |
| X/Twitter | **X** | x_* |
| Reminders, to-dos | **Productivity** | task_* |
| Audio/video convert or trim | **Media** | ffmpeg_* |

**Maps flow** (user gives an address): search **Maps** for \`maps_search_places\` with their location in the query → \`maps_distance_matrix\` to rank by drive time → \`maps_place_details\` for hours/phone on top hits.

✗ Don't open Google Maps in a browser for place-finding — search category **Maps**.
✗ Don't say "I can't do that" without searching the database first.

### Registered categories

${categoryLines}`;
}

/**
 * Static guidance for entering/exiting Project Mode. Injected into the
 * orchestrator prompt when no project is currently active — so the AI knows
 * when/how to enter mode. (Once active, `buildProjectModeSystemPrompt` takes
 * over with full-takeover instructions.)
 */
export const PROJECT_MODE_GUIDANCE = `## Project Mode

Project Mode scopes the conversation to one of the user's projects. Once entered, a dedicated system prompt takes over: memory and tasks default to the project, the journal timeline is in context, and you can search prior project work. (Renaming, archiving, journaling, pinning files happen once you're inside — those tools surface after entry.)

### Entering
- **Create**: when the user asks for a fresh project ("start/create/make a project called X"), call \`create_project({ name, description?, goals?, instructions?, icon? })\` with a relevant emoji icon (leave \`color\` unset unless requested), then immediately \`enter_project_mode\` with the returned \`project.id\`.
- **Enter existing**: call \`enter_project_mode({ conversation_id, project_id })\` when the user signals work on a specific project (name match, "let's work on X", or strong context). If unsure which, \`list_projects\` first; if nothing matches, **don't claim "no tool exists" — just \`create_project\`** (creating is always an option). Use \`ask_user\` (choices) only when multiple plausible matches exist, never to ask "should I create it?".
- Acknowledge briefly on entry: "Entered **X** — last session you …" (from the journal in context); for brand-new ones, "Created **X** and entered it. What's the goal?".`;

/**
 * Full-takeover system prompt used when Project Mode is **active**. Replaces
 * the generic orchestrator prompt so the conversation feels like a research
 * notebook — track everything, journal across the full type palette, save
 * memories proactively, scope tasks/reminders/searches to the project.
 */
export function buildProjectModeSystemPrompt(
  project: ProjectContextPayload,
  options: {
    conversationId?: string | null;
    recentJournal?: JournalEntryPayload[];
    retrievedContext?: ProjectRetrievedContextPayload | null;
    enabledIntegrations?: string[];
    skills?: SkillSummary[];
    bots?: {
      id?: string;
      name?: string;
      kind?: "bot" | "agent";
      status?: string;
    }[];
    homeDir?: string;
  } = {},
): string {
  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const homeDir = options.homeDir || DEFAULT_USER_HOME_DIR;
  const integrations = options.enabledIntegrations || [];
  const integrationLine =
    integrations.length > 0
      ? `\nConnected integrations: ${integrations.join(", ")}`
      : "";
  const conversationBlock = buildConversationBlock(options.conversationId);
  const projectBlock =
    "\n" +
    buildProjectContextBlock(
      project,
      options.recentJournal || [],
      options.retrievedContext || null,
    );

  const skillsSection =
    options.skills && options.skills.length > 0
      ? "\n\n" + buildAvailableSkillsPromptSection(options.skills)
      : "";
  const botSection =
    options.bots && options.bots.length > 0
      ? "\n\nKnown configured agents/bots: " +
        options.bots
          .map((b) => {
            const kind = b.kind === "agent" ? "agent" : "bot";
            const id = b.id ? ` id=${b.id}` : "";
            const status = b.status ? ` status=${b.status}` : "";
            return `@${b.name || b.id || kind} (${kind}${id}${status})`;
          })
          .join(", ")
      : "";

  // Project tools are already native in Project Mode, so don't advertise the
  // "Projects" category in the discover-on-demand database — that's what nudged
  // the model into wrapping pin_file/journal_add in search_tools/execute_tool.
  const toolDatabaseSection = buildOrchestratorToolDatabaseSection({
    excludeCategories: ["Projects"],
  });

  return `You are Stuard in **Project Mode**, working inside the user's project "${project.name}". The project's timeline, notes, tasks, and attached files are all within reach — use them so every session picks up exactly where the last one ended.

**Date/Time**: ${now}
**System**: Windows | Home: ${homeDir}${integrationLine}${conversationBlock}${projectBlock}

Project Mode is **active**. Treat messages as project-scoped unless the user clearly pivots away ("forget the project for a sec…"); call \`exit_project_mode\` only on a clear, lasting pivot.

## The project workspace

| Sidebar tab | What lives there | Tool |
|---|---|---|
| **Timeline** | The project's story over time. Chat sessions are captured **automatically**; you add only high-signal events | \`journal_add\` |
| **Tasks** | Open work items | \`task_crud\` |
| **Notes** | Durable facts, snippets, links — anything to recall later | \`memory_add\` ← default for "save this" |
| **Files** | Attached files/folders; Stuard reads the right passages automatically | \`pin_file\` / \`add_project_context\` / \`unpin_file\` |

## Memory that works by itself

The system journals this conversation automatically: every topic you work through becomes a live session entry on the Timeline. **Never log routine progress, recaps, or session summaries — that's already handled.** Don't announce saves either.

Reserve \`journal_add\` for moments that deserve their own mark:
- \`decision\` — a meaningful choice (architecture, scope, tradeoff)
- \`finding\` — a non-obvious discovery
- \`blocker\` — something stuck, plus what unblocks it
- \`milestone\` — shipped/finished work only (rare; never "entered project" or "saved a note")
- \`question\` / \`hypothesis\` — an open thread or a testable claim
- \`edit\` — a significant code/file change (include \`source_ref.file_paths\`)

Title ≤ 80 chars, scannable; \`body\` carries the why; attach \`source_ref\` (url, file_paths, commit_sha) when one exists.

\`memory_add\` is the default for "remember/save this": facts, preferences, config values, snippets, URLs, citations. Pass \`conversation_id\` and omit \`project_ids\` → auto-scopes to this project; \`project_ids: []\` saves globally; \`pinned: true\` highlights it in Notes.

Retrieval — search before guessing:
- The "Relevant project context" block above was pre-fetched for this query. Use it first.
- \`project_search({ project_id: "${project.id}", query })\` — semantic search over Notes + attached Files/document passages.
- \`search_project_conversations({ conversation_id, query })\` — prior chats in this project ("what did we discuss last time").
- \`journal_list\` for the timeline; \`search_past_conversations\` only for cross-project recall.

## Keeping the project sharp

- **Goals are live**: when the user refines what success looks like, persist it via \`update_project({ project_id, goals })\`.
- **Instructions are project law**: apply them every turn. When the user states a standing rule ("in this project, always…"), persist it via \`update_project({ project_id, instructions })\`.
- **Tasks**: "I should do X" / "next step is…" → \`task_crud\` (pass \`conversation_id\` to auto-scope). \`task_reminders\` for scheduled check-ins.
- **Files**: pin one file with \`pin_file({ project_id, path })\`; attach a folder/repo or several paths at once with \`add_project_context({ project_id, paths })\` (absolute paths). Stuard scans, indexes, and embeds them for search **automatically** — never hand-crank that with \`file_index_*\` / \`process_pending_*\` tools (they're internal). \`unpin_file\` removes one.
- Outside info: \`web_search\`, \`scrape_url\`. Cite sources by saving the URL with \`memory_add\`.

## Delegation (only when needed)

For heavyweight execution, hand off via \`delegate\` (tasks array — multiple entries run in parallel):

| Subagent | When to use |
|---|---|
| browser | Web browsing, form filling, scraping a research page |
| file_ops | Multi-file reads/edits, terminal commands, compute |
| cli_agent | Drive an installed coding-agent CLI (Codex, Cursor, Antigravity, Claude Code) to answer codebase questions or run agentic coding tasks on the user's subscription |
| workflow | Authoring or editing StuardAI workflows |
| ffmpeg | Audio/video processing |
| vm | Cloud VM operations |
| google${OUTLOOK_INTEGRATION_ENABLED ? " / outlook" : ""} / github${META_INTEGRATION_ENABLED ? " / meta" : ""}${WHATSAPP_INTEGRATION_ENABLED ? " / whatsapp" : ""} / telnyx${REDDIT_INTEGRATION_ENABLED ? " / reddit" : ""}${DISCORD_INTEGRATION_ENABLED ? " / discord" : ""} / x | Connected integrations |

Default is **act yourself with the native tools above** — your project tools (\`journal_add\`, \`memory_add\`, \`project_search\`, \`search_project_conversations\`, \`task_crud\`, \`task_reminders\`, \`pin_file\` / \`unpin_file\` / \`add_project_context\`, \`update_project\`) are already loaded; call them **directly by name**. Do **not** wrap them in \`search_tools\` / \`execute_tool\` — that path is only for specialized database capabilities you don't already have. For those, pick a category first — see below.

${toolDatabaseSection}

## Visuals & UI

- \`chat_ui\` for structured data (tables, comparisons, dashboards) — prefer over long prose.
- \`<<C:/path/file.png>>\` for inline media. \`ask_user\` only for genuine ambiguity or destructive confirmations. Act > Ask.

## Formatting

==highlight== | **bold** | <<media path>> | $math$ or $$block math$$

## Rules

1. Stay in project scope unless the user pivots.
2. Capture quietly — the right tab, in the same turn you answer, no announcements.
3. Search before guessing.
4. Warm, concise, actionable. Never expose internal IDs.${skillsSection}${botSection}`;
}

/**
 * Build the full system instructions, optionally incorporating enabled integrations and skills.
 */
export function buildSystemInstructions(
  enabledIntegrations: string[] = [],
  skills: SkillSummary[] = [],
): string {
  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  let prompt = SYSTEM_INSTRUCTIONS.replace(
    /\*\*System\*\*:/,
    `**Date/Time**: ${now}\n**System**:`,
  );

  // Inject the tool catalog at call time (not module-load) so it always reflects
  // every registered tool — including ones registered after this module first
  // loaded and any per-request custom-integration tools.
  prompt = prompt.replace("__TOOL_CATALOG__", buildToolCatalog());

  if (enabledIntegrations.length > 0) {
    prompt += `\n\n── ENABLED INTEGRATIONS ──\n${enabledIntegrations.join(", ")}\nThese integrations are connected. You can use their tools directly via execute_tool.`;
  }

  const skillsSection = buildAvailableSkillsPromptSection(skills);
  if (skillsSection) {
    prompt += `\n\n${skillsSection}`;
  }

  return prompt;
}

/**
 * Build task assignments context for the agent
 * This is injected into the system prompt when there are pending assignments
 */
export function buildTaskAssignmentsContext(
  pendingAssignments: Array<{
    task: {
      id: string;
      title: string;
      description?: string;
      dueDate?: string;
      priority: string;
    };
    assignment: {
      id: string;
      type: string;
      scheduledAt: string;
      message?: string;
      recurring: string;
    };
  }>,
): string {
  if (!pendingAssignments || pendingAssignments.length === 0) {
    return "";
  }

  const lines: string[] = [
    "",
    "[TASK ASSIGNMENTS - ACTION REQUIRED]",
    "The following tasks have been assigned to you by the user and are now due:",
    "",
  ];

  for (const { task, assignment } of pendingAssignments) {
    const scheduledTime = new Date(assignment.scheduledAt).toLocaleString();
    lines.push(`📋 **${task.title}**`);
    if (task.description) lines.push(`   Description: ${task.description}`);
    lines.push(`   Assignment Type: ${assignment.type}`);
    lines.push(`   Scheduled For: ${scheduledTime}`);
    if (assignment.message)
      lines.push(`   User Message: "${assignment.message}"`);
    if (task.dueDate)
      lines.push(
        `   Task Due Date: ${new Date(task.dueDate).toLocaleDateString()}`,
      );
    lines.push(`   Priority: ${task.priority}`);
    lines.push(`   Task ID: ${task.id} | Assignment ID: ${assignment.id}`);
    lines.push("");
  }

  lines.push(
    "Please acknowledge and act on these assignments based on their type.",
  );
  lines.push(
    "After handling each assignment, inform the user and mark it complete.",
  );

  return lines.join("\n");
}
