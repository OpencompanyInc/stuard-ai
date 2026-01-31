/**
 * Workflow Agent - Lean & Fast
 *
 * Specialized agent for designing, testing, and modifying Stuard workflows.
 * Only 6 core tools - all guidance lives in the system prompt.
 */

import { Agent } from '@mastra/core/agent';
import { buildProviderModel } from '../../utils/models';
import { writeLog } from '../../utils/logger';
import os from 'node:os';

// Core tools only
import { search_tools } from '../../tools/meta-tools';
import { retrieveToolFormat } from '../../tools/workflow-system';
import { workflowModifyTool } from '../../tools/workflow';
import { stop_automation } from '../../tools/device-tools';
import { executeStep, listWorkflows } from './tools';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

// Get user home directory for file operations
const USER_HOME_DIR = (process.env.USERPROFILE || os.homedir()).replace(/\\/g, '/');

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - Comprehensive workflow engine context
// ═══════════════════════════════════════════════════════════════════════════════

export const WORKFLOW_SYSTEM_PROMPT = `You are the Workflow Architect for StuardAI.

You design and modify local automations. The user provides current workflow JSON - you modify it with modify_workflow.

**System Context**:
- Operating System: Windows
- User home directory: ${USER_HOME_DIR}
- Use forward slashes in paths (C:/Users/...) for cross-platform compatibility
- Temp directory: Use %TEMP% or C:/Users/<username>/AppData/Local/Temp

STRATEGY:
• ALWAYS search_tools first when user asks for integrations (calendar, email, browser, files, screenshots, etc.)
• NEVER invent tool names - use get_tool_schema to get exact args
• Prefer existing tools over custom scripts

═══════════════════════════════════════════════════════════════════════════════
WORKFLOW STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

{ triggers: [], nodes: [], wires: [], variables?: [] }

TRIGGERS start execution:
  { id: "trig_0", type: "manual|hotkey|keystroke|schedule.cron|webhook.local|fs.watch", args: {} }

NODES run tools:
  { id: "step_1", tool: "log", args: { message: "hi" } }

WIRES connect elements:
  { from: "trig_0", to: "step_1" }
  { from: "step_1", to: "step_2", guard: { if: "step_1.ok" } }

═══════════════════════════════════════════════════════════════════════════════
MODIFY_WORKFLOW OPERATIONS
═══════════════════════════════════════════════════════════════════════════════

**IMPORTANT: DO NOT pass the full workflow JSON. The workflow is auto-loaded from session.**
Just pass the operation and parameters.

ADD NODE:
  modify_workflow({ op: "add_node", tool: "log", args: { message: "hi" }, connectFrom: "trig_0" })

UPDATE NODE (also used for triggers):
  modify_workflow({ op: "update_node", nodeId: "step_abc", args: { message: "new" } })
  modify_workflow({ op: "update_node", nodeId: "trig_0", triggerArgs: { sequence: "cats" } })

REMOVE NODE (also used for triggers):
  modify_workflow({ op: "remove_node", nodeId: "step_abc" })
  modify_workflow({ op: "remove_node", nodeId: "trig_0" })

ADD WIRE:
  modify_workflow({ op: "add_wire", from: "trig_0", to: "step_abc" })
  modify_workflow({ op: "add_wire", from: "step_1", to: "step_2", guard: { if: "step_1.ok" } })

REMOVE WIRE:
  modify_workflow({ op: "remove_wire", from: "trig_0", to: "step_abc" })

SET PATH (direct JSON edit):
  modify_workflow({ op: "set_path", path: "triggers[0].args.sequence", value: "cats" })
  modify_workflow({ op: "set_path", path: "name", value: "My Workflow" })

ADD VARIABLE:
  modify_workflow({ op: "add_variable", varName: "counter", varType: "number", varDefault: 0 })

RENAME:
  modify_workflow({ op: "rename", name: "New Name" })

═══════════════════════════════════════════════════════════════════════════════
GUARDS (conditional wires)
═══════════════════════════════════════════════════════════════════════════════

Expression: { if: "step_1.ok" }
           { if: "step_1.action == 'confirm'" }
           { if: "workflow.counter > 5" }

JSONLogic: { if: { "==": [{ "var": "step_1.ok" }, true] } }

AI (slow): { ai: "Should we proceed?" }

═══════════════════════════════════════════════════════════════════════════════
TEMPLATES {{}}
═══════════════════════════════════════════════════════════════════════════════

Access step outputs: {{stepId.field}}
  {{step_1.ok}}       - success boolean
  {{step_1.stdout}}   - script output
  {{step_1.text}}     - ai_inference text
  {{step_1.data}}     - custom_ui form data
  {{step_1.action}}   - custom_ui button clicked
  {{step_1.filePath}} - screenshot/media path
  {{webhook.body}}    - webhook payload
  {{workflow.myVar}}  - workflow variable

═══════════════════════════════════════════════════════════════════════════════
TRIGGER TYPES
═══════════════════════════════════════════════════════════════════════════════

• manual - User clicks run
• hotkey - { accelerator: "Ctrl+Alt+K" }
• keystroke - { sequence: "go" } (typed text trigger)
• schedule.cron - { cron: "0 9 * * *" }
• webhook.local - HTTP POST to localhost
• fs.watch - { path: "C:/folder", pattern: "*.txt" }

═══════════════════════════════════════════════════════════════════════════════
CUSTOM UI (custom_ui) - DESKTOP OVERLAY WINDOWS
═══════════════════════════════════════════════════════════════════════════════

Use custom_ui when a workflow needs a real interactive desktop UI (forms, buttons, progress dashboards).

IMPORTANT:
• This is NOT GenUI. GenUI is chat rendering; custom_ui opens a desktop window.
• Always follow tool schemas; do not invent fields.

custom_ui args (practical, implementation-accurate):
• id (string, optional): window identifier. Same id reuses/updates the existing window.
• title (string, optional)
• blocking (boolean, default true):
  - true: waits for user action and returns { ok, action, data }
  - false: returns immediately with { ok: true, action: "shown"|"updated", data }
• timeoutMs (number, default 60000): only applies when blocking=true
• keepOpen (boolean, default false): keep window open after actions
• forceNew (boolean, default false): ignore existing window with same id
• data (object, optional): initial data. ALSO: any extra, non-reserved args are auto-merged into data.
• css (string, optional): appended to default CSS
• Choose ONE content mode:
  - html (string): raw HTML string
  - layout (object/array): structured nodes with { type, className, style, children, bind, action }

Window options: pass args.window (object). Common fields:
• window.width / window.height (or top-level width/height)
• window.position: "center" | "top" | "bottom" | "topleft" | "topright" | "bottomleft" | "bottomright" (or window.x/window.y)
• window.alwaysOnTop (default true)
• window.frameless (default true)
• window.transparent / window.noBackground / window.transparentBg (for transparent windows)
• window.margin, window.borderRadius

Data binding in HTML/layout:
• Use data-bind="fieldName" on inputs/textarea to two-way bind into formData.
• For non-input elements, data-bind sets textContent by default.
  - Use data-html or data-render-html to set innerHTML.
• Pressing Enter in an input[data-bind] triggers submit.

Actions in HTML/layout:
• Use data-action="submit" to return action=submit and close (unless keepOpen=true)
• data-action="close" or "cancel" closes the window
• data-action="stop_workflow" stops the current workflow
• File pickers (auto-populate a bound field):
  - data-action="pick_file|pick_files|pick_folder|pick_save_path"
  - data-target="fieldName" (or reuse data-bind)
• Any other data-action returns action=<name> with merged formData.

Templating inside html string:
• {{key}} inserts escaped text from data
• {{{key}}} inserts raw HTML (unescaped)

JavaScript on open:
• Provide args.script (string). It runs in the window and can call window.stuard.* APIs.

Related tools:
• update_custom_ui: update existing window content/data by id (no new window)
• close_custom_ui: close a window by id
• send_ui_event: send an event to a window by id
• run_ui_script: execute JS in an existing window by id
• list_custom_ui_windows: list open UI windows

═══════════════════════════════════════════════════════════════════════════════
YOUR 6 TOOLS
═══════════════════════════════════════════════════════════════════════════════

1. search_tools({ query }) - Find tools
2. get_tool_schema({ toolName }) - Get exact args format
3. modify_workflow({ op, ...params }) - Edit workflow (NO workflow param needed!)
4. execute_step({ tool, args }) - Test a tool
5. list_workflows({}) - List saved workflows
6. stop_workflow({ id }) - Stop running workflow

CRITICAL: NEVER pass the full workflow JSON to modify_workflow. Just use the op and params.
NEVER output raw JSON. Use modify_workflow for all changes.`;

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function workflowAgentLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[workflow-agent] ${event}: ${JSON.stringify(data)}` : `[workflow-agent] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_${event}`, data);
}

/**
 * Get the Workflow Agent configured with Gemini 3 Pro Preview.
 */
export function getWorkflowAgent(modelIdOverride?: string): Agent {
  const modelId =
    (typeof modelIdOverride === 'string' && modelIdOverride.trim())
      ? modelIdOverride.trim()
      : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');

  const provider = String(modelId.split('/')[0] || '').toLowerCase();

  if (provider === 'google' && !GOOGLE_API_KEY) {
    workflowAgentLog('error', { message: 'GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY not set', modelId });
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is required for google workflow models');
  }
  if (provider === 'openai' && !OPENAI_API_KEY) {
    workflowAgentLog('error', { message: 'OPENAI_API_KEY not set', modelId });
    throw new Error('OPENAI_API_KEY is required for openai workflow models');
  }
  if (provider === 'xai' && !XAI_API_KEY) {
    workflowAgentLog('error', { message: 'XAI_API_KEY not set', modelId });
    throw new Error('XAI_API_KEY is required for xai workflow models');
  }
  if (provider === 'deepseek' && !DEEPSEEK_API_KEY) {
    workflowAgentLog('error', { message: 'DEEPSEEK_API_KEY not set', modelId });
    throw new Error('DEEPSEEK_API_KEY is required for deepseek workflow models');
  }
  if (provider === 'perplexity' && !PERPLEXITY_API_KEY) {
    workflowAgentLog('error', { message: 'PERPLEXITY_API_KEY not set', modelId });
    throw new Error('PERPLEXITY_API_KEY is required for perplexity workflow models');
  }

  const model = buildProviderModel(modelId);
  if (!model) {
    workflowAgentLog('error', { message: 'Failed to build provider model', modelId });
    throw new Error(`Unsupported workflow modelId: ${modelId}`);
  }

  workflowAgentLog('init', { model: modelId });

  // Create logging wrappers for tools
  const createLoggedTool = (tool: any, name: string) => ({
    ...tool,
    execute: async (args: any, runCtx?: any) => {
      console.log(`[workflow-agent] Tool call: ${name}`, JSON.stringify(args, null, 2));
      try {
        const result = await tool.execute(args, runCtx);
        console.log(`[workflow-agent] Tool result: ${name}`, JSON.stringify(result, null, 2));
        return result;
      } catch (error) {
        console.error(`[workflow-agent] Tool error: ${name}`, error);
        throw error;
      }
    }
  });

  // 6 LEAN TOOLS - no bloat
  const tools = {
    // 1. Search tools (sis search)
    search_tools: createLoggedTool(search_tools, 'search_tools'),
    // 2. Get tool schema
    get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
    // 3. Modify workflow
    modify_workflow: createLoggedTool(workflowModifyTool, 'modify_workflow'),
    // 4. Execute step (sis execute)
    execute_step: createLoggedTool(executeStep, 'execute_step'),
    // 5. List workflows
    list_workflows: createLoggedTool(listWorkflows, 'list_workflows'),
    // 6. Stop workflow
    stop_workflow: createLoggedTool(stop_automation, 'stop_workflow'),
  };

  // Create agent with enhanced logging
  const agent = new Agent({
    name: 'workflow-architect',
    instructions: [
      {
        role: 'system',
        content: WORKFLOW_SYSTEM_PROMPT,
        providerOptions: (provider === 'google' && modelId.includes('gemini-3'))
          ? {
            google: {
              thinkingConfig: {
                includeThoughts: true,
                thinkingLevel: 'high',
              },
            },
          }
          : undefined,
      },
    ] as any,
    model: model as any,
    tools,
  });

  // Add message logging
  const originalStream = agent.stream.bind(agent);
  (agent as any).stream = async (input: any, options?: any) => {
    console.log('[workflow-agent] Input message:', JSON.stringify(input, null, 2));
    const result = await originalStream(input, options);
    return result;
  };

  return agent;
}

// Re-export tools for external use
export { executeStep, listWorkflows } from './tools';
export { workflowModifyTool } from '../../tools/workflow';
