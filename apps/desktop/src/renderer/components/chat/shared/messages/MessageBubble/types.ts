import type React from 'react';
import type { ToolCall } from '../../../../../hooks/useAgent';

export interface ContextPath {
  path: string;
  name: string;
  isDirectory: boolean;
}

export type ContentSegment =
  | { kind: 'text'; value: string }
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'audio'; src: string }
  | { kind: 'file'; src: string }
  | { kind: 'youtube'; videoId: string; url: string }
  | { kind: 'link_preview'; url: string }
  | { kind: 'genui'; component: string; args: any; id: string }
  | { kind: 'genui_loading'; component: string; title?: string };

export type TraceStatus = 'complete' | 'active' | 'pending' | 'error';

export interface AssistantTraceStepData {
  id: string;
  kind: 'reasoning' | 'tool' | 'status' | 'text';
  label: React.ReactNode;
  status: TraceStatus;
  content?: string;
  tool?: ToolCall;
  nested?: boolean;
  subagentId?: string;
  subagentKind?: string;
  statusVariant?: 'compacting';
  statusMeta?: {
    round?: number;
    maxRounds?: number;
    tokensBefore?: number;
    tokensAfter?: number;
    subagentKind?: string;
    subagentLabel?: string;
  };
}

export type DelegationTask = { subagent: string; instruction?: string };
