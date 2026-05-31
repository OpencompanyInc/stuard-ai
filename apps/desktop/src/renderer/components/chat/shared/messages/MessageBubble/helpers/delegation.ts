import type React from 'react';
import type { ToolCall } from '../../../../../../hooks/useAgent';
import type { AssistantTraceStepData, DelegationTask, TraceStatus } from '../types';
import { getToolStepLabel } from './toolStepLabel';

// Tool names that represent delegation to a subagent — rendered as a distinct rectangle card
// so long-running delegated work is easy to track at a glance.
// `delegate` is the orchestrator's specialised-subagent tool; `deploy_headless_agent`
// is the general user-facing background-agent tool. Those are the only two real
// spawn entry points — every other name (subagent_create, spawn_agent, run_subagent,
// deploy_subagent) was a dead alias.
export const DELEGATION_TOOL_NAMES = new Set(['delegate', 'deploy_headless_agent', 'route_to_workflow_agent']);

// Workflow orchestration wrappers whose sub-steps stream in as nested children.
// These render as an execution-group rectangle (fork→branches for parallel,
// ordered timeline for sequential/loop) — distinct from subagent delegation.
export const EXECUTION_GROUP_TOOL_NAMES = new Set(['run_parallel', 'run_sequential', 'loop_executor']);

export type ExecutionGroupKind = 'parallel' | 'sequential';

export function resolveToolName(tool: ToolCall): string {
  return tool.tool === 'execute_tool' && tool.args?.tool_name
    ? String(tool.args.tool_name)
    : tool.tool;
}

export function isDelegationToolCall(tool: ToolCall): boolean {
  return DELEGATION_TOOL_NAMES.has(resolveToolName(tool));
}

export function isExecutionGroupToolCall(tool: ToolCall): boolean {
  return EXECUTION_GROUP_TOOL_NAMES.has(resolveToolName(tool));
}

export function getExecutionGroupKind(tool: ToolCall): ExecutionGroupKind {
  return resolveToolName(tool) === 'run_parallel' ? 'parallel' : 'sequential';
}

export function extractDelegationTasks(tool: ToolCall): DelegationTask[] {
  const args = (tool.args || {}) as Record<string, any>;
  const toolName = resolveToolName(tool);
  // `delegate` uses args.tasks[] with {subagent, instruction}
  if (Array.isArray(args.tasks) && args.tasks.length > 0) {
    return args.tasks.map((t: any) => ({
      subagent: String(t?.subagent ?? 'subagent'),
      instruction: typeof t?.instruction === 'string' ? t.instruction : undefined,
    }));
  }
  // `route_to_workflow_agent` — kind is implicit in the tool name
  const kind = toolName === 'route_to_workflow_agent'
    ? 'workflow'
    : (args.subagent || args.kind || args.agent || args.agent_kind || 'subagent');
  // `deploy_headless_agent` — flat args
  const instruction = args.objective || args.task || args.prompt || args.instruction;
  return [{
    subagent: String(kind),
    instruction: typeof instruction === 'string' ? instruction : undefined,
  }];
}

export function normalizeSubagentName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+agent$/i, '')
    .replace(/[\s-]+/g, '_');
}

export function getStepLabelText(label: React.ReactNode): string {
  return typeof label === 'string' ? label : '';
}

export function deriveDelegationStatus(parentStatus: TraceStatus, childSteps: AssistantTraceStepData[]): TraceStatus {
  if (childSteps.some((child) => child.status === 'error')) return 'error';

  const terminalLabel = childSteps
    .map((child) => getStepLabelText(child.label).toLowerCase())
    .find((label) => label.includes('subagent finished') || label.includes('subagent hit an error') || label.includes('subagent cancelled'));

  if (terminalLabel?.includes('error') || terminalLabel?.includes('cancelled')) return 'error';
  if (terminalLabel?.includes('finished')) return 'complete';
  if (childSteps.some((child) => child.status === 'active' || child.status === 'pending')) return 'active';
  return parentStatus;
}

