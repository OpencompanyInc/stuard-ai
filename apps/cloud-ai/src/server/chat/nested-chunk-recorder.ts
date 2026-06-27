/**
 * Nested subagent chunk recorder.
 *
 * Delegated subagents stream their work back to the client out-of-band via
 * `subagent-runtime.emitToClient` (`subagent_event` WS messages) — that path
 * never touches the `streamChunks` array the orchestrator's stream-runner
 * builds and persists locally with the assistant message. The result: on
 * reopening a conversation, delegation rectangles render with no children (the
 * subagent's reasoning / text / tool calls were never saved).
 *
 * This module lets the in-process subagent runtime weave those events into the
 * same chunk log, keyed by the chat requestId, so they get persisted locally
 * (via `storeMessageLocally(... assistantMetadata.streamChunks)`) and replay
 * exactly like the live view. The recording happens in cloud-ai; the storage is
 * the local encrypted SQLite (per-device), matching the peer-to-peer model.
 */
import type { StreamChunkRecord } from './types';

// requestId → live streamChunks array owned by the active stream-runner turn.
const recorders = new Map<string, StreamChunkRecord[]>();

export function registerNestedRecorder(key: string | undefined, chunks: StreamChunkRecord[]): void {
  if (!key) return;
  recorders.set(key, chunks);
}

export function unregisterNestedRecorder(key: string | undefined): void {
  if (!key) return;
  recorders.delete(key);
}

function humanizeKind(kind: string): string {
  const cleaned = String(kind || 'subagent')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Subagent';
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function findNestedTool(
  chunks: StreamChunkRecord[],
  toolId: string,
  toolName: string,
  subagentId: string,
): Extract<StreamChunkRecord, { type: 'tool' }> | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c.type === 'tool' && toolId && c.tool?.id === toolId) return c;
  }
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (
      c.type === 'tool'
      && c.tool?.nested
      && (c.tool?.subagentId || '') === subagentId
      && c.tool?.tool === toolName
      && c.tool?.status === 'called'
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Translate a subagent emit event into a persisted nested chunk and append /
 * merge it into the registered streamChunks array. Mirrors the desktop's live
 * reconstruction (useAgent.ts subagent_event handling) so reopened traces look
 * identical to live ones. Safe no-op when no recorder is registered.
 */
export function recordNestedSubagentEvent(
  key: string | undefined,
  event: string,
  data: any,
  subagentId: string,
  kind?: string,
): void {
  if (!key) return;
  const chunks = recorders.get(key);
  if (!chunks) return;

  try {
    switch (event) {
      case 'started': {
        const id = `subagent-started-${subagentId || Date.now()}`;
        if (chunks.some((c) => c.type === 'status' && c.id === id)) return;
        const k = kind || data?.kind || data?.label || 'subagent';
        chunks.push({
          type: 'status',
          id,
          label: `${humanizeKind(k)} agent started`,
          state: 'complete',
          nested: true,
          subagentId,
          meta: { subagentKind: kind || data?.kind },
        });
        return;
      }

      case 'delta': {
        const text = typeof data?.text === 'string' ? data.text : '';
        if (!text) return;
        const last = chunks[chunks.length - 1];
        if (last && last.type === 'text' && last.nested && last.subagentId === subagentId) {
          last.content += text;
        } else {
          chunks.push({ type: 'text', content: text, nested: true, subagentId });
        }
        return;
      }

      case 'reasoning': {
        const text = typeof data?.text === 'string' ? data.text : '';
        if (!text) return;
        const last = chunks[chunks.length - 1];
        if (last && last.type === 'reasoning' && last.nested && last.subagentId === subagentId) {
          last.content += text;
        } else {
          chunks.push({ type: 'reasoning', content: text, nested: true, subagentId });
        }
        return;
      }

      case 'tool_call': {
        const toolName = data?.tool || data?.name || 'tool';
        const toolId = data?.toolCallId || data?.id || `sub-tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const existing = findNestedTool(chunks, data?.toolCallId || data?.id || '', toolName, subagentId);
        if (existing) {
          existing.tool = {
            ...existing.tool,
            tool: existing.tool.tool || toolName,
            args: typeof data?.args !== 'undefined' ? data.args : existing.tool.args,
            subagentId,
            nested: true,
          };
          return;
        }
        chunks.push({
          type: 'tool',
          tool: {
            id: toolId,
            tool: toolName,
            status: 'called',
            args: data?.args,
            timestamp: Date.now(),
            description: data?.description,
            subagentId,
            nested: true,
          },
        });
        return;
      }

      case 'tool_result': {
        const toolName = data?.tool || data?.name || data?.toolName || 'tool';
        const rawStatus = typeof data?.status === 'string' ? data.status.toLowerCase() : '';
        const isError =
          rawStatus === 'error'
          || rawStatus === 'failed'
          || rawStatus === 'timeout'
          || typeof data?.error !== 'undefined'
          || data?.result?.ok === false;
        const existing = findNestedTool(chunks, data?.toolCallId || data?.id || '', toolName, subagentId);
        if (existing) {
          existing.tool = {
            ...existing.tool,
            status: isError ? 'error' : 'completed',
            result: isError ? existing.tool.result : data?.result,
            error: data?.error || data?.result?.error || (isError ? 'Tool failed' : undefined),
            subagentId,
            nested: true,
          };
        } else {
          chunks.push({
            type: 'tool',
            tool: {
              id: data?.toolCallId || data?.id || `sub-tc-${Date.now()}`,
              tool: toolName,
              status: isError ? 'error' : 'completed',
              result: isError ? undefined : data?.result,
              error: data?.error,
              timestamp: Date.now(),
              subagentId,
              nested: true,
            },
          });
        }
        return;
      }

      case 'completed':
      case 'error':
      case 'cancelled': {
        const id = `subagent-finished-${subagentId || Date.now()}`;
        if (chunks.some((c) => c.type === 'status' && c.id === id)) return;
        const label = event === 'completed'
          ? 'Subagent finished'
          : event === 'cancelled'
            ? 'Subagent cancelled'
            : 'Subagent hit an error';
        chunks.push({
          type: 'status',
          id,
          label,
          state: event === 'completed' ? 'complete' : 'error',
          nested: true,
          subagentId,
          meta: { subagentKind: kind },
        });
        return;
      }
    }
  } catch {
    // recording is best-effort — never disrupt the live stream
  }
}
