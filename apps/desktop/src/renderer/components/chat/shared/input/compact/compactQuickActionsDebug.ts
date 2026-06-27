/** Filter DevTools console with: CompactQuickActions */

export const COMPACT_QA_LOG_PREFIX = '[CompactQuickActions]';

export function compactQuickActionsDebugEnabled(): boolean {
  try {
    const flag = localStorage.getItem('stuard_debug_quick_actions');
    if (flag === '1') return true;
    if (flag === '0') return false;
  } catch {
    // ignore storage errors
  }
  return typeof import.meta !== 'undefined' && !!(import.meta as ImportMeta).env?.DEV;
}

export function qaLog(event: string, data?: Record<string, unknown>): void {
  if (!compactQuickActionsDebugEnabled()) return;
  if (data !== undefined) {
    console.log(COMPACT_QA_LOG_PREFIX, event, data);
  } else {
    console.log(COMPACT_QA_LOG_PREFIX, event);
  }
}

export function qaWarn(event: string, data?: Record<string, unknown>): void {
  if (!compactQuickActionsDebugEnabled()) return;
  if (data !== undefined) {
    console.warn(COMPACT_QA_LOG_PREFIX, event, data);
  } else {
    console.warn(COMPACT_QA_LOG_PREFIX, event);
  }
}

export function qaError(event: string, err: unknown, data?: Record<string, unknown>): void {
  if (!compactQuickActionsDebugEnabled()) return;
  console.error(COMPACT_QA_LOG_PREFIX, event, { ...data, error: err });
}
