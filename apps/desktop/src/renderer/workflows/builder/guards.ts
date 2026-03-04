/**
 * Guard Parser - Converts simple conditions to JSONLogic
 * 
 * Supported formats:
 *   "fieldName"           → { "==": [{ "var": "fieldName" }, true] }
 *   "!fieldName"          → { "!=": [{ "var": "fieldName" }, true] }
 *   "field == value"      → { "==": [{ "var": "field" }, value] }
 *   "field != value"      → { "!=": [{ "var": "field" }, value] }
 *   "field > 5"           → { ">": [{ "var": "field" }, 5] }
 *   "field >= 5"          → { ">=": [{ "var": "field" }, 5] }
 *   "field < 5"           → { "<": [{ "var": "field" }, 5] }
 *   "field <= 5"          → { "<=": [{ "var": "field" }, 5] }
 *   "field in ['a','b']"  → { "in": [{ "var": "field" }, ["a","b"]] }
 *   "a && b"              → { "and": [...] }
 *   "a || b"              → { "or": [...] }
 *   "always"              → "always" (no guard)
 */

export type SimpleGuard = string | { if: any } | { ai: any };

export type JSONLogic =
  | { '==': [any, any] }
  | { '!=': [any, any] }
  | { '>': [any, any] }
  | { '>=': [any, any] }
  | { '<': [any, any] }
  | { '<=': [any, any] }
  | { 'and': any[] }
  | { 'or': any[] }
  | { '!': any }
  | { 'in': [any, any] }
  | { 'var': string | [string, any] }
  | any;

// Token types for simple lexer
type Token =
  | { type: 'ident'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'comma' }
  | { type: 'not' }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'in' };

/**
 * Parse a simple guard expression into JSONLogic
 */
export function parseGuard(input: SimpleGuard): any {
  // Already JSONLogic format
  if (typeof input === 'object') {
    if ('if' in input) return { if: input.if };
    if ('ai' in input) return { ai: input.ai };
    return input;
  }

  const s = String(input || '').trim();

  // Special cases
  if (!s || s === 'always' || s === 'true') return 'always';
  if (s === 'never' || s === 'false') return { '==': [true, false] }; // Always false

  try {
    const tokens = tokenize(s);
    const ast = parseExpr(tokens, 0);
    return ast.result;
  } catch (e) {
    // Fallback: treat as a string expression for the new engine
    return { if: s };
  }
}

/**
 * Convert JSONLogic back to simple string (for display)
 */
export function guardToString(guard: any): string {
  if (!guard || guard === 'always') return 'always';
  if (typeof guard === 'string') return guard;

  if (typeof guard !== 'object') return String(guard);

  // Handle { if: ... } wrapper
  if ('if' in guard) return guardToString(guard.if);
  if ('ai' in guard) return `ai: ${guard.ai.instruction || 'decide'}`;

  const op = Object.keys(guard)[0];
  const val = guard[op];

  switch (op) {
    case 'var':
      return typeof val === 'string' ? val : val[0];
    case '==':
      return `${guardToString(val[0])} == ${formatValue(val[1])}`;
    case '!=':
      return `${guardToString(val[0])} != ${formatValue(val[1])}`;
    case '>':
      return `${guardToString(val[0])} > ${formatValue(val[1])}`;
    case '>=':
      return `${guardToString(val[0])} >= ${formatValue(val[1])}`;
    case '<':
      return `${guardToString(val[0])} < ${formatValue(val[1])}`;
    case '<=':
      return `${guardToString(val[0])} <= ${formatValue(val[1])}`;
    case 'and':
      return val.map(guardToString).join(' && ');
    case 'or':
      return val.map(guardToString).join(' || ');
    case '!':
    case 'not':
      return `!${guardToString(val)}`;
    case 'in':
      return `${guardToString(val[0])} in ${formatValue(val[1])}`;
    default:
      return JSON.stringify(guard);
  }
}

/**
 * Generate a short wire label for a guard condition.
 * Boolean-style guards → "True" / "False"
 * Comparison guards → compact expression like "score > 5"
 * Returns null when no guard or 'always'.
 */
