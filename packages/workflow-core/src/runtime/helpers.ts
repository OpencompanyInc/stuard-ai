/**
 * Shared workflow runtime helpers — path resolution, template interpolation,
 * JSONLogic + guard evaluation. Canonical implementation for both the desktop
 * Electron engine and the VM engine.
 *
 * The one platform difference is how `$vars.NAME` resolves: the desktop reads
 * from its global variable store, the VM from a per-run `ctx.$vars` proxy. That
 * is injected via PathResolveOptions.resolveVar; when omitted, `$vars` falls
 * back to the `ctx.$vars` proxy (VM behavior).
 */

import { evaluateSafe } from './expr';

export { evaluateSafe, SafeExpressionEvaluator } from './expr';

export interface PathResolveOptions {
  /**
   * Resolve a `$vars.NAME` reference. Receives the bare var name and the ctx's
   * `$flowId` (if present). Return `undefined` when not found. When omitted,
   * `$vars` is read from the `ctx.$vars` proxy instead.
   */
  resolveVar?: (name: string, flowId: string | undefined) => any;
}

export function safeStuardId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

// Summarize output for logging (truncate large objects)
export function summarizeOutput(output: any): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') {
    return output.length > 100 ? output.slice(0, 100) + '...' : output;
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  if (output.ok !== undefined) {
    // Tool result format
    if (output.ok === false) return `error: ${output.error || 'failed'}`;
    if (output.message) return output.message;
    if (output.result) return summarizeOutput(output.result);
  }
  // Object - show key count and sample keys
  const keys = Object.keys(output);
  if (keys.length === 0) return '{}';
  if (keys.length <= 3) return `{${keys.join(', ')}}`;
  return `{${keys.slice(0, 3).join(', ')}... +${keys.length - 3} more}`;
}

export function getAtPath(obj: any, pathStr: string, defaultVal?: any, opts?: PathResolveOptions): any {
  try {
    // Handle both dot notation and bracket notation: "a.b[0].c" or "a[1].filePath"
    const normalized = String(pathStr || '')
      .replace(/\[(\d+)\]/g, '.$1')  // Convert [0] to .0
      .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');  // Convert ['key'] to .key
    const parts = normalized.split('.').filter(Boolean);

    // Helper: resolve an array accessor (first/last/count or numeric index)
    const resolveArrayPart = (cur: any, part: string): any => {
      if (Array.isArray(cur)) {
        if (part === 'first') return cur[0];
        if (part === 'last') return cur[cur.length - 1];
        if (part === 'count' || part === 'length') return cur.length;
      }
      return cur[part];
    };

    // Special handling for $vars.varName.
    if (parts[0] === '$vars' && parts.length >= 2) {
      const varName = parts[1];
      const flowId = obj && typeof obj === 'object' ? obj.$flowId : undefined;
      let varValue: any;
      if (opts?.resolveVar) {
        // Host-backed store (desktop). Variables are stored with a 'workflow.'
        // prefix (e.g. 'workflow.w'), so fall back to that.
        varValue = opts.resolveVar(varName, flowId);
        if (varValue === undefined) varValue = opts.resolveVar(`workflow.${varName}`, flowId);
      } else if (obj?.$vars) {
        // ctx proxy (VM). When neither resolver nor proxy is present, fall
        // through to generic traversal (treats `$vars` as a literal key).
        varValue = obj.$vars[varName];
      } else {
        varValue = undefined;
        // mark as "not a $vars hit" so we fall through below
        return genericTraverse();
      }
      if (varValue === undefined) return defaultVal;
      // If there are more path segments, traverse into the value
      if (parts.length > 2) {
        let cur: any = varValue;
        for (let i = 2; i < parts.length; i++) {
          if (cur == null) return defaultVal;
          cur = resolveArrayPart(cur, parts[i]);
        }
        return cur === undefined ? defaultVal : cur;
      }
      return varValue;
    }

    // Special handling for $workspace — resolve workspace paths
    if (parts[0] === '$workspace' && obj?.$workspace) {
      const ws = obj.$workspace;
      if (parts.length === 1) return ws;
      const field = parts[1];
      if (field === 'path') return ws.path;
      if (field === 'data') return ws.data;
      if (field === 'scripts') return ws.scripts;
      if (field === 'assets') return ws.assets;
      // $workspace.file.subpath.to.file → resolve file path within workspace
      if (field === 'file' && parts.length >= 3) {
        const fileParts = parts.slice(2).join('/');
        return ws.path ? ws.path + '/' + fileParts : fileParts;
      }
      // Fall through to normal resolution for any other $workspace.X
      return ws[field] !== undefined ? ws[field] : defaultVal;
    }

    return genericTraverse();

    function genericTraverse(): any {
      // Smart path resolution: Try to match step IDs that may contain dots.
      // For paths like "local.tool_abc123.text", we find the step ID first.
      if (obj && typeof obj === 'object') {
        for (let i = parts.length - 1; i >= 1; i--) {
          const potentialStepId = parts.slice(0, i).join('.');
          if (potentialStepId in obj) {
            let cur: any = obj[potentialStepId];
            for (let j = i; j < parts.length; j++) {
              if (cur == null) return defaultVal;
              // Auto-parse JSON strings to support {{step.stdout.field}}
              if (typeof cur === 'string' && (cur.trim().startsWith('{') || cur.trim().startsWith('['))) {
                try {
                  const parsed = JSON.parse(cur);
                  if (parsed && typeof parsed === 'object') cur = parsed;
                } catch { /* not JSON */ }
              }
              cur = resolveArrayPart(cur, parts[j]);
            }
            return cur === undefined ? defaultVal : cur;
          }
        }
      }

      // Fallback: simple dot-separated path traversal
      let cur: any = obj;
      for (const p of parts) {
        if (cur == null) return defaultVal;
        if (typeof cur === 'string' && (cur.trim().startsWith('{') || cur.trim().startsWith('['))) {
          try {
            const parsed = JSON.parse(cur);
            if (parsed && typeof parsed === 'object') cur = parsed;
          } catch { /* not JSON */ }
        }
        cur = resolveArrayPart(cur, p);
      }
      return cur === undefined ? defaultVal : cur;
    }
  } catch {
    return defaultVal;
  }
}

