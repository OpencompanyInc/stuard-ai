import type { ReactNode } from 'react';
import type { Bot } from './types';

export type BotsJsonResponse<T = Record<string, unknown>> = { ok: boolean; error?: string } & T;

export type BlueprintPreflightProbeResult = {
  ok?: boolean;
  status: 'pass' | 'fail' | 'warn' | 'unsupported';
  detail: string;
};

export interface BotsConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

export interface BotsModelSelectorProps {
  /** Explicit model id, or '' when the agent routes automatically. */
  modelId: string;
  /** Called with the chosen model id, or '' when the user picks Auto. */
  onChange: (modelId: string) => void;
}

export interface IBotsPlatform {
  readOnly?: boolean;

  /**
   * Host gate for Meta-family triggers (Instagram). When false/absent the
   * trigger picker hides Instagram trigger types (mirrors META_INTEGRATION_ENABLED).
   */
  metaIntegrationEnabled?: boolean;

  /**
   * Host-provided full model picker (the same UI used in chat). When absent,
   * agent settings fall back to the coarse fast/balanced/smart tier select.
   */
  renderModelSelector?(props: BotsModelSelectorProps): ReactNode;

  /**
   * Modern confirm/alert UI. When provided, the host app renders its own
   * on-brand dialog instead of the native window.confirm/alert. Optional —
   * callers fall back to the native dialog when these are absent.
   */
  confirm?(opts: BotsConfirmOptions): Promise<boolean>;
  notify?(opts: Omit<BotsConfirmOptions, 'cancelLabel'>): Promise<void>;

  list(): Promise<BotsJsonResponse<{ bots?: Bot[] }>>;
  create?(payload: Record<string, unknown>): Promise<BotsJsonResponse<{ bot?: Bot }>>;
  update?(id: string, patch: Record<string, unknown>): Promise<BotsJsonResponse>;
  updateConfig?(id: string, patch: Record<string, unknown>): Promise<BotsJsonResponse>;
  delete(id: string): Promise<BotsJsonResponse>;
  deploy?(id: string): Promise<BotsJsonResponse>;
  stopOnVm?(id: string): Promise<BotsJsonResponse>;
  getVmStatus?(id: string): Promise<BotsJsonResponse<{ bot?: unknown }>>;
  runNow?(id: string): Promise<BotsJsonResponse>;
  triggerOnVm?(id: string): Promise<BotsJsonResponse>;
  setStatus?(id: string, status: string): Promise<BotsJsonResponse>;

  getConfig?(id: string): Promise<BotsJsonResponse<{ config?: unknown }>>;
  listTasks?(id: string): Promise<BotsJsonResponse<{ tasks?: unknown[] }>>;
  getWakeUpLog?(id: string, limit?: number): Promise<BotsJsonResponse<{ logs?: unknown[] }>>;

  getAvailableTools?(): Promise<BotsJsonResponse<{ tools?: string[] }>>;
  testSetup?(input: Record<string, unknown>): Promise<BotsJsonResponse<{ summary?: string; checks?: unknown[] }>>;
  runPreflightProbe?(payload: {
    request: { probe: string; args?: Record<string, unknown> };
    cloudHttpBase: string;
    authToken: string | null;
  }): Promise<BlueprintPreflightProbeResult>;

  addTrigger?(id: string, input: Record<string, unknown>): Promise<BotsJsonResponse<{ trigger?: unknown }>>;
  removeTrigger?(id: string, triggerId: string): Promise<BotsJsonResponse>;
  updateTrigger?(id: string, triggerId: string, patch: Record<string, unknown>): Promise<BotsJsonResponse>;

  memoryListCards?(id: string, status?: string): Promise<BotsJsonResponse<{ cards?: unknown[] }>>;
  memoryCreateCard?(
    id: string,
    input: { title: string; notes?: string; status?: string },
  ): Promise<BotsJsonResponse<{ card?: unknown }>>;
  memoryUpdateCard?(
    id: string,
    cardId: string,
    patch: { title?: string; notes?: string; status?: string },
  ): Promise<BotsJsonResponse<{ card?: unknown }>>;
  memoryDeleteCard?(id: string, cardId: string): Promise<BotsJsonResponse>;
  memoryListRunLog?(id: string, limit?: number): Promise<BotsJsonResponse<{ runLog?: unknown[] }>>;

  skillsList?(): Promise<BotsJsonResponse<{ skills?: unknown[] }>>;
  pickFolder?(options?: { title?: string }): Promise<BotsJsonResponse<{ folders?: Array<{ path: string }> }>>;
  webhooksLocalUrl?(slug?: string): Promise<BotsJsonResponse<{ url?: string }>>;

  /** Auth token for cloud-ai blueprint SSE (desktop create-agent). */
  getAccessToken?(): Promise<string | null>;
  /** cloud-ai HTTP base URL for blueprint SSE (desktop create-agent). */
  getCloudAiBaseUrl?(): string;

  onBotMemoryChanged?(cb: (data: { botId: string }) => void): () => void;
  onProactiveUpdate?(cb: (data: unknown) => void): () => void;
  onSkillsUpdated?(cb: (skills: unknown[]) => void): () => void;
}
