/**
 * Workflow node-tool validation
 *
 * Shared validator that catches the failure mode where the workflow subagent
 * drops a Stuard orchestrator-only tool into a workflow node (which then
 * silently becomes a no-op at runtime) or invents a tool name that doesn't
 * exist anywhere in the registry. Both `create_workflow` and `modify_workflow`
 * surface the result so the agent sees it in the tool_result chunk and can
 * self-correct on the next turn.
 */

import { getToolRegistry } from './tool-registry';

export interface WorkflowNodeIssue {
  nodeId: string;
  tool: string;
  severity: 'error' | 'warning';
  reason: 'missing_tool' | 'orchestrator_only' | 'unknown_tool';
  message: string;
}

/**
 * Tools that exist on the Stuard / orchestrator side but are NOT valid
 * workflow node tools. The subagent commonly hallucinates these into nodes
 * because they appear in its own toolkit — the workflow runtime cannot
 * execute them and the node becomes a silent no-op.
 */
const ORCHESTRATOR_ONLY_TOOLS = new Set<string>([
  // Subagent / delegation entry points
  'route_to_workflow_agent',
  'delegate',
  'ask_user',
  'ask_orchestrator',
  'reply_to_subagent',
  'return_control',
  'report_progress',
  // Meta / discovery tools (only agents call these — workflows do not)
  'search_tools',
  'search_workflow_nodes',
  'search_workflow_docs',
  'get_tool_schema',
  'execute_tool',
  // Workflow-management tools (these manage workflows, they are not nodes)
  'create_workflow',
  'modify_workflow',
  'inspect_workflow',
  'load_workflow',
  'search_workflows',
  'deploy_workflow',
  'stop_automation',
  'execute_step',
]);

/**
 * Tools we can safely assume exist as workflow nodes even when the cloud-side
 * registry has no entry, because they are implemented locally on the desktop
 * (electron handlers) and are not always shipped into the cloud-ai registry.
 * Used to suppress false-positive "unknown tool" warnings.
 */
const KNOWN_LOCAL_NODE_TOOLS = new Set<string>([
  'log',
  'wait',
  'http_request',
  'run_command',
  'run_sequential',
  'run_parallel',
  'set_variable',
  'get_variable',
  'toggle_variable',
  'custom_ui',
  'update_custom_ui',
  'ui_packages_install',
  'ui_packages_status',
  'ui_packages_list',
  'ui_packages_remove',
  'ai_inference',
  'invoke_workflow',
  'call_function',
  'callNode',
]);

export function validateNodeTools(workflow: any): WorkflowNodeIssue[] {
  const issues: WorkflowNodeIssue[] = [];
  if (!workflow || !Array.isArray(workflow.nodes)) return issues;

  const registry = getToolRegistry();

  for (const node of workflow.nodes) {
    const id = String(node?.id || 'unknown');
    const tool = typeof node?.tool === 'string' ? node.tool.trim() : '';

    if (!tool) {
      issues.push({
        nodeId: id,
        tool: '',
        severity: 'error',
        reason: 'missing_tool',
        message: `Node ${id} has no tool — it will be a no-op at runtime. Set node.tool to a real workflow node, or remove the node.`,
      });
      continue;
    }

    if (ORCHESTRATOR_ONLY_TOOLS.has(tool)) {
      issues.push({
        nodeId: id,
        tool,
        severity: 'error',
        reason: 'orchestrator_only',
        message: `Node ${id} uses "${tool}", which is an orchestrator/agent tool, not a workflow node. The workflow runtime cannot execute it and the node will be a no-op. Replace it with an executable workflow tool — use search_workflow_nodes to find the right one.`,
      });
      continue;
    }

    const inRegistry = registry.has(tool);
    if (!inRegistry && !KNOWN_LOCAL_NODE_TOOLS.has(tool)) {
      issues.push({
        nodeId: id,
        tool,
        severity: 'warning',
        reason: 'unknown_tool',
        message: `Node ${id} uses "${tool}", which is not in the workflow tool catalog. If you invented the name, call search_workflow_nodes / get_tool_schema to find the correct one before this ships.`,
      });
    }
  }

  return issues;
}

/**
 * Render node issues into a compact human/agent-readable summary appended
 * to the tool's `message` field so the model cannot miss them.
 */
export function formatNodeIssuesSummary(issues: WorkflowNodeIssue[]): string {
  if (issues.length === 0) return '';
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const lines: string[] = [];
  lines.push('');
  lines.push(`⚠ Node-tool validation: ${errors.length} error(s), ${warnings.length} warning(s).`);
  for (const i of issues) {
    lines.push(`  • [${i.severity.toUpperCase()}] ${i.message}`);
  }
  lines.push('Fix these before returning control — call modify_workflow with update_node (change tool / args) or remove_node.');
  return lines.join('\n');
}
