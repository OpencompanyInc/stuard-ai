/**
 * Step Persister — saves conversation state between tool calls.
 *
 * Backends:
 *   local   — always on; writes to the Python agent's encrypted SQLite via execLocalTool / sendToAgent
 *   supabase — optional; gated by user preference (sync_conversations)
 *   vm      — conditional; when the agent runs inside a VM, routes through sendToAgent instead of execLocalTool
 *
 * Usage:
 *   const persister = new StepPersister({ ... });
 *   // inside onStepFinish:
 *   await persister.persistStep({ stepNumber, text, toolCalls, toolResults, usage });
 */

import { writeLog } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepData {
  stepNumber: number;
  text: string;
  toolCalls: Array<{ id: string; tool: string; args: any }>;
  toolResults: Array<{ toolCallId: string; toolName: string; result: any }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface PersisterBackends {
  /** Always-on local backend. Supply the save function (execLocalTool or sendToAgent wrapper). */
  local: (
    conversationId: string,
    role: 'assistant' | 'tool',
    content: string,
    options?: { tool_calls?: any[]; tool_results?: any[]; metadata?: Record<string, any> },
  ) => Promise<void>;

  /** Optional Supabase backend. null/undefined = disabled. */
  supabase?: ((
    conversationId: string,
    text: string,
    metadata?: Record<string, any>,
  ) => Promise<void>) | null;

  /** Optional VM backend. When set, used instead of local for routing. */
  vm?: ((
    conversationId: string,
    role: 'assistant' | 'tool',
    content: string,
    options?: { tool_calls?: any[]; tool_results?: any[]; metadata?: Record<string, any> },
  ) => Promise<void>) | null;
}

export interface StepPersisterOptions {
  /** Conversation ID getter — may return null if conversation hasn't been created yet. */
  getConversationId: () => string | null;
  backends: PersisterBackends;
  /** Extra metadata attached to every persisted message (e.g. mode, tier, modelId). */
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class StepPersister {
  private opts: StepPersisterOptions;
  private lastPersistedStep = 0;

  constructor(opts: StepPersisterOptions) {
    this.opts = opts;
  }

  /**
   * Persist a single agent step (called from onStepFinish).
   * Saves tool-call messages + partial assistant text to all enabled backends.
   * Fire-and-forget safe — errors are logged but never thrown.
   */
  async persistStep(step: StepData): Promise<void> {
    const conversationId = this.opts.getConversationId();
    if (!conversationId) return; // conversation not created yet, skip
    if (step.stepNumber <= this.lastPersistedStep) return; // already persisted
    this.lastPersistedStep = step.stepNumber;

    const meta = {
      ...this.opts.metadata,
      stepNumber: step.stepNumber,
      usage: step.usage,
    };

    const promises: Promise<void>[] = [];

    // --- Save tool calls as tool-role messages ---
    if (step.toolCalls.length > 0) {
      const toolContent = step.toolCalls
        .map(tc => `[tool_call] ${tc.tool}`)
        .join('\n');

      const toolOpts = {
        tool_calls: step.toolCalls.map(tc => ({
          id: tc.id,
          tool: tc.tool,
          status: 'completed',
          args: tc.args,
          timestamp: Date.now(),
        })),
        tool_results: step.toolResults.map(tr => ({
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          result: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result ?? '').slice(0, 4000),
        })),
        metadata: meta,
      };

      // Local or VM
      const localSave = this.opts.backends.vm || this.opts.backends.local;
      promises.push(
        localSave(conversationId, 'tool', toolContent, toolOpts).catch(err => {
          writeLog('step_persist_local_tool_error', { conversationId, step: step.stepNumber, error: String(err) });
        }),
      );
    }

    // --- Save partial assistant text (if model produced text this step) ---
    if (step.text) {
      const localSave = this.opts.backends.vm || this.opts.backends.local;
      promises.push(
        localSave(conversationId, 'assistant', step.text, { metadata: { ...meta, partial: true } }).catch(err => {
          writeLog('step_persist_local_assistant_error', { conversationId, step: step.stepNumber, error: String(err) });
        }),
      );

      // Supabase (optional)
      if (this.opts.backends.supabase) {
        promises.push(
          this.opts.backends.supabase(conversationId, step.text, {
            ...meta,
            partial: true,
            toolCalls: step.toolCalls.map(tc => ({
              id: tc.id,
              tool: tc.tool,
              status: 'completed',
              args: tc.args,
              timestamp: Date.now(),
            })),
          }).catch(err => {
            writeLog('step_persist_supabase_error', { conversationId, step: step.stepNumber, error: String(err) });
          }),
        );
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /** Mark final step — lets caller know persistence is up to date. */
  get lastStep(): number {
    return this.lastPersistedStep;
  }

  /** Whether the Supabase backend is enabled and has persisted at least one step. */
  get supabasePersisted(): boolean {
    return this.lastPersistedStep > 0 && !!this.opts.backends.supabase;
  }
}

// ---------------------------------------------------------------------------
// Factory helpers — create backend functions from existing infra
// ---------------------------------------------------------------------------

/**
 * Build the local backend using execLocalTool (cloud-ai talking to local Python agent).
 * Must be called inside a withClientBridge context.
 */
export function makeLocalBackend(execLocalTool: Function) {
  return async (
    conversationId: string,
    role: 'assistant' | 'tool',
    content: string,
    options?: { tool_calls?: any[]; tool_results?: any[]; metadata?: Record<string, any> },
  ) => {
    await execLocalTool('message_add', {
      conversation_id: conversationId,
      role,
      content,
      ...options,
    }, undefined, 10_000);
  };
}

/**
 * Build the Supabase backend using the existing addAssistantMessage function.
 */
export function makeSupabaseBackend(
  addAssistantMessage: (userId: string, conversationId: string, text: string, metadata?: any, forcePersist?: boolean) => Promise<void>,
  userId: string,
  forcePersist = false,
) {
  return async (
    conversationId: string,
    text: string,
    metadata?: Record<string, any>,
  ) => {
    await addAssistantMessage(userId, conversationId, text, metadata, forcePersist);
  };
}

/**
 * Build the VM backend using sendToAgent (for VM-hosted agents).
 */
export function makeVMBackend(sendToAgent: Function) {
  return async (
    conversationId: string,
    role: 'assistant' | 'tool',
    content: string,
    options?: { tool_calls?: any[]; tool_results?: any[]; metadata?: Record<string, any> },
  ) => {
    await sendToAgent({
      type: 'tool_exec',
      tool: 'message_add',
      args: {
        conversation_id: conversationId,
        role,
        content,
        ...options,
      },
    }, 10_000);
  };
}
