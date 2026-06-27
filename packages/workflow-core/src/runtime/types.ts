/**
 * Shared workflow *runtime* types — the execution contract consumed by both
 * the desktop Electron engine (apps/desktop/src/main/engine) and the VM engine
 * (apps/vm-agent/src/vm-engine.ts).
 *
 * These describe a compiled, executable workflow (StuardSpec) — distinct from
 * the authoring/designer types in ../types.ts (DesignerModel etc.). Platform
 * wiring (variable stores, tool transports, auth) lives in each host, NOT here.
 */

/** How a single workflow step's tool should be dispatched by the host. */
export type StuardStepKind =
  | 'cloud'
  | 'local'
  | 'vm-native'
  | 'orchestration'
  | 'desktop-relay';

export interface LoopConfig {
  type: 'forEach' | 'repeat' | 'while';
  items?: string;
  itemVar?: string;
  indexVar?: string;
  count?: number;
  conditionText?: string;
  maxIterations?: number;
  delayMs?: number;
}

export interface StreamWireConfig {
  sourceField?: string;
  mode?: 'reactive' | 'batch';
  bufferSize?: number;
  format?: 'base64' | 'ref';
}

export interface StuardEdge {
  to: string;
  guard?: any;
  label?: string;
  loop?: LoopConfig;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  stream?: StreamWireConfig;
}

export interface StuardStep {
  id: string;
  label?: string;
  tool?: string;
  kind?: StuardStepKind;
  designerType?: string;
  args?: any;
  next?: StuardEdge[];
  fallback?: { to: string };
  waitForAll?: boolean;
}

export interface StuardTrigger {
  type: string;
  args?: any;
  id?: string;
  start?: string;
  startNodes?: string[];
  inputParams?: any[];
}

export interface StuardSpec {
  id: string;
  name?: string;
  version?: string;
  autostart?: boolean;
  triggers?: StuardTrigger[];
  steps?: StuardStep[];
  start?: string;
  globals?: { ai?: any; [key: string]: any };
}