/** Derive wrapper status from child branch steps (mirrors delegation cards). */
export function deriveExecutionGroupStatus(parentStatus: TraceStatus, childSteps: AssistantTraceStepData[]): TraceStatus {
  if (childSteps.some((child) => child.status === 'error')) return 'error';
  if (parentStatus === 'complete') return 'complete';
  if (parentStatus === 'error') return 'error';
  if (childSteps.some((child) => child.status === 'active' || child.status === 'pending')) return 'active';
  if (childSteps.length > 0 && childSteps.every((child) => child.status === 'complete' || child.status === 'error')) {
    return 'complete';
  }
  return parentStatus;
}

export function buildExecutionGroupStep(
  parentStep: AssistantTraceStepData,
  childSteps: AssistantTraceStepData[],
): AssistantTraceStepData {
  return {
    ...parentStep,
    status: deriveExecutionGroupStatus(parentStep.status, childSteps),
  };
}

function mapToolCallStatusToTrace(status: ToolCall['status'], parentStatus: TraceStatus): TraceStatus {
  if (status === 'error') return 'error';
  if (parentStatus === 'complete' || parentStatus === 'error') {
    return status === 'error' ? 'error' : 'complete';
  }
  if (status === 'running') return 'active';
  if (status === 'called') return 'pending';
  if (status === 'completed') return 'complete';
  return parentStatus;
}

/** When the wrapper finished, normalize stale pending/active branch rows for display. */
export function normalizeExecutionGroupChildren(
  children: AssistantTraceStepData[],
  groupStatus: TraceStatus,
): AssistantTraceStepData[] {
  if (groupStatus !== 'complete' && groupStatus !== 'error') return children;
  return children.map((child) => {
    if (child.status !== 'pending' && child.status !== 'active') return child;
    const nextTraceStatus: TraceStatus = groupStatus === 'error' ? 'error' : 'complete';
    const nextToolStatus: ToolCall['status'] =
      groupStatus === 'error' ? 'error' : 'completed';
    return {
      ...child,
      status: nextTraceStatus,
      tool: child.tool ? { ...child.tool, status: nextToolStatus } : child.tool,
    };
  });
}

/**
 * Reconstruct branch rows from the wrapper's args.steps + result.results when
 * per-step stream events never reached the client (common for orchestrator
 * run_parallel/run_sequential where nested safeToolWrite has no writer).
 */
export function buildExecutionGroupFallbackChildren(
  parentTool: ToolCall,
  parentTraceStatus: TraceStatus,
): AssistantTraceStepData[] {
  const args = (parentTool.args || {}) as Record<string, any>;
  const result = (parentTool.result || {}) as Record<string, any>;
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (steps.length === 0) return [];

  const results = Array.isArray(result.results) ? result.results : [];
  const parentId = parentTool.id || 'wrap-unknown';
  const isSequential = resolveToolName(parentTool) !== 'run_parallel';

  return steps.flatMap((stepDef: any, index: number) => {
    const toolName = String(stepDef?.tool || '').trim();
    if (!toolName) return [];

    const resultEntry = results[index];
    const ok = resultEntry?.ok ?? parentTool.status === 'completed';
    const parentDone = parentTool.status === 'completed' || parentTraceStatus === 'complete';
    const parentLive = parentTool.status === 'running' || parentTool.status === 'called';
    const toolStatus: ToolCall['status'] =
      resultEntry?.error || ok === false
        ? 'error'
        : parentDone
          ? 'completed'
          : parentLive
            ? (isSequential && index > 0 ? 'called' : 'running')
            : 'completed';

    const tc: ToolCall = {
      id: `${parentId}:${index}`,
      tool: toolName,
      status: toolStatus,
      args: stepDef?.args,
      result: resultEntry?.result ?? resultEntry,
      error: resultEntry?.error,
      timestamp: parentTool.timestamp,
      parentToolId: parentId,
      nested: true,
    };

    return [{
      id: tc.id!,
      kind: 'tool' as const,
      label: getToolStepLabel(tc),
      status: mapToolCallStatusToTrace(toolStatus, parentTraceStatus),
      tool: tc,
      nested: true,
    }];
  });
}