function toPythonExpr(value: any, depth = 0): string {
  if (depth > 30) return 'None';
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(v => toPythonExpr(v, depth + 1)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => {
      const key = JSON.stringify(String(k));
      const val = toPythonExpr(v, depth + 1);
      return `${key}: ${val}`;
    });
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(String(value));
}

function escapePythonStringContent(value: string): string {
  // Escape special characters that would break a Python string literal.
  // Does NOT add outer quotes - the workflow author provides those.
  return value
    .replace(/\\/g, '\\\\')   // Backslash first
    .replace(/"/g, '\\"')     // Double quotes
    .replace(/'/g, "\\'")     // Single quotes
    .replace(/\n/g, '\\n')    // Newlines
    .replace(/\r/g, '\\r')    // Carriage returns
    .replace(/\t/g, '\\t');   // Tabs
}

function toPythonInline(value: any): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return escapePythonStringContent(value); // Escape special chars, no outer quotes
  if (typeof value === 'object') return toPythonExpr(value);
  return String(value);
}

export function interpolateForTool(input: any, ctx: any, toolName: string, opts?: PathResolveOptions): any {
  const templ = (s: string, path: string) => {
    // Resolve templates iteratively from inside-out to support nested syntax like {{arr[{{i}}]}}
    let result = s;
    let maxIterations = 10; // Prevent infinite loops
    const isPythonCode = toolName === 'run_python_script' && path === 'code';
    while (maxIterations-- > 0) {
      const prev = result;
      // Match innermost {{...}} that contains no nested braces
      result = result.replace(/\{\{([^{}]+)\}\}/g, (_m, g1) => {
        const expr = String(g1 || '').trim();
        // Try simple path lookup first (fast, safe, handles non-JS identifiers)
        const v = getAtPath(ctx, expr, undefined, opts);

        if (isPythonCode) {
          return toPythonInline(v);
        }

        if (v == null) {
          // For custom_ui tools, preserve unmatched tags so they can be handled by the UI's own templating
          if (toolName === 'custom_ui' || toolName === 'update_custom_ui') {
            return _m;
          }
          return '';
        }
        // JSON stringify objects/arrays so they can be parsed in scripts
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      });

      if (result === prev) break;
    }
    return result;
  };

  const walk = (v: any, p: string): any => {
    if (typeof v === 'string') {
      // Check if the entire string is a single template expression like {{step.data.region}}
      // In this case, return the resolved value directly (preserving object/array types)
      const singleTemplateMatch = v.match(/^\{\{([^{}]+)\}\}$/);
      if (singleTemplateMatch) {
        const expr = singleTemplateMatch[1].trim();
        const resolved = getAtPath(ctx, expr, undefined, opts);
        if (resolved != null) {
          // Return the resolved value directly - preserves objects/arrays instead of stringifying
          return resolved;
        }
        return v; // Keep original if not resolved
      }
      return templ(v, p);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const k of Object.keys(v)) {
        const nextPath = p ? `${p}.${k}` : k;
        o[k] = walk(v[k], nextPath);
      }
      return o;
    }
    return v;
  };

  return walk(input, '');
}

