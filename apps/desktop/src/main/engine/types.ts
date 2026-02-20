import { RouterContext } from '../tool-router';

export type LoopConfig = {
  type: 'forEach' | 'repeat' | 'while';
  items?: string;
  itemVar?: string;
  indexVar?: string;
  count?: number;
  conditionText?: string;
  maxIterations?: number;
  delayMs?: number;
};

export type StreamWireConfig = {
  /** Which field on the source step's output contains the streamId */
  sourceField?: string;
  /** Consumer mode: 'reactive' processes each chunk, 'batch' collects then processes */
  mode?: 'reactive' | 'batch';
  /** Ring buffer size override for this wire's subscription */
  bufferSize?: number;
  /** Chunk format: 'ref' (default for Python tools) passes zero-copy memory references, 'base64' (default for UI tools) encodes video frames as data URLs */
  format?: 'base64' | 'ref';
};

export type StuardEdge = {
  to: string;
  guard?: any;
  label?: string;
  loop?: LoopConfig;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  /** When set, this edge is a stream wire — the consumer step runs reactively on each chunk */
  stream?: StreamWireConfig;
};
export type StuardStep = {
  id: string;
  tool?: string;
  args?: any;
  next?: StuardEdge[];
  fallback?: { to: string };
  /** When true, this step waits for all incoming branches to complete before executing */
  waitForAll?: boolean;
};

export type StuardSpec = {
  id: string;
  name?: string;
  version?: string;
  autostart?: boolean;
  triggers?: Array<{ type: string; args?: any }>;
  steps?: StuardStep[];
  start?: string;
  globals?: {
    ai?: any;
    [key: string]: any;
  };
};

export type EngineContext = RouterContext & {
  stuardsDir: string;
};

