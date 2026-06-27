export type FlowWireClassification =
  | 'unconditional'
  | 'conditional_jsonlogic'
  | 'conditional_ai'
  | 'parallel_branch'
  | 'loop_entry'
  | 'loop_break'
  | 'convergence_target'
  | 'fallback_path';

export interface WorkflowValidationIssue {
  type: 'error' | 'warning';
  nodeId?: string;
  wireId?: string;
  message: string;
}

interface WorkflowInputParamLike {
  name?: string;
}

interface WorkflowTriggerLike {
  id: string;
  type: string;
  label: string;
  args: Record<string, any>;
  inputParams: WorkflowInputParamLike[];
}

interface WorkflowNodeLike {
  id: string;
  tool: string;
  label: string;
  args: Record<string, any>;
  fallbackTo?: string;
  waitForAll?: boolean;
}

interface WorkflowWireLike {
  index: number | null;
  from: string;
  to: string;
  guard?: any;
  label?: string;
  loop?: any;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  stream?: any;
  callNode?: boolean;
  synthetic?: boolean;
  syntheticKind?: 'fallback';
}

interface WorkflowLike {
  id: string;
  name: string;
  version: string;
  triggers: WorkflowTriggerLike[];
  nodes: WorkflowNodeLike[];
  wires: WorkflowWireLike[];
  variables: Array<{ name?: string; type?: string }>;
}

export interface WorkflowWireSummary {
  index: number | null;
  from: string;
  to: string;
  label?: string;
  guardSummary?: string;
  classifications: FlowWireClassification[];
  synthetic: boolean;
  syntheticKind?: 'fallback';
  loop?: any;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  stream?: boolean;
  callNode?: boolean;
  markers: string[];
}

export interface WorkflowElementFlowContext {
  id: string;
  kind: 'node' | 'trigger';
  exists: boolean;
  removed?: boolean;
  label?: string;
  tool?: string;
  triggerType?: string;
  inputParamNames?: string[];
  predecessorIds: string[];
  successorIds: string[];
  incomingWires: WorkflowWireSummary[];
  outgoingWires: WorkflowWireSummary[];
  startAdjacent: boolean;
  terminal: boolean;
  waitForAll: boolean;
  fallbackTo?: string;
}

export interface WorkflowTopologyOverview {
  workflowId: string;
  workflowName: string;
  counts: {
    triggers: number;
    nodes: number;
    wires: number;
    variables: number;
  };
  startTriggers: string[];
  endNodes: string[];
  disconnectedNodes: string[];
  hasCycles: boolean;
  branchCount: number;
  convergenceCount: number;
  triggerPaths: string[];
}

export interface WorkflowTopologyAnalysis {
  workflow: WorkflowLike;
  validation: {
    errors: number;
    warnings: number;
    issues: WorkflowValidationIssue[];
  };
  overview: WorkflowTopologyOverview;
  wires: WorkflowWireSummary[];
  actualWires: WorkflowWireSummary[];
  nodeContexts: WorkflowElementFlowContext[];
  triggerContexts: WorkflowElementFlowContext[];
}

interface AnalyzeWorkflowOptions {
  validationIssues?: WorkflowValidationIssue[];
  maxPathDepth?: number;
}

