// Safe expression parser for template interpolation.
// Canonical implementation shared by the desktop + VM workflow engines.
// Supports:
// - Arithmetic: + - * / %
// - Comparison: == != === !== > < >= <=
// - Logical: && || !
// - Parentheses
// - Literals: numbers, strings, booleans, null
// - Variables: dot/bracket path access against the evaluation context

type TokenType =
  | 'NUMBER' | 'STRING' | 'BOOLEAN' | 'NULL' | 'UNDEFINED'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'LPAREN' | 'RPAREN'
  | 'COMMA' | 'EOF';

interface Token {
  type: TokenType;
  value: any;
  start: number;
}

// Tokenizer
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      const start = i;
      let numStr = '';
      while (i < input.length && (/[0-9]/.test(input[i]) || input[i] === '.')) {
        numStr += input[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr), start });
      continue;
    }

    // Strings (single/double quote)
    if (char === '"' || char === "'") {
      const quote = char;
      const start = i;
      i++; // skip open quote
      let str = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\') i++; // simple escape skip
        str += input[i];
        i++;
      }
      i++; // skip close quote
      tokens.push({ type: 'STRING', value: str, start });
      continue;
    }

    // Identifiers / Keywords
    if (/[a-zA-Z_$]/.test(char)) {
      const start = i;
      let id = '';
      while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) {
        id += input[i];
        i++;
      }

      // Member access (dot notation)
      while (i < input.length && input[i] === '.') {
        id += '.';
        i++;
        while (i < input.length && /[a-zA-Z0-9_$]/.test(input[i])) {
          id += input[i];
          i++;
        }
      }

      // Handle brackets [0] or ['key'] roughly for now, or just stick to dot notation for simple parser
      // For this safe implementation, we'll stick to identifier/path-like

      if (id === 'true') tokens.push({ type: 'BOOLEAN', value: true, start });
      else if (id === 'false') tokens.push({ type: 'BOOLEAN', value: false, start });
      else if (id === 'null') tokens.push({ type: 'NULL', value: null, start });
      else if (id === 'undefined') tokens.push({ type: 'UNDEFINED', value: undefined, start });
      else tokens.push({ type: 'IDENTIFIER', value: id, start });
      continue;
    }

    // Operators and Punctuation
    if (['+', '-', '*', '/', '%', '!', '>', '<', '=', '&', '|'].includes(char)) {
      const start = i;
      // Check for multi-char operators
      const next = input[i + 1];
      const next2 = input[i + 2];

      let op = char;
      i++;

      if (char === '=' && next === '=' && next2 === '=') { op = '==='; i += 2; }
      else if (char === '!' && next === '=' && next2 === '=') { op = '!=='; i += 2; }
      else if (char === '=' && next === '=') { op = '=='; i++; }
      else if (char === '!' && next === '=') { op = '!='; i++; }
      else if (char === '>' && next === '=') { op = '>='; i++; }
      else if (char === '<' && next === '=') { op = '<='; i++; }
      else if (char === '&' && next === '&') { op = '&&'; i++; }
      else if (char === '|' && next === '|') { op = '||'; i++; }

      tokens.push({ type: 'OPERATOR', value: op, start });
      continue;
    }

    if (char === '(') { tokens.push({ type: 'LPAREN', value: '(', start: i++ }); continue; }
    if (char === ')') { tokens.push({ type: 'RPAREN', value: ')', start: i++ }); continue; }
    if (char === ',') { tokens.push({ type: 'COMMA', value: ',', start: i++ }); continue; }

    i++; // Skip unknown
  }

  tokens.push({ type: 'EOF', value: null, start: i });
  return tokens;
}

// Parser & Evaluator
// Operator precedence:
// 1. ( )
// 2. ! (unary)
// 3. * / %
// 4. + -
// 5. > < >= <=
// 6. == != === !==
// 7. &&
// 8. ||

export class SafeExpressionEvaluator {
  private tokens: Token[] = [];
  private pos = 0;
  private ctx: any = {};

  constructor(input: string, ctx: any) {
    this.tokens = tokenize(input);
    this.ctx = ctx;
  }

  evaluate(): any {
    this.pos = 0;
    return this.parseExpression();
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }
  private match(type: TokenType, val?: string): boolean {
    const t = this.peek();
    if (t.type !== type) return false;
    if (val !== undefined && t.value !== val) return false;
    this.consume();
    return true;
  }

