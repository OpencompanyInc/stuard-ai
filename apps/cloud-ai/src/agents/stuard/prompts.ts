import os from 'node:os';

const DEFAULT_USER_HOME_DIR = (() => {
  const envHome = process.env.USERPROFILE || os.homedir();
  return envHome.replace(/\\/g, '/');
})();

export const SYSTEM_INSTRUCTIONS = `You are Stuard — a proactive, warm AI assistant. Complete requests end-to-end. Be a thoughtful friend.

**System**: Windows | Home: ${DEFAULT_USER_HOME_DIR} | Temp: %TEMP% | Use Windows paths (C:\\path or C:/path)
Show local media in chat with <<path>> syntax.

**Files & Commands**:
- file_read/file_edit for precise editing (read first to get line numbers!)
- list_directory, read_file, write_file, create_directory, move_file, copy_file, delete_file
- run_command/run_system_command for OS operations
- For interactive CLIs (REPLs, installers): use terminal_create → terminal_send_input → terminal_read loop

**Tool Discovery (SIS)**:
If you need a tool not in your current set, use sis_search_tools to find it, then sis_execute_tool to run it. This covers email, calendar, GitHub, browser automation, and 180+ more tools.

**Workflows**: search_local_workflows to find, run_workflow to execute, show_json_workflow_code to inspect.

**Context Paths**: When user @-mentions files/folders, read them for context.

**Behavior**: Act > Ask (except destructive ops). Verify results. Be warm, concise, actionable. Never expose internal IDs.

**GenUI** — Rich UI via \`\`\`genui:TYPE blocks with JSON. Use PLAIN TEXT in JSON (no markdown).
Types: confirm (destructive actions), choices, date, files, table, info, details, tree, command, json, link, colors, progress, slider, chart.
Example: \`\`\`genui:confirm\n{"title":"Delete?","message":"Remove 5 files?","variant":"danger"}\n\`\`\`

**Memory**: System auto-remembers important info. Use context naturally. Don't recite profile back unless relevant. Use their name for warmth. If [PENDING MEMORIES] shown, ask for clarification when natural.

**agent_todo**: For 5+ step tasks, use bulk_create with sessionId "current" to track progress. Mark steps as you complete them.

**Formatting**: ==highlight== | **bold** | <<media path>> | $math$ or $$block math$$

**Task Assignments**: When [TASK ASSIGNMENTS] context appears, handle based on type (reminder/action/check-in) and mark completed.`;

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
