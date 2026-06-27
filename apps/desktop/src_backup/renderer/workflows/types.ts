export interface WorkflowItem {
  id: string;
  name?: string;
  updatedAt?: string;
  isRunning?: boolean;
  version?: string;
  marketplaceSlug?: string;
  /** When true, this workflow is locked - code hidden, AI cannot modify, edits disabled */
  locked?: boolean;
}

export interface DesignerNode {
  id: string;
  type: string;
  tool?: string;
  label: string;
  args: any;
  fallbackTo?: string;
  position: { x: number; y: number };
  /** When true, this node waits for all incoming branches to complete before executing */
  waitForAll?: boolean;
}

export interface DesignerTrigger {
  id: string;
  type: string;
  label: string;
  args: any;
  position: { x: number; y: number };
}

export interface DesignerWire {
  from: string;
  to: string;
  guard?: any;
  label?: string;
}

/** A workflow-level variable that can be referenced by any step */
export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'list';
  defaultValue: any;
  description?: string;
  /** When true, variable value persists across workflow restarts. When false (default), resets to defaultValue on deploy/start */
  persistState?: boolean;
}

export interface DesignerModel {
  id: string;
  name: string;
  version: string;
  description?: string;
  autostart?: boolean;
  triggers: DesignerTrigger[];
  nodes: DesignerNode[];
  wires: DesignerWire[];
  requirements?: string;
  scripts?: Record<string, string>;
  /** Workflow-level variables that can be referenced using {{workflow.varName}} */
  variables?: WorkflowVariable[];
  /** When true, the workflow is locked - code is hidden, AI cannot modify, manual edits disabled */
  locked?: boolean;
  /** Slug of the marketplace workflow this was imported from (for tracking locked status) */
  marketplaceSlug?: string;
}

export interface StuardSpec {
  id: string;
  name: string;
  version: string;
  autostart?: boolean;
  requirements?: string;
  scripts?: Record<string, string>;
  triggers: Array<{ type: string; args: any }>;
  steps: Array<{
    id: string;
    tool: string;
    args: any;
    next?: Array<{ to: string; guard?: any; label?: string }>;
    fallback?: { to: string };
    /** When true, this step waits for all incoming branches to complete before executing */
    waitForAll?: boolean;
  }>;
  start?: string;
}

export interface PaletteItem {
  k: string;
  t: string;
  label: string;
  args?: any;
}

export interface LogEntry {
  ts: string;
  message: string;
  flowId: string;
}

export interface StuardLogEntry {
  ts: string;
  message: string;
  stuardId: string;
}
