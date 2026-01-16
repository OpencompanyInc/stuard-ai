import { getVariable } from '../tool-router';
import { evaluateSafe } from './expression-parser';

export function safeStuardId(id: string) {
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

export function getAtPath(obj: any, pathStr: string, defaultVal?: any) {
  try {
    // Handle both dot notation and bracket notation: "a.b[0].c" or "a[1].filePath"
    const normalized = String(pathStr || '')
      .replace(/\[(\d+)\]/g, '.$1')  // Convert [0] to .0
      .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');  // Convert ['key'] to .key
    const parts = normalized.split('.').filter(Boolean);

    // Special handling for $vars.varName - lookup from variable store
    if (parts[0] === '$vars' && parts.length >= 2) {
      const varName = parts[1];
      const varValue = getVariable(varName, undefined);
      if (varValue === undefined) return defaultVal;
      // If there are more path segments, traverse into the value
      if (parts.length > 2) {
        let cur: any = varValue;
        for (let i = 2; i < parts.length; i++) {
          if (cur == null) return defaultVal;
          cur = cur[parts[i]];
        }
        return cur === undefined ? defaultVal : cur;
      }
      return varValue;
    }

    // Smart path resolution: Try to match step IDs that may contain dots
    // For paths like "local.tool_abc123.text", we need to find the step ID first
    // Step IDs in ctx are keys like "local.tool_abc123" or "step_1"
    if (obj && typeof obj === 'object') {
      // Try progressive prefix matching to find step IDs with dots
      for (let i = parts.length - 1; i >= 1; i--) {
        const potentialStepId = parts.slice(0, i).join('.');
        if (potentialStepId in obj) {
          // Found a matching step ID, now traverse the remaining path
          let cur: any = obj[potentialStepId];
          for (let j = i; j < parts.length; j++) {
            if (cur == null) return defaultVal;
            cur = cur[parts[j]];
          }
          return cur === undefined ? defaultVal : cur;
        }
      }
    }

    // Fallback: simple dot-separated path traversal
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return defaultVal;
      cur = cur[p];
    }
    return cur === undefined ? defaultVal : cur;
  } catch {
    return defaultVal;
  }
}

export function safeEval(expr: string, ctx: any): any {
  return evaluateSafe(expr, ctx);
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

function toPythonInline(value: any): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'object') return toPythonExpr(value);
  return String(value);
}

export function interpolateForTool(input: any, ctx: any, toolName: string): any {
  const templ = (s: string, path: string) => s.replace(/\{\{([^}]+)\}\}/g, (_m, g1) => {
    const expr = String(g1 || '').trim();
    // Try simple path lookup first (fast, safe, handles non-JS identifiers)
    let v = getAtPath(ctx, expr, undefined);

    if (toolName === 'custom_ui' && expr.includes('get_clip')) {
      console.log(`[Interpolate] custom_ui looking up '${expr}': value type=${typeof v}, value=${v ? String(v).slice(0, 50) : v}`);
    }

    const isPythonCode = toolName === 'run_python_script' && path === 'code';

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

  const walk = (v: any, p: string): any => {
    if (typeof v === 'string') return templ(v, p);
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

export function jsonLogic(logic: any, data: any): any {
  if (logic == null || typeof logic !== 'object' || Array.isArray(logic)) return logic;
  const key = Object.keys(logic)[0];
  const val = (logic as any)[key];
  const a = (x: any) => jsonLogic(x, data);

  switch (key) {
    case 'var': {
      if (typeof val === 'string') return getAtPath(data, val);
      if (Array.isArray(val)) return getAtPath(data, String(val[0] || ''), val[1]);
      return undefined;
    }
    case '==': {
      const left = a(val[0]);
      const right = a(val[1]);
      // Handle undefined/null comparisons with booleans more intuitively:
      // undefined/null should be treated as falsy when compared with booleans
      if (typeof right === 'boolean' && (left === undefined || left === null)) {
        return !right; // undefined == false → true, undefined == true → false
      }
      if (typeof left === 'boolean' && (right === undefined || right === null)) {
        return !left; // false == undefined → true, true == undefined → false
      }
      return left == right;
    }
    case '===': return a(val[0]) === a(val[1]);
    case '!=': {
      const left = a(val[0]);
      const right = a(val[1]);
      // Handle undefined/null comparisons with booleans
      if (typeof right === 'boolean' && (left === undefined || left === null)) {
        return right; // undefined != false → false, undefined != true → true
      }
      if (typeof left === 'boolean' && (right === undefined || right === null)) {
        return left; // false != undefined → false, true != undefined → true
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
    default:
      return undefined;
  }
}

export function evalIfGuard(logic: any, ctx: any): boolean {
  try {
    if (typeof logic === 'string') {
      // Support string expressions: "workflow.isEnabled == true" or "{{step1.ok}}"
      const expr = logic.trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
      return !!evaluateSafe(expr, ctx);
    }
    return !!jsonLogic(logic, ctx);
  } catch {
    return false;
  }
}
