export interface WorkflowItem {
  id: string;
  name?: string;
  updatedAt?: string;
  isRunning?: boolean;
  version?: string;
  marketplaceSlug?: string;
  /** When true, this workflow is locked - code hidden, AI cannot modify, edits disabled */
  locked?: boolean;
  /** Folder this workflow belongs to (undefined = root) */
  folder?: string;
  /** Whether this workflow uses workspace directory format (flowId/main.stuard) */
  isWorkspace?: boolean;
}

/** A file or directory entry within a workflow workspace */
export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  updatedAt?: string;
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

/** Input parameter definition for workflow-as-function */
export interface WorkflowInputParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'array';
  description?: string;
  required?: boolean;
  defaultValue?: any;
}

/** Output field definition for workflow return value */
export interface WorkflowOutputField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'array';
  description?: string;
}

export interface DesignerTrigger {
  id: string;
  type: string;
  label: string;
  args: any;
  position: { x: number; y: number };
  /** Input parameters this workflow accepts (for workflow-as-function use) */
  inputParams?: WorkflowInputParam[];
}

/** Loop configuration for a wire - defines how the target node should be executed repeatedly */
export interface WireLoopConfig {
  /** Loop type: 'forEach' iterates over items, 'while' continues while condition is true, 'repeat' runs N times */
  type: 'forEach' | 'while' | 'repeat';
  
  /** For 'forEach': the array/list to iterate over (can be a variable reference like {{step.items}}) */
  items?: string;
  
  /** For 'forEach': the variable name to store the current item (default: 'item') */
  itemVar?: string;
  
  /** For 'forEach': the variable name to store the current index (default: 'index') */
  indexVar?: string;
  
  /** For 'while': the condition to check before each iteration (JSONLogic format) */
  condition?: any;
  
  /** For 'repeat': the number of times to repeat */
  count?: number;
  
  /** Maximum iterations allowed (safety limit, default: 1000) */
  maxIterations?: number;
  
  /** Delay in ms between iterations (default: 0) */
  delayMs?: number;
}

/** Stream wire configuration — when set, the wire carries real-time data chunks */
export interface StreamWireConfig {
  /** Which field on the source step's output contains the streamId */
  sourceField?: string;
  /** Consumer mode — always reactive (runs consumer step once per chunk) */
  mode?: 'reactive';
  /** Ring buffer size override for this wire's subscription */
  bufferSize?: number;
  /** Chunk format: 'ref' (default for Python tools) passes zero-copy memory references, 'base64' (default for UI tools) encodes video frames as data URLs */
  format?: 'base64' | 'ref';
}

export interface DesignerWire {
  from: string;
  to: string;
  guard?: any;
  label?: string;
  /** Optional loop configuration - when set, the target node will be executed in a loop */
  loop?: WireLoopConfig;
  /** When true, this wire marks the end of a loop scope - nodes after this wire run outside the loop */
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  /** When set, this wire is a stream wire — the consumer step runs reactively on each chunk */
  stream?: StreamWireConfig;
  /** When true, this wire is a callNode wire — the target node is invoked on-demand by the
   *  source custom_ui via stuard.callNode(). It's not part of the normal execution flow;
   *  it's a "limb" that the UI can extend/retract at will. Rendered as a dashed teal line. */
  callNode?: boolean;
}

/** A workflow-level variable that can be referenced by any step */
export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'list';
  /** Scope: 'workflow' = shared across all stuard files, 'local' = scoped to a single stuard file. Default: 'workflow' */
  scope?: 'workflow' | 'local';
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
  /** Output schema for workflow return value (for workflow-as-function use) */
  outputSchema?: WorkflowOutputField[];
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
    next?: Array<{ to: string; guard?: any; label?: string; loop?: any; loopBreak?: boolean; loopFanoutMode?: 'wait' | 'parallel'; stream?: StreamWireConfig }>;
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
