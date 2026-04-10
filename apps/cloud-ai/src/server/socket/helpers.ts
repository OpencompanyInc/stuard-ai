import type { WebSocket } from 'ws';

import type { ModelChoice } from '../../router/model-router';

export type TierChoice = 'auto' | ModelChoice;

export function normalizeTierChoice(input: any): TierChoice {
  const raw = String(input || '').toLowerCase().trim();
  if (raw === 'deep') return 'smart';
  if (raw === 'smart') return 'smart';
  if (raw === 'balanced') return 'balanced';
  if (raw === 'fast') return 'fast';
  if (raw === 'auto') return 'auto';
  return 'balanced';
}

export function pickDefaultModelId(modelConfig: any, tier: ModelChoice): string | undefined {
  try {
    const cfg = modelConfig && typeof modelConfig === 'object' ? modelConfig : null;
    const entry = cfg && (cfg as any)[tier];
    const fallback = entry && typeof entry.default === 'string' ? String(entry.default).trim() : '';
    return fallback || undefined;
  } catch {
    return undefined;
  }
}

export function send(ws: WebSocket, data: unknown, requestId?: string) {
  try {
    const payload = requestId ? { ...(data as object), requestId } : data;
    ws.send(JSON.stringify(payload));
  } catch { }
}

export function isSISMetaTool(toolName: string): boolean {
  return toolName === 'sis_execute_tool'
    || toolName === 'sis_search_tools'
    || toolName === 'sis_list_categories'
    || toolName === 'search_past_conversations'
    || toolName === 'segment_search';
}

export function extractClientType(rawUrl: string): string | undefined {
  const qIndex = rawUrl.indexOf('?');
  if (qIndex < 0) return undefined;

  const search = rawUrl.slice(qIndex + 1);
  const parts = search.split('&');
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (decodeURIComponent(k || '') === 'client') {
      return decodeURIComponent(v || '');
    }
  }

  return undefined;
}
