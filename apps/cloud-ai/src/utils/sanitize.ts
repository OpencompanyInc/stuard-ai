import { safeData } from './logger';

const SENSITIVE_KEY_RE = /(token|secret|password|passwd|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|private[_-]?key|client_secret)/i;
const SESSION_SECRET_KEY_RE = /(^|[_-])(session|auth[_-]?session)([_-]|$)/i;
const SAFE_SESSION_ID_KEY_RE = /(^|[_-])session[_-]?id$/i;

function normalizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .trim()
    .toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SAFE_SESSION_ID_KEY_RE.test(normalized)) return false;
  return SENSITIVE_KEY_RE.test(normalized) || SESSION_SECRET_KEY_RE.test(normalized);
}

function redactSensitiveString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^Bearer\s+\S+/i.test(trimmed)) return 'Bearer [redacted]';
  if (/^sk-[A-Za-z0-9]/.test(trimmed)) return '[redacted]';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return '[redacted]';
  return value;
}

export function redactSensitiveData(input: any, depth = 0, seen?: WeakSet<object>): any {
  if (input == null) return input;
  if (depth > 20) return '[truncated]';

  if (typeof input === 'string') return redactSensitiveString(input);
  if (typeof input !== 'object') return input;

  const seenSet = seen || new WeakSet<object>();
  if (seenSet.has(input)) return '[circular]';
  seenSet.add(input);

  if (Array.isArray(input)) {
    return input.map((v) => redactSensitiveData(v, depth + 1, seenSet));
  }

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (isSensitiveKey(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redactSensitiveData(v, depth + 1, seenSet);
  }
  return out;
}

export function sanitizeToolResult(result: any) {
  try {
    const redacted = redactSensitiveData(result);
    if (redacted && typeof redacted === 'object') {
      const r: any = { ...redacted };
      if (typeof r.data === 'string') {
        r.bytes = r.data.length;
        delete r.data;
      }
      return r;
    }
    return redacted;
  } catch {}
  return result;
}

export function sanitizeToolEvent(evt: any) {
  try {
    // Preserve workflow data from sanitization — workflow_modify returns full
    // workflow objects that have deeply nested args (window.shadow.enabled etc.)
    // and must not be truncated since the client applies them directly.
    const isWorkflowTool = evt?.tool === 'modify_workflow' || evt?.tool === 'workflow_modify' || evt?.tool === 'create_workflow';
    if (isWorkflowTool && evt?.result?.workflow) {
      // Only redact the non-workflow parts; pass workflow through untouched
      const { result, ...rest } = evt;
      const { workflow, ...resultRest } = result;
      const safeRest = redactSensitiveData(rest);
      const safeResultRest = redactSensitiveData(resultRest);
      return { ...safeRest, result: { ...safeResultRest, workflow } };
    }

    const e: any = { ...redactSensitiveData(evt) };
    if (e.args) e.args = redactSensitiveData(e.args);
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
