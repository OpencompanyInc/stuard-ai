import { Agent } from '@mastra/core/agent';
import type { ModelChoice } from '../router/model-router';
import { getDefaultModelForCategory } from '../pricing';
import { buildProviderModel } from '../utils/models';
import { waitTool } from '../tools/wait';
import { runSequentialTool, runParallelTool } from '../tools/workflow-system';
import { analyzeMediaTool } from '../tools/analyze-media';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../tools/list-headless-agent-tasks';
import { outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail } from '../tools/outlook-tools';
import { github_get_me, github_list_repos, github_list_issues, github_create_issue } from '../tools/github-tools';
import { google_get_userinfo, gmail_send_message, calendar_list_events, calendar_create_event, calendar_delete_event, tasks_list, sheets_read_range, sheets_create_spreadsheet, sheets_write_range, sheets_append_rows, sheets_clear_range, sheets_get_spreadsheet, sheets_add_sheet, sheets_format_cells, sheets_batch_update_values, sheets_delete_rows_columns, sheets_sort_range, sheets_auto_resize, docs_get_document, docs_create_document, docs_write_text } from '../tools/google-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, move_file, calendar_crud, task_crud, task_reminders, planner_list_items, capture_media, describe_media_capture_capabilities, run_command, search_local_workflows, import_workflow, run_automation, stop_automation, search_past_conversations, get_conversation_context, agent_decision, agent_extract, glob, grep } from '../tools/device-tools';
import { web_search } from '../tools/perplexity-tools';

const HEADLESS_SYSTEM_INSTRUCTIONS = `You are the Headless Execution Agent for StuardAI.
You are a highly optimized, non-conversational agent designed for autonomous task execution within a workflow.

OBJECTIVE:
- Complete the assigned task efficiently using available tools.
- Output strict structured data if a schema is provided.
- Do NOT engage in small talk, pleasantries, or conversational filler.
- Do NOT ask for clarification unless the task is completely impossible with current information.
- If you encounter an error, retry with a different strategy or tool parameters.
- If you cannot complete the task after retries, report the failure concisely.

OPERATING PROCEDURE:
1. Analyze the instruction and any input context.
2. Formulate a plan to achieve the goal using tools.
3. Execute tools (observe -> act -> verify).
4. When the task is complete, return the final result.

OUTPUT FORMAT:
- Your final response must be the result of the task.
- If an output schema is provided, ensure your final response matches it exactly.
`;

/**
 * Get a headless agent configured for task execution.
 * This agent is stripped of personality and focused on tools.
 */