export function deepMerge(base: any, patch: any): any {
  if (patch == null) return base;
  if (base == null) return patch;
  if (Array.isArray(base) && Array.isArray(patch)) return patch.slice();
  if (typeof base === 'object' && typeof patch === 'object') {
    const out: any = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return patch;
}

export function jsonLogic(logic: any, data: any, opts?: PathResolveOptions): any {
  if (logic == null || typeof logic !== 'object' || Array.isArray(logic)) return logic;
  const key = Object.keys(logic)[0];
  const val = (logic as any)[key];
  const a = (x: any) => jsonLogic(x, data, opts);

  switch (key) {
    case 'var': {
      if (typeof val === 'string') return getAtPath(data, val, undefined, opts);
      if (Array.isArray(val)) return getAtPath(data, String(val[0] || ''), val[1], opts);
      return undefined;
    }
    case '==': {
      const left = a(val[0]);
      const right = a(val[1]);
      // undefined/null treated as falsy when compared with booleans
      if (typeof right === 'boolean' && (left === undefined || left === null)) {
        return !right; // undefined == false → true, undefined == true → false
      }
      if (typeof left === 'boolean' && (right === undefined || right === null)) {
        return !left;
      }
      return left == right;
    }
    case '===': return a(val[0]) === a(val[1]);
    case '!=': {
      const left = a(val[0]);
      const right = a(val[1]);
      if (typeof right === 'boolean' && (left === undefined || left === null)) {
        return right;
      }
      if (typeof left === 'boolean' && (right === undefined || right === null)) {
        return left;
      }
      return left != right;
    }
    case '!==': return a(val[0]) !== a(val[1]);
    case '>': return a(val[0]) > a(val[1]);
    case '<': return a(val[0]) < a(val[1]);
    case '>=': return a(val[0]) >= a(val[1]);
    case '<=': return a(val[0]) <= a(val[1]);
    case 'and': return (val || []).every((x: any) => !!a(x));
    case 'or': return (val || []).some((x: any) => !!a(x));
    case '!':
    case 'not': return !a(val);
    case 'in': {
      const needle = a(val[0]);
      const hay = a(val[1]);
      if (typeof hay === 'string') return hay.indexOf(String(needle)) !== -1;
      if (Array.isArray(hay)) return hay.includes(needle);
      return false;
    }
    case 'empty': {
      const v = a(Array.isArray(val) ? val[0] : val);
      if (v == null) return true;
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      return false;
    }
    case 'not_empty': {
      const v2 = a(Array.isArray(val) ? val[0] : val);
      if (v2 == null) return false;
      if (typeof v2 === 'string') return v2.trim() !== '';
      if (Array.isArray(v2)) return v2.length > 0;
      return true;
    }
    default:
      return undefined;
  }
}

export function evalIfGuard(logic: any, ctx: any, opts?: PathResolveOptions): boolean {
  try {
    if (typeof logic === 'string') {
      // Support string expressions: "workflow.isEnabled == true" or "{{step1.ok}}"
      const expr = logic.trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
      return !!evaluateSafe(expr, ctx);
    }
    return !!jsonLogic(logic, ctx, opts);
  } catch {
    return false;
  }
}