export function guardToShortLabel(guard: any, rightOnly?: boolean, useBool?: boolean): { text: string; positive: boolean } | null {
  if (!guard || guard === 'always') return null;

  if (typeof guard === 'string') {
    if (guard === 'always' || guard === 'true') return null;
    if (guard === 'never' || guard === 'false') return { text: 'False', positive: false };
    if (guard.startsWith('!')) return { text: 'False', positive: false };
    const cmpMatch = guard.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (cmpMatch) {
      if (useBool) return { text: cmpMatch[2] === '==' ? 'True' : 'False', positive: cmpMatch[2] === '==' };
      const rv = cmpMatch[3].trim();
      if (rightOnly) return { text: rv, positive: true };
      const left = cmpMatch[1].includes('.') ? cmpMatch[1].split('.').pop()! : cmpMatch[1];
      const text = `${left.trim()} ${cmpMatch[2]} ${rv}`;
      return { text: text.length > 20 ? text.slice(0, 18) + '..' : text, positive: true };
    }
    return { text: 'True', positive: true };
  }

  if (typeof guard !== 'object') return null;
  if ('if' in guard) return guardToShortLabel(guard.if, rightOnly, useBool);
  if ('ai' in guard) return { text: 'AI', positive: true };

  const op = Object.keys(guard)[0];
  const val = guard[op];

  // Negation → False
  if (op === '!' || op === 'not') return { text: 'False', positive: false };

  // Bare var reference → boolean truthy check
  if (op === 'var') return { text: 'True', positive: true };

  // == true / == false → boolean
  if (op === '==' && val[1] === true) return { text: 'True', positive: true };
  if (op === '==' && val[1] === false) return { text: 'False', positive: false };
  if (op === '!=' && val[1] === true) return { text: 'False', positive: false };
  if (op === '!=' && val[1] === false) return { text: 'True', positive: true };

  // Boolean pair: same left & right, opposite == / !=
  if (useBool && (op === '==' || op === '!=')) {
    return { text: op === '==' ? 'True' : 'False', positive: op === '==' };
  }

  // Comparison operators → show expression or just right value
  if (['==', '!=', '>', '>=', '<', '<=', 'in'].includes(op)) {
    const right = shortVal(val[1]);
    if (rightOnly) return { text: right, positive: true };
    const left = shortVar(val[0]);
    const text = `${left} ${op} ${right}`;
    return { text: text.length > 20 ? text.slice(0, 18) + '..' : text, positive: true };
  }

  // and / or → show compact
  if (op === 'and' || op === 'or') {
    const s = guardToString(guard);
    return { text: s.length > 20 ? s.slice(0, 18) + '..' : s, positive: true };
  }

  return { text: 'True', positive: true };
}

/**
 * Extract { left, op, right } from a guard comparison (for sibling detection).
 */
export function guardExtractComparison(guard: any): { left: string; op: string; right: string } | null {
  if (!guard || guard === 'always') return null;
  if (typeof guard === 'string') {
    const m = guard.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    return m ? { left: m[1].trim(), op: m[2], right: m[3].trim() } : null;
  }
  if (typeof guard !== 'object') return null;
  if ('if' in guard) return guardExtractComparison(guard.if);
  const op = Object.keys(guard)[0];
  const val = guard[op];
  if (['==', '!=', '>', '>=', '<', '<=', 'in'].includes(op) && val[1] !== true && val[1] !== false) {
    return { left: shortVar(val[0]), op, right: shortVal(val[1]) };
  }
  return null;
}

/** Extract short variable name from a JSONLogic value */
function shortVar(v: any): string {
  if (v && typeof v === 'object' && 'var' in v) {
    const name: string = typeof v.var === 'string' ? v.var : v.var[0];
    return name.includes('.') ? name.split('.').pop()! : name;
  }
  return shortVal(v);
}

