import { safeData } from './logger';

export function sanitizeToolResult(result: any) {
  try {
    if (result && typeof result === 'object') {
      const r: any = { ...result };
      if (typeof r.data === 'string') {
        r.bytes = r.data.length;
        delete r.data;
      }
      return r;
    }
  } catch {}
  return result;
}

export function sanitizeToolEvent(evt: any) {
  try {
    const e: any = { ...evt };
    if (e.result) e.result = sanitizeToolResult(e.result);
    return e;
  } catch {
    return evt;
  }
}

export function sanitizeSteps(steps: any) {
  try {
    return safeData(steps);
  } catch {
    return steps;
  }
}
