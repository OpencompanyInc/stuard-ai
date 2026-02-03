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

export type StuardEdge = {
  to: string;
  guard?: any;
  label?: string;
  loop?: LoopConfig;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
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