/** Format a value compactly */
function shortVal(v: any): string {
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.map(shortVal).join(',')}]`;
  return String(v);
}

function formatValue(v: any): string {
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  return String(v);
}

// ============================================================================
// Tokenizer
// ============================================================================

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    // Skip whitespace
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Operators (multi-char first)
    if (input.slice(i, i + 2) === '==') {
      tokens.push({ type: 'op', value: '==' });
      i += 2;
      continue;
    }
    if (input.slice(i, i + 2) === '!=') {
      tokens.push({ type: 'op', value: '!=' });
      i += 2;
      continue;
    }
    if (input.slice(i, i + 2) === '>=') {
      tokens.push({ type: 'op', value: '>=' });
      i += 2;
      continue;
    }
    if (input.slice(i, i + 2) === '<=') {
      tokens.push({ type: 'op', value: '<=' });
      i += 2;
      continue;
    }
    if (input.slice(i, i + 2) === '&&') {
      tokens.push({ type: 'and' });
      i += 2;
      continue;
    }
    if (input.slice(i, i + 2) === '||') {
      tokens.push({ type: 'or' });
      i += 2;
      continue;
    }

    // Single char operators
    if (c === '>') {
      tokens.push({ type: 'op', value: '>' });
      i++;
      continue;
    }
    if (c === '<') {
      tokens.push({ type: 'op', value: '<' });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (c === '[') {
      tokens.push({ type: 'lbracket' });
      i++;
      continue;
    }
    if (c === ']') {
      tokens.push({ type: 'rbracket' });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }

    // String literal
    if (c === '"' || c === "'") {
      const quote = c;
      let str = '';
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          i++;
          str += input[i];
        } else {
          str += input[i];
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Number
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let num = '';
      if (c === '-') {
        num = '-';
        i++;
      }
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(c)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i])) {
        ident += input[i];
        i++;
      }

      // Keywords
      if (ident === 'true') {
        tokens.push({ type: 'bool', value: true });
      } else if (ident === 'false') {
        tokens.push({ type: 'bool', value: false });
      } else if (ident === 'in') {
        tokens.push({ type: 'in' });
      } else if (ident === 'and') {
        tokens.push({ type: 'and' });
      } else if (ident === 'or') {
        tokens.push({ type: 'or' });
      } else if (ident === 'not') {
        tokens.push({ type: 'not' });
      } else {
        tokens.push({ type: 'ident', value: ident });
      }
      continue;
    }

    // Unknown character, skip
    i++;
  }

  return tokens;
}

// ============================================================================
// Parser (recursive descent)
// ============================================================================

interface ParseResult {
  result: any;
  nextIndex: number;
}

function parseExpr(tokens: Token[], index: number): ParseResult {
  return parseOr(tokens, index);
}

function parseOr(tokens: Token[], index: number): ParseResult {
  let left = parseAnd(tokens, index);

  while (left.nextIndex < tokens.length && tokens[left.nextIndex]?.type === 'or') {
    const right = parseAnd(tokens, left.nextIndex + 1);
    left = {
      result: { or: [left.result, right.result] },
      nextIndex: right.nextIndex,
    };
  }

  return left;
}

function parseAnd(tokens: Token[], index: number): ParseResult {
  let left = parseNot(tokens, index);

  while (left.nextIndex < tokens.length && tokens[left.nextIndex]?.type === 'and') {
    const right = parseNot(tokens, left.nextIndex + 1);
    left = {
      result: { and: [left.result, right.result] },
      nextIndex: right.nextIndex,
    };
  }

  return left;
}

function parseNot(tokens: Token[], index: number): ParseResult {
  if (tokens[index]?.type === 'not') {
    const inner = parseNot(tokens, index + 1);
    return {
      result: { '!': inner.result },
      nextIndex: inner.nextIndex,
    };
  }
  return parseComparison(tokens, index);
}

function parseComparison(tokens: Token[], index: number): ParseResult {
  const left = parsePrimary(tokens, index);

  // Check for comparison operator
  const opToken = tokens[left.nextIndex];
  if (opToken?.type === 'op') {
    const op = opToken.value;
    const right = parsePrimary(tokens, left.nextIndex + 1);
    return {
      result: { [op]: [left.result, right.result] },
      nextIndex: right.nextIndex,
    };
  }

  // Check for 'in' operator
  if (opToken?.type === 'in') {
    const right = parseArray(tokens, left.nextIndex + 1);
    return {
      result: { in: [left.result, right.result] },
      nextIndex: right.nextIndex,
    };
  }

  // Bare identifier = truthy check in JSONLogic
  // We return it directly instead of forcing '== true' to avoid annoying UI behavior
  return left;
}

function parsePrimary(tokens: Token[], index: number): ParseResult {
  const token = tokens[index];

  if (!token) {
    throw new Error('Unexpected end of expression');
  }

  switch (token.type) {
    case 'ident':
      return {
        result: { var: token.value },
        nextIndex: index + 1,
      };
    case 'number':
      return {
        result: token.value,
        nextIndex: index + 1,
      };
    case 'string':
      return {
        result: token.value,
        nextIndex: index + 1,
      };
    case 'bool':
      return {
        result: token.value,
        nextIndex: index + 1,
      };
    case 'lparen': {
      const inner = parseExpr(tokens, index + 1);
      if (tokens[inner.nextIndex]?.type !== 'rparen') {
        throw new Error('Expected closing parenthesis');
      }
      return {
        result: inner.result,
        nextIndex: inner.nextIndex + 1,
      };
    }
    case 'lbracket':
      return parseArray(tokens, index);
    default:
      throw new Error(`Unexpected token: ${token.type}`);
  }
}

function parseArray(tokens: Token[], index: number): ParseResult {
  if (tokens[index]?.type !== 'lbracket') {
    throw new Error('Expected array');
  }

  const items: any[] = [];
  let i = index + 1;

  while (i < tokens.length && tokens[i]?.type !== 'rbracket') {
    const item = parsePrimary(tokens, i);
    items.push(item.result);
    i = item.nextIndex;

    if (tokens[i]?.type === 'comma') {
      i++;
    }
  }

  if (tokens[i]?.type !== 'rbracket') {
    throw new Error('Expected closing bracket');
  }

  return {
    result: items,
    nextIndex: i + 1,
  };
}

// ============================================================================
// Condition Builder (for programmatic use)
// ============================================================================

export const condition = {
  eq: (field: string, value: any) => ({ '==': [{ var: field }, value] }),
  neq: (field: string, value: any) => ({ '!=': [{ var: field }, value] }),
  gt: (field: string, value: number) => ({ '>': [{ var: field }, value] }),
  gte: (field: string, value: number) => ({ '>=': [{ var: field }, value] }),
  lt: (field: string, value: number) => ({ '<': [{ var: field }, value] }),
  lte: (field: string, value: number) => ({ '<=': [{ var: field }, value] }),
  truthy: (field: string) => ({ '==': [{ var: field }, true] }),
  falsy: (field: string) => ({ '!=': [{ var: field }, true] }),
  and: (...conditions: any[]) => ({ and: conditions }),
  or: (...conditions: any[]) => ({ or: conditions }),
  not: (cond: any) => ({ '!': cond }),
  inArray: (field: string, values: any[]) => ({ in: [{ var: field }, values] }),
  ai: (instruction: string, produceArgs?: boolean) => ({ ai: { instruction, produceArgs } }),
};
