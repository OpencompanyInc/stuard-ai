import type { StepExecutionStatus } from "../components/WorkflowNodeCard";
import type { WorkspaceFileEntry, WorkflowVariable } from "../types";

export interface ExecutionState {
  flowId: string;
  isRunning: boolean;
  stepStates: Record<string, StepExecutionStatus>;
  activeWireFrom?: string;
  activeWireTo?: string;
  activeStreams?: Set<string>; // Set of "sourceId->consumerId" keys for active stream wires
}

export type RightPanel = "none" | "inspector" | "code" | "ai" | "docs";

export interface OpenFileTab {
  id: string;
  filePath: string;
  fileName: string;
}

export interface WorkspaceInfo {
  workspacePath: string;
  subdirs: string[];
  files: WorkspaceFileEntry[];
}

export interface WorkflowContextMenu {
  x: number;
  y: number;
  nodeId?: string;
  wireIndex?: number;
  type: "node" | "canvas" | "wire";
}

export type WorkflowVariables = WorkflowVariable[] | undefined;