export function getHeadlessAgent(
  model: ModelChoice = 'fast',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  allowedTools?: string[],
  customSystemPrompt?: string
): Agent {
  const allTools = {
    wait: waitTool,
    run_sequential: runSequentialTool,
    run_parallel: runParallelTool,
    analyze_media: analyzeMediaTool,
    web_search,
    deploy_headless_agent: deployHeadlessAgent,
    get_headless_agent_status: getHeadlessAgentStatus,
    list_headless_agent_tasks: listHeadlessAgentTasks,

    // Integrations
    outlook_get_me,
    outlook_list_messages,
    outlook_search_messages,
    outlook_send_mail,
    google_get_userinfo,
    gmail_send_message,
    calendar_list_events,
    calendar_create_event,
    calendar_delete_event,
    tasks_list,
    sheets_read_range,
    sheets_create_spreadsheet,
    sheets_write_range,
    sheets_append_rows,
    sheets_clear_range,
    sheets_get_spreadsheet,
    sheets_add_sheet,
    sheets_format_cells,
    sheets_batch_update_values,
    sheets_delete_rows_columns,
    sheets_sort_range,
    sheets_auto_resize,
    docs_get_document,
    docs_create_document,
    docs_write_text,
    github_get_me,
    github_list_repos,
    github_list_issues,
    github_create_issue,

    // Local Device Tools
    send_hotkey,
    glob,
    grep,
    capture_media,
    describe_media_capture_capabilities,
    run_command,
    // Memory
    search_past_conversations,
    get_conversation_context,
    calendar_crud,
    task_crud,
    task_reminders,
    planner_list_items,
    list_directory,
    read_file,
    write_file,
    create_directory,
    move_file,
    search_local_workflows,
    import_workflow,
    run_automation,
    stop_automation,
    // AI reasoning helpers (not agent_node to avoid infinite recursion)
    agent_decision,
    agent_extract,
  } as const;

  const tools: Record<string, any> = { ...mcpTools };

  // Always available tools
  const coreTools = [
    'wait', 'run_sequential', 'run_parallel', 'analyze_media', 'web_search',
    'deploy_headless_agent', 'get_headless_agent_status', 'list_headless_agent_tasks',
    'send_hotkey', 'glob', 'grep', 'capture_media',
    'describe_media_capture_capabilities', 'run_command',
    'calendar_crud', 'task_crud', 'task_reminders', 'planner_list_items',
    'list_directory', 'read_file', 'write_file', 'create_directory', 'move_file',
    'search_local_workflows',
    'import_workflow', 'run_automation', 'stop_automation',
    'search_past_conversations', 'get_conversation_context',
    'agent_decision', 'agent_extract',
  ];

  coreTools.forEach(name => {
    if ((allTools as any)[name]) {
      tools[name] = (allTools as any)[name];
    }
  });

  if (enabledIntegrations.includes('outlook')) {
    tools.outlook_get_me = outlook_get_me;
    tools.outlook_list_messages = outlook_list_messages;
    tools.outlook_search_messages = outlook_search_messages;
    tools.outlook_send_mail = outlook_send_mail;
  }

  if (enabledIntegrations.includes('google')) {
    tools.google_get_userinfo = google_get_userinfo;
    tools.gmail_send_message = gmail_send_message;
    tools.calendar_list_events = calendar_list_events;
    tools.calendar_create_event = calendar_create_event;
    tools.calendar_delete_event = calendar_delete_event;
    tools.tasks_list = tasks_list;
    tools.sheets_read_range = sheets_read_range;
    tools.sheets_create_spreadsheet = sheets_create_spreadsheet;
    tools.sheets_write_range = sheets_write_range;
    tools.sheets_append_rows = sheets_append_rows;
    tools.sheets_clear_range = sheets_clear_range;
    tools.sheets_get_spreadsheet = sheets_get_spreadsheet;
    tools.sheets_add_sheet = sheets_add_sheet;
    tools.sheets_format_cells = sheets_format_cells;
    tools.sheets_batch_update_values = sheets_batch_update_values;
    tools.sheets_delete_rows_columns = sheets_delete_rows_columns;
    tools.sheets_sort_range = sheets_sort_range;
    tools.sheets_auto_resize = sheets_auto_resize;
    tools.docs_get_document = docs_get_document;
    tools.docs_create_document = docs_create_document;
    tools.docs_write_text = docs_write_text;
  }

  if (enabledIntegrations.includes('github')) {
    tools.github_get_me = github_get_me;
    tools.github_list_repos = github_list_repos;
    tools.github_list_issues = github_list_issues;
    tools.github_create_issue = github_create_issue;
  }

  // If specific tools are allowed, filter the final tools list
  if (allowedTools && allowedTools.length > 0) {
    const filteredTools: Record<string, any> = {};
    // Always allow basic flow/control tools if they exist
    const essentialTools = ['wait', 'run_sequential', 'run_parallel'];

    [...allowedTools, ...essentialTools].forEach(name => {
      if (tools[name]) {
        filteredTools[name] = tools[name];
      }
    });

    // Replace tools with filtered list
    Object.keys(tools).forEach(key => delete tools[key]);
    Object.assign(tools, filteredTools);
  }

  // Model selection based on tier
  let selectedModel: any;
  const defaultId = getDefaultModelForCategory(model as any);
  selectedModel = buildProviderModel(defaultId);

  if (!selectedModel) {
    if (model === 'fast') {
      selectedModel = buildProviderModel('xai/grok-4-1-fast');
    } else if (model === 'balanced') {
      selectedModel = buildProviderModel('xai/grok-4-1-fast');
    } else {
      selectedModel = buildProviderModel('google/gemini-2.5-pro');
    }
  }

  const instructions = [
    {
      role: 'system',
      content: HEADLESS_SYSTEM_INSTRUCTIONS,
    },
  ];

  if (typeof customSystemPrompt === 'string' && customSystemPrompt.trim()) {
    instructions.push({
      role: 'system',
      content: `Additional system instructions:\n${customSystemPrompt.trim()}`,
    } as any);
  }

  return new Agent({
    id: 'stuard-headless',
    name: 'stuard-headless',
    instructions: instructions as any,
    model: selectedModel,
    tools,
  });
}