  // --- Grammar ---

  private parseExpression(): any {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): any {
    let left = this.parseLogicalAnd();
    while (this.peek().value === '||') {
      this.consume();
      const right = this.parseLogicalAnd();
      left = left || right;
    }
    return left;
  }

  private parseLogicalAnd(): any {
    let left = this.parseEquality();
    while (this.peek().value === '&&') {
      this.consume();
      const right = this.parseEquality();
      left = left && right;
    }
    return left;
  }

  private parseEquality(): any {
    let left = this.parseRelational();
    while (['==', '!=', '===', '!=='].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseRelational();
      if (op === '==') left = left == right;
      else if (op === '!=') left = left != right;
      else if (op === '===') left = left === right;
      else if (op === '!==') left = left !== right;
    }
    return left;
  }

  private parseRelational(): any {
    let left = this.parseAdditive();
    while (['>', '<', '>=', '<='].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseAdditive();
      if (op === '>') left = left > right;
      else if (op === '<') left = left < right;
      else if (op === '>=') left = left >= right;
      else if (op === '<=') left = left <= right;
    }
    return left;
  }

  private parseAdditive(): any {
    let left = this.parseMultiplicative();
    while (['+', '-'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseMultiplicative();
      if (op === '+') left = left + right;
      else if (op === '-') left = left - right;
    }
    return left;
  }

  private parseMultiplicative(): any {
    let left = this.parseUnary();
    while (['*', '/', '%'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else if (op === '%') left = left % right;
    }
    return left;
  }

  private parseUnary(): any {
    if (this.peek().value === '!') {
      this.consume();
      return !this.parseUnary();
    }
    if (this.peek().value === '-') {
      this.consume();
      return -this.parseUnary();
    }
    if (this.peek().value === '+') {
      this.consume();
      return +this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): any {
    const t = this.peek();

    if (t.type === 'NUMBER' || t.type === 'STRING' || t.type === 'BOOLEAN' || t.type === 'NULL') {
      this.consume();
      return t.value;
    }

    if (t.type === 'UNDEFINED') {
      this.consume();
      return undefined;
    }

    if (t.type === 'LPAREN') {
      this.consume();
      const val = this.parseExpression();
      if (!this.match('RPAREN')) throw new Error('Expected )');
      return val;
    }

    if (t.type === 'IDENTIFIER') {
      this.consume();
      // Variable lookup from context
      return this.resolveVariable(t.value);
    }

    // Fallback/Error
    // If we hit EOF or unknown token, just return undefined or throw
    // For template interpolation we might prefer undefined/empty over crash
    if (t.type === 'EOF') return undefined;

    this.consume(); // skip invalid
    return undefined;
  }

  private resolveVariable(path: string): any {
    try {
      // Support dot notation: "user.name"
      const normalized = String(path || '')
        .replace(/\[(\d+)\]/g, '.$1')  // Convert [0] to .0
        .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');  // Convert ['key'] to .key
      const parts = normalized.split('.').filter(Boolean);

      // Handle $vars proxy if it exists in ctx
      if (parts[0] === '$vars' && parts.length >= 2) {
        if (this.ctx.$vars) {
          const varName = parts[1];
          let val = this.ctx.$vars[varName];
          for (let i = 2; i < parts.length; i++) {
            if (val == null) return undefined;
            val = val[parts[i]];
          }
          return val;
        }
      }

      // Try progressive prefix matching for step IDs with dots (e.g., "local.tool_abc.value")
      if (this.ctx && typeof this.ctx === 'object') {
        for (let i = parts.length - 1; i >= 1; i--) {
          const potentialStepId = parts.slice(0, i).join('.');
          if (potentialStepId in this.ctx) {
            let cur: any = this.ctx[potentialStepId];
            for (let j = i; j < parts.length; j++) {
              if (cur == null) return undefined;
              cur = cur[parts[j]];
            }
            return cur;
          }
        }
      }

      // Fallback: simple dot-separated path traversal
      let current = this.ctx;
      for (const p of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[p];
      }
      return current;
    } catch {
      return undefined;
    }
  }
}

export function evaluateSafe(expr: string, ctx: any): any {
  try {
    const evaluator = new SafeExpressionEvaluator(expr, ctx);
    return evaluator.evaluate();
  } catch {
    return undefined;
  }
}