export function buildDelegationTaskStep(
  parentStep: AssistantTraceStepData,
  task: DelegationTask,
  taskIndex: number,
  childSteps: AssistantTraceStepData[],
): AssistantTraceStepData {
  const parentTool = parentStep.tool!;
  const { tasks: _tasks, ...restArgs } = (parentTool.args || {}) as Record<string, any>;
  const instructionArgs = task.instruction ? { instruction: task.instruction } : {};
  const taskTool: ToolCall = {
    ...parentTool,
    id: `${parentTool.id || parentStep.id}:task-${taskIndex}`,
    args: {
      ...restArgs,
      subagent: task.subagent,
      ...instructionArgs,
    },
  };

  return {
    ...parentStep,
    id: `${parentStep.id}:task-${taskIndex}`,
    status: deriveDelegationStatus(parentStep.status, childSteps),
    tool: taskTool,
  };
}

export function assignDelegationChildrenToTasks(
  tasks: DelegationTask[],
  childEntries: Array<{ step: AssistantTraceStepData; idx: number }>,
): Array<{ children: AssistantTraceStepData[]; lastChildIdx: number }> {
  const groupsBySubagent = new Map<string, Array<{ step: AssistantTraceStepData; idx: number }>>();
  const unassigned: Array<{ step: AssistantTraceStepData; idx: number }> = [];

  for (const entry of childEntries) {
    const subagentId = entry.step.subagentId?.trim();
    if (!subagentId) {
      unassigned.push(entry);
      continue;
    }
    const group = groupsBySubagent.get(subagentId) || [];
    group.push(entry);
    groupsBySubagent.set(subagentId, group);
  }

  const assignments = tasks.map(() => ({ children: [] as AssistantTraceStepData[], lastChildIdx: -1 }));
  const usedTaskIndexes = new Set<number>();
  const deferredGroups: Array<Array<{ step: AssistantTraceStepData; idx: number }>> = [];

  const findAvailableTaskByKind = (kind: string): number => {
    const normalizedKind = normalizeSubagentName(kind);
    if (!normalizedKind) return -1;

    const matches = tasks
      .map((task, index) => ({ index, task }))
      .filter(({ index, task }) => !usedTaskIndexes.has(index) && normalizeSubagentName(task.subagent) === normalizedKind);

    return matches.length === 1 ? matches[0].index : -1;
  };

  for (const group of groupsBySubagent.values()) {
    const kind = group.find(({ step }) => step.subagentKind || step.statusMeta?.subagentKind)?.step.subagentKind
      || group.find(({ step }) => step.statusMeta?.subagentKind)?.step.statusMeta?.subagentKind
      || '';
    const taskIndex = findAvailableTaskByKind(kind);
    if (taskIndex >= 0) {
      assignments[taskIndex].children.push(...group.map(({ step }) => step));
      assignments[taskIndex].lastChildIdx = Math.max(assignments[taskIndex].lastChildIdx, ...group.map(({ idx }) => idx));
      usedTaskIndexes.add(taskIndex);
    } else {
      deferredGroups.push(group);
    }
  }

  for (const group of deferredGroups) {
    const taskIndex = tasks.findIndex((_, index) => !usedTaskIndexes.has(index));
    const targetIndex = taskIndex >= 0 ? taskIndex : Math.max(0, tasks.length - 1);
    assignments[targetIndex].children.push(...group.map(({ step }) => step));
    assignments[targetIndex].lastChildIdx = Math.max(assignments[targetIndex].lastChildIdx, ...group.map(({ idx }) => idx));
    usedTaskIndexes.add(targetIndex);
  }

  if (unassigned.length > 0 && assignments.length > 0) {
    assignments[0].children.push(...unassigned.map(({ step }) => step));
    assignments[0].lastChildIdx = Math.max(assignments[0].lastChildIdx, ...unassigned.map(({ idx }) => idx));
  }

  return assignments;
}