function asString(value: any, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function asObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeWorkflow(raw: any): WorkflowLike {
  const triggers = Array.isArray(raw?.triggers) ? raw.triggers : [];
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const wires = Array.isArray(raw?.wires) ? raw.wires : [];
  const variables = Array.isArray(raw?.variables) ? raw.variables : [];

  return {
    id: asString(raw?.id, 'workflow'),
    name: asString(raw?.name, 'Workflow'),
    version: asString(raw?.version, '1'),
    triggers: triggers.map((trigger: any, index: number) => ({
      id: asString(trigger?.id, `trigger_${index}`),
      type: asString(trigger?.type, 'manual'),
      label: asString(trigger?.label, asString(trigger?.type, `trigger_${index}`)),
      args: asObject(trigger?.args),
      inputParams: Array.isArray(trigger?.inputParams)
        ? trigger.inputParams.map((param: any) => ({ name: asString(param?.name) }))
        : [],
    })),
    nodes: nodes.map((node: any, index: number) => ({
      id: asString(node?.id, `step_${index}`),
      tool: asString(node?.tool, ''),
      label: asString(node?.label, asString(node?.tool, `step_${index}`)),
      args: asObject(node?.args),
      fallbackTo: node?.fallbackTo ? asString(node.fallbackTo) : undefined,
      waitForAll: Boolean(node?.waitForAll),
    })),
    wires: wires
      .filter((wire: any) => wire && typeof wire === 'object')
      .map((wire: any, index: number) => ({
        index,
        from: asString(wire?.from),
        to: asString(wire?.to),
        guard: wire?.guard,
        label: typeof wire?.label === 'string' ? wire.label : undefined,
        loop: wire?.loop,
        loopBreak: Boolean(wire?.loopBreak),
        loopFanoutMode: wire?.loopFanoutMode === 'parallel' ? 'parallel' : wire?.loopFanoutMode === 'wait' ? 'wait' : undefined,
        stream: wire?.stream,
        callNode: Boolean(wire?.callNode),
      })),
    variables: variables.map((variable: any) => ({
      name: typeof variable?.name === 'string' ? variable.name : undefined,
      type: typeof variable?.type === 'string' ? variable.type : undefined,
    })),
  };
}

function summarizeScalar(value: any): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(summarizeScalar).join(', ')}]`;
  if (typeof value === 'object') {
    if ('var' in value) {
      const varValue = (value as any).var;
      return Array.isArray(varValue) ? asString(varValue[0]) : asString(varValue);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function summarizeGuard(guard: any): string | undefined {
  if (guard == null || guard === '' || guard === true || guard === 'always' || guard === 'true') {
    return undefined;
  }
  if (guard === false || guard === 'false' || guard === 'never') {
    return 'false';
  }
  if (typeof guard === 'string') return guard;
  if (typeof guard !== 'object') return String(guard);

  if ('ai' in guard) {
    const instruction = asString((guard as any).ai?.instruction, 'ai');
    return `ai:${instruction.length > 60 ? instruction.slice(0, 57) + '...' : instruction}`;
  }

  if ('if' in guard) return summarizeGuard((guard as any).if);

  const op = Object.keys(guard)[0];
  const value = (guard as any)[op];

  if (!op) return JSON.stringify(guard);
  if (op === 'var') return summarizeScalar(guard);
  if ((op === 'and' || op === 'or') && Array.isArray(value)) {
    return value.map((part: any) => summarizeGuard(part) || 'condition').join(op === 'and' ? ' && ' : ' || ');
  }
  if ((op === '!' || op === 'not') && value !== undefined) {
    return `!${summarizeGuard(value) || summarizeScalar(value)}`;
  }
  if (Array.isArray(value) && value.length >= 2) {
    return `${summarizeScalar(value[0])} ${op} ${summarizeScalar(value[1])}`;
  }

  const compact = JSON.stringify(guard);
  return compact.length > 80 ? compact.slice(0, 77) + '...' : compact;
}

function detectGuardClassification(guard: any): FlowWireClassification {
  if (guard == null || guard === '' || guard === true || guard === 'always' || guard === 'true') {
    return 'unconditional';
  }
  const nestedIf = typeof guard === 'object' && guard ? (guard as any).if : undefined;
  if (
    typeof guard === 'object' &&
    guard &&
    ('ai' in guard || (nestedIf && typeof nestedIf === 'object' && 'ai' in nestedIf))
  ) {
    return 'conditional_ai';
  }
  return 'conditional_jsonlogic';
}

export function validateWorkflowGraph(workflow: WorkflowLike): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const triggerIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ type: 'error', nodeId: node.id, message: `Duplicate node ID: ${node.id}` });
    }
    nodeIds.add(node.id);
    if (!node.tool) {
      issues.push({ type: 'error', nodeId: node.id, message: `Node ${node.id} has no tool specified` });
    }
  }

  for (const trigger of workflow.triggers) {
    if (triggerIds.has(trigger.id)) {
      issues.push({ type: 'error', nodeId: trigger.id, message: `Duplicate trigger ID: ${trigger.id}` });
    }
    triggerIds.add(trigger.id);
  }

  const validSourceIds = new Set<string>([...nodeIds, ...triggerIds]);

  for (const wire of workflow.wires) {
    if (!validSourceIds.has(wire.from)) {
      issues.push({ type: 'error', wireId: wire.index == null ? undefined : String(wire.index), message: `Wire from non-existent node/trigger: ${wire.from}` });
    }
    if (!nodeIds.has(wire.to)) {
      issues.push({ type: 'error', wireId: wire.index == null ? undefined : String(wire.index), message: `Wire to non-existent node: ${wire.to}` });
    }
  }

  for (const node of workflow.nodes) {
    if (node.fallbackTo && !nodeIds.has(node.fallbackTo)) {
      issues.push({ type: 'error', nodeId: node.id, message: `fallbackTo points to non-existent node: ${node.fallbackTo}` });
    }
  }

  // Standalone (unwired) nodes are intentionally NOT flagged — a node can be
  // legitimately standalone depending on the use case (scratch nodes, nodes
  // invoked only on demand, work-in-progress wiring). The overview still
  // reports a neutral `disconnected` count for visibility; it just isn't a
  // warning the agent feels obliged to "fix".

  // Cycle detection. callNode wires are on-demand (not auto-traversed) and
  // `loop`/`loopBreak` wires are INTENTIONAL repetition constructs — neither
  // forms an accidental cycle, so exclude them. Only genuinely unintended
  // back-edges (plain wires looping back) are worth a warning.
  const adjacency = new Map<string, string[]>();
  for (const wire of workflow.wires) {
    if (wire.callNode) continue;
    if (wire.loop || wire.loopBreak) continue;
    if (!adjacency.has(wire.from)) adjacency.set(wire.from, []);
    adjacency.get(wire.from)!.push(wire.to);
  }
  for (const node of workflow.nodes) {
    if (node.fallbackTo) {
      if (!adjacency.has(node.id)) adjacency.set(node.id, []);
      adjacency.get(node.id)!.push(node.fallbackTo);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycleFrom = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    for (const nextId of adjacency.get(id) || []) {
      if (hasCycleFrom(nextId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const node of workflow.nodes) {
    visiting.clear();
    if (hasCycleFrom(node.id)) {
      issues.push({ type: 'warning', nodeId: node.id, message: `Cycle detected starting from ${node.id}` });
      break;
    }
  }

  if (workflow.triggers.length === 0) {
    issues.push({ type: 'warning', message: 'No triggers defined - workflow can only be run manually' });
  }

  return issues;
}

function buildTriggerPathSummary(
  triggerId: string,
  automaticOutgoingByFrom: Map<string, WorkflowWireSummary[]>,
  maxPathDepth: number,
): string {
  const visited = new Set<string>([triggerId]);
  const segments: string[] = [triggerId];
  let currentId = triggerId;
  let depth = 0;

  while (depth < maxPathDepth) {
    const outgoing = automaticOutgoingByFrom.get(currentId) || [];
    if (outgoing.length === 0) {
      segments.push('(end)');
      break;
    }

    if (outgoing.length > 1) {
      const branches = outgoing
        .map(wire => {
          const marker = wire.markers.length > 0 ? ` ${wire.markers.join(',')}` : '';
          return `${wire.to}${marker ? ` [${marker}]` : ''}`;
        })
        .join(' | ');
      segments.push(`[${branches}]`);
      break;
    }

    const wire = outgoing[0];
    const marker = wire.markers.length > 0 ? ` [${wire.markers.join(',')}]` : '';
    segments.push(`-> ${wire.to}${marker}`);

    if (visited.has(wire.to)) {
      segments.push('(cycle)');
      break;
    }

    visited.add(wire.to);
    currentId = wire.to;
    depth += 1;

    if (wire.markers.length > 0) {
      break;
    }
  }

  if (depth >= maxPathDepth) {
    segments.push('...');
  }

  return segments.join(' ');
}

export function analyzeWorkflowTopology(rawWorkflow: any, options: AnalyzeWorkflowOptions = {}): WorkflowTopologyAnalysis {
  const workflow = normalizeWorkflow(rawWorkflow);
  const validationIssues = options.validationIssues ?? validateWorkflowGraph(workflow);
  const maxPathDepth = options.maxPathDepth ?? 6;

  const triggerMap = new Map(workflow.triggers.map(trigger => [trigger.id, trigger]));
  const nodeMap = new Map(workflow.nodes.map(node => [node.id, node]));

  const fallbackWires: WorkflowWireLike[] = workflow.nodes
    .filter(node => Boolean(node.fallbackTo))
    .map(node => ({
      index: null,
      from: node.id,
      to: node.fallbackTo as string,
      synthetic: true,
      syntheticKind: 'fallback',
    }));

  const allRawWires = [...workflow.wires, ...fallbackWires];

  const automaticRawWires = allRawWires.filter(wire => wire.synthetic || !wire.callNode);

  const actualBranchCountByFrom = new Map<string, number>();
  for (const wire of workflow.wires) {
    if (wire.callNode) continue;
    actualBranchCountByFrom.set(wire.from, (actualBranchCountByFrom.get(wire.from) || 0) + 1);
  }

  const automaticIncomingCountByTo = new Map<string, number>();
  for (const wire of automaticRawWires) {
    automaticIncomingCountByTo.set(wire.to, (automaticIncomingCountByTo.get(wire.to) || 0) + 1);
  }

  const summarizeWire = (wire: WorkflowWireLike): WorkflowWireSummary => {
    const classifications: FlowWireClassification[] = [];
    const targetNode = nodeMap.get(wire.to);

    if (wire.synthetic && wire.syntheticKind === 'fallback') {
      classifications.push('fallback_path');
    } else {
      classifications.push(detectGuardClassification(wire.guard));
      if ((actualBranchCountByFrom.get(wire.from) || 0) > 1) {
        classifications.push('parallel_branch');
      }
      if (wire.loop) classifications.push('loop_entry');
      if (wire.loopBreak) classifications.push('loop_break');
    }

    if (targetNode?.waitForAll && (automaticIncomingCountByTo.get(wire.to) || 0) > 1) {
      classifications.push('convergence_target');
    }

    const markers: string[] = [];
    if (classifications.includes('conditional_ai')) {
      markers.push(`guard=ai${wire.guard ? `:${summarizeGuard(wire.guard)}` : ''}`);
    } else if (classifications.includes('conditional_jsonlogic')) {
      const guardSummary = summarizeGuard(wire.guard);
      markers.push(`guard=${guardSummary || 'jsonlogic'}`);
    }
    if (wire.loop) {
      const loopType = asString((wire.loop as any)?.type, 'loop');
      markers.push(`loop=${loopType}`);
    }
    if (wire.loopBreak) markers.push('loopBreak');
    if (classifications.includes('convergence_target')) markers.push('waitForAll-target');
    if (classifications.includes('fallback_path')) markers.push('fallbackTo');
    if (wire.callNode) markers.push('callNode');
    if (wire.stream) markers.push('stream');
    if (wire.label) markers.push(`label=${JSON.stringify(wire.label)}`);

    return {
      index: wire.index,
      from: wire.from,
      to: wire.to,
      label: wire.label,
      guardSummary: summarizeGuard(wire.guard),
      classifications: uniq(classifications) as FlowWireClassification[],
      synthetic: Boolean(wire.synthetic),
      syntheticKind: wire.syntheticKind,
      loop: wire.loop,
      loopBreak: wire.loopBreak,
      loopFanoutMode: wire.loopFanoutMode,
      stream: Boolean(wire.stream),
      callNode: Boolean(wire.callNode),
      markers,
    };
  };

  const wireSummaries = allRawWires.map(summarizeWire);
  const actualWireSummaries = wireSummaries.filter(wire => !wire.synthetic);

  const flowOutgoingByFrom = new Map<string, WorkflowWireSummary[]>();
  const flowIncomingByTo = new Map<string, WorkflowWireSummary[]>();
  const automaticOutgoingByFrom = new Map<string, WorkflowWireSummary[]>();
  const automaticAdjacency = new Map<string, string[]>();

  for (const wire of wireSummaries) {
    if (!flowOutgoingByFrom.has(wire.from)) flowOutgoingByFrom.set(wire.from, []);
    flowOutgoingByFrom.get(wire.from)!.push(wire);

    if (!flowIncomingByTo.has(wire.to)) flowIncomingByTo.set(wire.to, []);
    flowIncomingByTo.get(wire.to)!.push(wire);

    if (wire.synthetic || !wire.callNode) {
      if (!automaticOutgoingByFrom.has(wire.from)) automaticOutgoingByFrom.set(wire.from, []);
      automaticOutgoingByFrom.get(wire.from)!.push(wire);

      if (!automaticAdjacency.has(wire.from)) automaticAdjacency.set(wire.from, []);
      automaticAdjacency.get(wire.from)!.push(wire.to);
    }
  }

  const buildContext = (id: string, kind: 'node' | 'trigger'): WorkflowElementFlowContext => {
    const node = nodeMap.get(id);
    const trigger = triggerMap.get(id);
    const outgoingWires = flowOutgoingByFrom.get(id) || [];
    const incomingWires = flowIncomingByTo.get(id) || [];
    const automaticOutgoing = automaticOutgoingByFrom.get(id) || [];

    return {
      id,
      kind,
      exists: true,
      label: node?.label || trigger?.label,
      tool: node?.tool,
      triggerType: trigger?.type,
      inputParamNames: kind === 'trigger' ? trigger?.inputParams.map(param => asString(param?.name)).filter(Boolean) : undefined,
      predecessorIds: uniq(incomingWires.map(wire => wire.from)),
      successorIds: uniq(outgoingWires.map(wire => wire.to)),
      incomingWires,
      outgoingWires,
      startAdjacent: incomingWires.some(wire => triggerMap.has(wire.from)),
      terminal: automaticOutgoing.length === 0,
      waitForAll: Boolean(node?.waitForAll),
      fallbackTo: node?.fallbackTo,
    };
  };

  const nodeContexts = workflow.nodes.map(node => buildContext(node.id, 'node'));
  const triggerContexts = workflow.triggers.map(trigger => buildContext(trigger.id, 'trigger'));

  // Standalone nodes are no longer a validation warning, but the overview still
  // surfaces them as a neutral topology stat. Compute directly from wiring.
  const connectedNodeIds = new Set<string>();
  for (const wire of workflow.wires) {
    connectedNodeIds.add(wire.from);
    connectedNodeIds.add(wire.to);
  }
  for (const node of workflow.nodes) {
    if (node.fallbackTo) {
      connectedNodeIds.add(node.id);
      connectedNodeIds.add(node.fallbackTo);
    }
  }
  const disconnectedNodes = workflow.nodes.length > 1
    ? workflow.nodes.filter(node => !connectedNodeIds.has(node.id)).map(node => node.id)
    : [];

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const hasCycleFrom = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    for (const nextId of automaticAdjacency.get(id) || []) {
      if (hasCycleFrom(nextId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  let hasCycles = false;
  for (const id of [...workflow.triggers.map(trigger => trigger.id), ...workflow.nodes.map(node => node.id)]) {
    visiting.clear();
    if (hasCycleFrom(id)) {
      hasCycles = true;
      break;
    }
  }

  const convergenceCount = workflow.nodes.filter(node => node.waitForAll && (automaticIncomingCountByTo.get(node.id) || 0) > 1).length;
  const branchCount = Array.from(actualBranchCountByFrom.values()).filter(count => count > 1).length;

  const triggerPaths = workflow.triggers.map(trigger =>
    `${trigger.id}: ${buildTriggerPathSummary(trigger.id, automaticOutgoingByFrom, maxPathDepth)}`
  );

  return {
    workflow,
    validation: {
      errors: validationIssues.filter(issue => issue.type === 'error').length,
      warnings: validationIssues.filter(issue => issue.type === 'warning').length,
      issues: validationIssues,
    },
    overview: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      counts: {
        triggers: workflow.triggers.length,
        nodes: workflow.nodes.length,
        wires: workflow.wires.length,
        variables: workflow.variables.length,
      },
      startTriggers: workflow.triggers.map(trigger => trigger.id),
      endNodes: nodeContexts.filter(context => context.terminal).map(context => context.id),
      disconnectedNodes,
      hasCycles,
      branchCount,
      convergenceCount,
      triggerPaths,
    },
    wires: wireSummaries,
    actualWires: actualWireSummaries,
    nodeContexts,
    triggerContexts,
  };
}

export function getFlowContextById(
  analysis: WorkflowTopologyAnalysis,
  id: string,
): WorkflowElementFlowContext | null {
  return [...analysis.nodeContexts, ...analysis.triggerContexts].find(context => context.id === id) || null;
}

export function getWireBySelector(
  analysis: WorkflowTopologyAnalysis,
  selector: { from?: string; to?: string; index?: number | null },
): WorkflowWireSummary | null {
  if (typeof selector.index === 'number') {
    return analysis.actualWires.find(wire => wire.index === selector.index) || null;
  }

  if (selector.from && selector.to) {
    return analysis.wires.find(wire => wire.from === selector.from && wire.to === selector.to) || null;
  }

  return null;
}

function formatValidationSummary(validation: WorkflowTopologyAnalysis['validation']): string {
  if (validation.errors === 0 && validation.warnings === 0) return 'clean';
  if (validation.errors > 0 && validation.warnings > 0) return `${validation.errors} errors, ${validation.warnings} warnings`;
  if (validation.errors > 0) return `${validation.errors} errors`;
  return `${validation.warnings} warnings`;
}

function formatIssue(issue: WorkflowValidationIssue): string {
  const owner = issue.nodeId ? ` [${issue.nodeId}]` : issue.wireId ? ` [wire ${issue.wireId}]` : '';
  return `- ${issue.type.toUpperCase()}: ${issue.message}${owner}`;
}

function formatTriggerLine(trigger: WorkflowTriggerLike): string {
  const parts = [`- ${trigger.id}`, trigger.type];
  if (trigger.label && trigger.label !== trigger.type) parts.push(`label=${JSON.stringify(trigger.label)}`);
  const inputNames = trigger.inputParams.map(param => asString(param?.name)).filter(Boolean);
  parts.push(`inputs=${inputNames.length > 0 ? inputNames.join(', ') : 'none'}`);
  return parts.join(' | ');
}

function formatNodeLine(node: WorkflowNodeLike): string {
  const parts = [`- ${node.id}`, node.tool || 'noop'];
  if (node.label && node.label !== node.tool) parts.push(`label=${JSON.stringify(node.label)}`);
  if (node.waitForAll) parts.push('waitForAll');
  if (node.fallbackTo) parts.push(`fallbackTo=${node.fallbackTo}`);
  return parts.join(' | ');
}

function formatWireLine(wire: WorkflowWireSummary): string {
  const arrow = wire.synthetic && wire.syntheticKind === 'fallback' ? '=>' : '->';
  const markerText = wire.markers.length > 0 ? ` [${wire.markers.join(', ')}]` : '';
  return `- ${wire.from} ${arrow} ${wire.to}${markerText}`;
}

export function formatWorkflowSchematic(rawWorkflow: any, options: AnalyzeWorkflowOptions = {}): string {
  const analysis = analyzeWorkflowTopology(rawWorkflow, options);
  const lines: string[] = [];
  const validationPreview = analysis.validation.issues.slice(0, 8);
  const extraIssues = Math.max(analysis.validation.issues.length - validationPreview.length, 0);

  lines.push('WORKFLOW SCHEMATIC');
  lines.push(`id: ${analysis.overview.workflowId}`);
  lines.push(`name: ${analysis.overview.workflowName}`);
  lines.push(`validation: ${formatValidationSummary(analysis.validation)}`);
  lines.push(
    `counts: triggers=${analysis.overview.counts.triggers}, nodes=${analysis.overview.counts.nodes}, wires=${analysis.overview.counts.wires}, variables=${analysis.overview.counts.variables}`
  );
  lines.push(
    `topology: branches=${analysis.overview.branchCount}, convergence=${analysis.overview.convergenceCount}, cycles=${analysis.overview.hasCycles ? 'yes' : 'no'}, disconnected=${analysis.overview.disconnectedNodes.length}`
  );

  if (validationPreview.length > 0) {
    lines.push('issues:');
    lines.push(...validationPreview.map(formatIssue));
    if (extraIssues > 0) {
      lines.push(`- ... +${extraIssues} more issues`);
    }
  }

  lines.push('triggers:');
  if (analysis.workflow.triggers.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...analysis.workflow.triggers.map(formatTriggerLine));
  }

  lines.push('nodes:');
  if (analysis.workflow.nodes.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...analysis.workflow.nodes.map(formatNodeLine));
  }

  lines.push('wires:');
  if (analysis.wires.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...analysis.wires.map(formatWireLine));
  }

  lines.push('paths:');
  if (analysis.overview.triggerPaths.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...analysis.overview.triggerPaths.map(path => `- ${path}`));
  }

  return lines.join('\n');
}
