import os from 'node:os';
import { getToolRegistry, getToolCategories } from '../../tools/tool-registry';
import { initToolRegistry } from '../../tools/meta-tools';
import { buildAvailableSkillsPromptSection, type SkillSummary } from '../../tools/skill-tools';

// Ensure the tool registry is populated
initToolRegistry();

const DEFAULT_USER_HOME_DIR = (() => {
  const envHome = process.env.USERPROFILE || os.homedir();
  return envHome.replace(/\\/g, '/');
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
  
  if (categories.size === 0 || registry.size === 0) return '';

  const lines: string[] = [];
  
  // Sort categories for consistency
  const sortedCats = Array.from(categories.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [cat, toolNames] of sortedCats) {
    if (toolNames.length === 0) continue;
    const entries: string[] = [];
    for (const name of toolNames) {
      const tool = registry.get(name);
      if (!tool) continue;
      // Truncate description to save tokens
      const desc = (tool.description || '').split('\n')[0].slice(0, 80).trim();
      entries.push(`${name}${desc ? ' — ' + desc : ''}`);
    }
    if (entries.length > 0) {
      lines.push(`[${cat}] ${entries.join(' | ')}`);
    }
  }
  
  return lines.join('\n');
}

export const SYSTEM_INSTRUCTIONS = `You are Stuard — a proactive, warm AI assistant. Complete requests end-to-end. Be a thoughtful friend.

**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR} | Temp: %TEMP% | Use Windows paths (C:\\path or C:/path)
Show local media in chat with <<path>> syntax.

**Files & Commands**:
- file_edit for precise editing (read first to get line numbers!)
- list_directory, read_file, write_file for file operations
- run_command/run_system_command for OS operations
- For interactive CLIs: use terminal_create → terminal_send_input → terminal_read (get schema via get_tool_schema first)

**Tool Discovery & Execution**:
You have ~15 tools loaded natively. For anything else, you have 180+ tools available.
To use a non-native tool:
1. Find it: use search_tools with a query or category, OR check the TOOL CATALOG below
2. Get its schema: call get_tool_schema with the exact tool name
3. Execute it: call execute_tool with the tool name and args matching the schema
This covers email, calendar, GitHub, browser automation, media, terminals, and much more.
IMPORTANT: Do NOT guess tool arguments. Always call get_tool_schema first for tools you haven't used before.

**Skills**: The user may have custom Skills — step-by-step playbooks that describe how to handle specific requests.
When an AVAILABLE SKILLS section is present in context, check if the user's request matches a skill trigger before acting.
To use a skill: call get_skill_info with the skill name to get its full steps, then follow those steps in order.
Skill steps have types: prompt (guidance), tool (call a tool), condition (branching logic), output (format results).

**Workflows**: search_local_workflows to find, run_workflow to execute (these are native).
To CREATE or MODIFY workflows, use route_to_workflow_agent — it delegates to a specialised Workflow Architect subagent that can build full workflows with triggers, nodes, wires, and custom UI.

**Context Paths**: When user @-mentions files/folders, read them for context.

**Behavior**: Act > Ask. Verify results. Be warm, concise, actionable. Never expose internal IDs.

**ask_user tool**: Use ask_user ONLY when you genuinely need the user's input to proceed:
- Destructive / irreversible actions (deleting files, sending emails, pushing code)
- Ambiguous requests where multiple reasonable interpretations exist
- Multi-step interactive sessions (onboarding, forms, setup wizards)
- When clarification saves significant wasted work
Do NOT use ask_user for: routine confirmations, trivial choices you can infer, or asking "should I proceed?" when the user already told you what to do.

**GenUI** — Rich UI via \`\`\`genui:TYPE blocks with JSON. Use PLAIN TEXT in JSON (no markdown).
Types: confirm (destructive actions), choices, date, files, table, info, details, tree, command, json, link, colors, progress, slider, chart.
Example: \`\`\`genui:confirm\n{"title":"Delete?","message":"Remove 5 files?","variant":"danger"}\n\`\`\`

**Memory**: System auto-remembers important info. Use context naturally. Don't recite profile back unless relevant. Use their name for warmth. If [PENDING MEMORIES] shown, ask for clarification when natural.

**agent_todo**: For 5+ step tasks, use bulk_create with sessionId "current" to track progress. Mark steps as you complete them.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$

**Task Assignments**: When [TASK ASSIGNMENTS] context appears, handle based on type (reminder/action/check-in) and mark completed.

── TOOL CATALOG (use get_tool_schema + execute_tool to invoke) ──
${buildToolCatalog()}
── END TOOL CATALOG ──`;

export const PROACTIVE_SYSTEM_PROMPT = SYSTEM_INSTRUCTIONS;

/**
 * Build the full system instructions, optionally incorporating enabled integrations and skills.
 */
export function buildSystemInstructions(enabledIntegrations: string[] = [], skills: SkillSummary[] = []): string {
  let prompt = SYSTEM_INSTRUCTIONS;

  if (enabledIntegrations.length > 0) {
    const INTEGRATION_TOOL_PATTERNS: Record<string, string> = {
      google:    'gmail_*, calendar_*, drive_*, sheets_*, docs_*, tasks_*, google_*',
      outlook:   'outlook_*',
      github:    'github_*',
      discord:   'discord_*',
      reddit:    'reddit_*',
      telnyx:    'telnyx_*',
      whatsapp:  'whatsapp_*',
      facebook:  'facebook_*, instagram_*, threads_*',
      elevenlabs:'elevenlabs_*, text_to_speech, list_tts_voices',
      browser_use:'browser_use_*',
      tts:       'text_to_speech, list_tts_voices, get_tts_models',
    };
    const lines = enabledIntegrations.map(name => {
      const pattern = INTEGRATION_TOOL_PATTERNS[name.toLowerCase()];
      return pattern ? `• ${name}: ${pattern}` : `• ${name}`;
    });
    prompt += `\n\n── CONNECTED INTEGRATIONS ──\nCall these tools directly by name (schemas available via get_tool_schema):\n${lines.join('\n')}`;
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
export function buildTaskAssignmentsContext(pendingAssignments: Array<{
  task: { id: string; title: string; description?: string; dueDate?: string; priority: string };
  assignment: { id: string; type: string; scheduledAt: string; message?: string; recurring: string };
}>): string {
  if (!pendingAssignments || pendingAssignments.length === 0) {
    return '';
  }

  const lines: string[] = [
    '',
    '[TASK ASSIGNMENTS - ACTION REQUIRED]',
    'The following tasks have been assigned to you by the user and are now due:',
    '',
  ];

  for (const { task, assignment } of pendingAssignments) {
    const scheduledTime = new Date(assignment.scheduledAt).toLocaleString();
    lines.push(`📋 **${task.title}**`);
    if (task.description) lines.push(`   Description: ${task.description}`);
    lines.push(`   Assignment Type: ${assignment.type}`);
    lines.push(`   Scheduled For: ${scheduledTime}`);
    if (assignment.message) lines.push(`   User Message: "${assignment.message}"`);
    if (task.dueDate) lines.push(`   Task Due Date: ${new Date(task.dueDate).toLocaleDateString()}`);
    lines.push(`   Priority: ${task.priority}`);
    lines.push(`   Task ID: ${task.id} | Assignment ID: ${assignment.id}`);
    lines.push('');
  }

  lines.push('Please acknowledge and act on these assignments based on their type.');
  lines.push('After handling each assignment, inform the user and mark it complete.');

  return lines.join('\n');
}
