/**
 * JSX Transform Utility
 *
 * Transforms JSX/TSX component code into plain JavaScript using sucrase.
 * This allows custom UI components to be written in familiar React JSX
 * syntax. Auto-detects whether code contains JSX or is plain JS.
 */

import { transform } from 'sucrase';

/**
 * Detect whether the component code uses JSX syntax or is plain JS.
 *
 * Returns 'jsx' if the code contains JSX-like patterns (angle bracket elements).
 * Returns 'plain' if it's just regular JS (e.g. React.createElement calls).
 */
export function detectComponentSyntax(code: string): 'jsx' | 'plain' {
  // Strip strings and comments to avoid false positives
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
    .replace(/\/\/.*/g, '')                // line comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')   // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")   // single-quoted strings
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{)|\$\{[^}]*\})*`/g, '``'); // template literals with ${...} expressions

  // Check for JSX patterns: <Component, <div, return (<div, etc.
  const jsxPatterns = [
    /return\s*\(\s*<[A-Za-z]/,         // return (<div or return (<Component
    /return\s+<[A-Za-z]/,               // return <div
    /=>\s*\(\s*<[A-Za-z]/,              // => (<div
    /=>\s*<[A-Za-z]/,                   // => <div
    /<[A-Z][A-Za-z]*[\s/>]/,            // <Component or <Component>
    /<[a-z]+\s+[a-zA-Z]+=\{/,          // <div className={
    /<[a-z]+\s+className=/,             // <div className=
    /<\/[A-Za-z]+>/,                    // </Component>
    /<[a-z]+\s*\/>/,                    // <br/> or <img />
  ];

  for (const pattern of jsxPatterns) {
    if (pattern.test(stripped)) {
      return 'jsx';
    }
  }

  return 'plain';
}

/**
 * Transform JSX/TSX code to plain JavaScript using sucrase.
 *
 * The output uses React.createElement() calls which work with our
 * bundled React UMD runtime.
 *
 * @param code - The JSX/TSX component source code
 * @returns The transformed plain JavaScript code
 * @throws Error if the transformation fails (syntax error in JSX)
 */
export function transformJsx(code: string): string {
  try {
    const result = transform(code, {
      transforms: ['jsx', 'typescript'],
      jsxRuntime: 'classic',
      // React.createElement is available globally in our runtime
      jsxPragma: 'React.createElement',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    });
    return result.code;
  } catch (error: any) {
    const message = error?.message || String(error);
    throw new Error(`JSX transform failed: ${message}`);
  }
}

/**
 * Diagnostic produced by component code validation.
 */
export interface ComponentDiagnostic {
  line: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Hooks and globals provided by the custom UI runtime.
 * Used by the validator to detect references to undefined identifiers.
 */
const RUNTIME_HOOKS = new Set([
  'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback',
  'useReducer', 'useContext', 'useLayoutEffect',
  'useVar', 'useStream', 'useStyles', 'useInterval', 'useTimeout', 'useLocalStorage',
  'useAnimation', 'useMotionValue', 'useTransform', 'useSpring',
]);

const RUNTIME_GLOBALS = new Set([
  'React', 'ReactDOM', 'Fragment', 'createElement',
  'motion', 'AnimatePresence',
  'stuard', 'initialData', 'formData',
  'ReactMarkdown', 'Markdown', 'Badge',
]);

/**
 * Bare imports that must be mapped to existing runtime globals instead of the
 * UI packages require shim. Bundling React again would break hooks.
 */
const GLOBAL_IMPORT_ALIASES: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'framer-motion': 'window.Motion',
};

interface ParsedImportClause {
  def: string | null;
  ns: string | null;
  named: Array<{ name: string; alias: string }>;
}

function parseImportClause(clause: string): ParsedImportClause {
  let rest = clause.trim();
  let def: string | null = null;
  let ns: string | null = null;
  const named: Array<{ name: string; alias: string }> = [];

  if (rest && rest[0] !== '{' && rest[0] !== '*') {
    const defMatch = rest.match(/^([A-Za-z_$][\w$]*)\s*,?\s*/);
    if (defMatch) {
      def = defMatch[1];
      rest = rest.slice(defMatch[0].length);
    }
  }

  const nsMatch = rest.match(/^\*\s*as\s+([A-Za-z_$][\w$]*)\s*,?\s*/);
  if (nsMatch) {
    ns = nsMatch[1];
    rest = rest.slice(nsMatch[0].length);
  }

  const namedMatch = rest.match(/\{([^}]*)\}/);
  if (namedMatch) {
    for (const tok of namedMatch[1].split(',')) {
      const piece = tok.trim();
      if (!piece) continue;
      const parts = piece.split(/\s+as\s+/);
      const name = parts[0].trim();
      const alias = (parts[1] || parts[0]).trim();
      if (name) named.push({ name, alias });
    }
  }

  return { def, ns, named };
}

function bindingFor(source: string, clause: string): string {
  const { def, ns, named } = parseImportClause(clause);
  const parts: string[] = [];
  const destructure = () =>
    named.map((n) => (n.name === n.alias ? n.name : `${n.name}: ${n.alias}`)).join(', ');

  const globalAlias = GLOBAL_IMPORT_ALIASES[source];
  if (globalAlias) {
    if (def) parts.push(`var ${def} = ${globalAlias};`);
    if (ns) parts.push(`var ${ns} = ${globalAlias};`);
    if (named.length) parts.push(`var { ${destructure()} } = ${globalAlias};`);
    return parts.join(' ');
  }

  const src = JSON.stringify(source);
  if (def) parts.push(`var ${def} = __stuardImportDefault(${src});`);
  if (ns) parts.push(`var ${ns} = __stuardRequire(${src});`);
  if (named.length) {
    // Validate the named exports exist so a bad import name (misspelled or not in
    // this package version) fails fast with a clear message rather than a cryptic
    // React #130 when the undefined binding is later rendered.
    const members = JSON.stringify(named.map((n) => n.name));
    parts.push(`var { ${destructure()} } = __stuardImportNamed(${src}, ${members});`);
  }
  return parts.join(' ');
}

/**
 * Rewrite ESM `import` statements into runtime bindings so component code can
 * use installed packages. React/ReactDOM/Framer map to globals; everything else
 * resolves through the UI packages require shim (which throws a clear error if the
 * package is not installed). Returns diagnostics for imports of modules not in
 * the provided `availableModules` list.
 */
export function rewriteComponentImports(
  code: string,
  availableModules?: string[],
): { code: string; diagnostics: ComponentDiagnostic[] } {
  const diagnostics: ComponentDiagnostic[] = [];
  if (!/\bimport\b/.test(code)) return { code, diagnostics };

  const available = availableModules ? new Set(availableModules) : null;
  const lineAt = (index: number) => code.slice(0, index).split('\n').length;

  const flagUnknown = (source: string, index: number) => {
    if (GLOBAL_IMPORT_ALIASES[source]) return;
    if (available && !available.has(source)) {
      diagnostics.push({
        line: lineAt(index),
        severity: 'error',
        message: `Package "${source}" is not installed for this custom_ui. Install it with ui_packages_install (or pass it in uiPackages).`,
      });
    }
  };

  let out = code.replace(
    /import\s+([^;'"]*?)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (_full, clause: string, source: string, index: number) => {
      flagUnknown(source, index);
      return bindingFor(source, clause);
    },
  );

  // Side-effect-only imports: drop globals, route the rest through the shim.
  out = out.replace(/import\s*['"]([^'"]+)['"]\s*;?/g, (_full, source: string, index: number) => {
    if (GLOBAL_IMPORT_ALIASES[source]) return '';
    flagUnknown(source, index);
    return `__stuardRequire(${JSON.stringify(source)});`;
  });

  return { code: out, diagnostics };
}

/**
 * Validate component code for common issues before rendering.
 *
 * Performs lightweight static analysis:
 * - Checks for App function definition
 * - Detects calls to unknown hooks not provided by the runtime
 * - Flags common JSX mistakes (class= instead of className=)
 *
 * @returns Array of diagnostics with line numbers
 */
export function validateComponentCode(code: string): ComponentDiagnostic[] {
  const diagnostics: ComponentDiagnostic[] = [];
  const lines = code.split('\n');

  // Check for App function
  const hasAppFunction = /function\s+App\s*\(/.test(code)
    || /(?:const|let|var)\s+App\s*=/.test(code);
  if (!hasAppFunction) {
    diagnostics.push({
      line: 1,
      severity: 'error',
      message: 'Component must define a function named "App".',
    });
  }

  // Scan each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for unknown hooks (use* calls not in the runtime)
    const hookRegex = /\b(use[A-Z]\w*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = hookRegex.exec(line)) !== null) {
      const hookName = match[1];
      if (!RUNTIME_HOOKS.has(hookName)) {
        diagnostics.push({
          line: lineNum,
          column: match.index + 1,
          severity: 'error',
          message: `Unknown hook "${hookName}" — not provided by the runtime. Available hooks: ${[...RUNTIME_HOOKS].join(', ')}`,
        });
      }
    }

    // Check for class= in JSX (should be className=)
    if (/<[a-zA-Z]/.test(line) && /\bclass=["'{]/.test(line) && !/className=/.test(line)) {
      diagnostics.push({
        line: lineNum,
        severity: 'warning',
        message: 'Use "className" instead of "class" in JSX.',
      });
    }

    // Check for onclick= (should be onClick=)
    if (/<[a-zA-Z]/.test(line) && /\bonclick=/i.test(line) && !/onClick=/.test(line)) {
      diagnostics.push({
        line: lineNum,
        severity: 'warning',
        message: 'Use "onClick" (camelCase) instead of "onclick" in JSX.',
      });
    }
  }

  return diagnostics;
}

/**
 * Prepare component code for embedding in HTML.
 *
 * - Sanitizes double-escaped strings from LLM output
 * - Strips leaked scaffolding from UI builder
 * - Validates for common issues (undefined hooks, missing App, etc.)
 * - Detects JSX syntax and transforms to React.createElement calls
 *
 * @param code - Raw component code string
 * @param options - Optional: availableModules lists packages installed in the
 *                   selected package set, used to validate `import`s.
 * @returns Object with the processed code, detected syntax type, and diagnostics
 */
export function prepareComponentCode(
  code: string,
  options?: { availableModules?: string[] },
): { code: string; syntax: 'jsx' | 'plain'; diagnostics?: ComponentDiagnostic[] } {
  let processed = code;
  const importDiagnostics: ComponentDiagnostic[] = [];

  // Step 0: Decode HTML entities (common when component code passes through HTML pipelines)
  if (processed.includes('&gt;') || processed.includes('&lt;') || processed.includes('&amp;') || processed.includes('&quot;') || processed.includes('&#039;') || processed.includes('&#39;')) {
    processed = processed
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // Step 1: Sanitize double-escaped strings from LLM JSON output.
  // Only trigger when the code has NO real newlines — meaning all line breaks
  // are still escaped as literal \n, which indicates double JSON encoding.
  // If the code already has real newlines, any \n sequences inside it are
  // legitimate JS escape sequences (e.g., 'Hello\nWorld') and must be preserved.
  const hasRealNewlines = processed.includes('\n');
  const hasLiteralBackslashN = processed.includes('\\n');
  const hasLiteralBackslashQuote = processed.includes('\\"');
  const hasLiteralBackslashBackslash = processed.includes('\\\\');

  if (!hasRealNewlines && (hasLiteralBackslashN || hasLiteralBackslashQuote)) {
    if (hasLiteralBackslashBackslash) {
      processed = processed.replace(/\\\\/g, '\x00BACKSLASH\x00');
    }
    processed = processed
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
    if (hasLiteralBackslashBackslash) {
      processed = processed.replace(/\x00BACKSLASH\x00/g, '\\');
    }
  }

  // Step 2: Strip leaked scaffolding from UI builder
  if (processed.includes('<script') || processed.includes('class="stuard-root"')) {
    processed = processed.replace(/<script[\s\S]*?<\/script>/gi, '');
    let prev = '';
    while (prev !== processed) {
      prev = processed;
      processed = processed.replace(
        /<div\s+class="stuard-root"\s*>((?:(?!<div\s+class="stuard-root")[\s\S])*?)<\/div>/gi,
        '$1'
      );
    }
    processed = processed.replace(/\n{3,}/g, '\n\n');
  }

  // Step 3: Convert HTML-style style="..." to JSX style={{...}}
  // AI models often write style="color: red; font-size: 14px" instead of style={{color: 'red', fontSize: '14px'}}
  // Only apply on lines that look like JSX (contain < tag patterns) to avoid corrupting
  // style="..." patterns inside JS string literals or template literals.
  processed = processed.split('\n').map(line => {
    // Only convert style="..." on lines that contain JSX-like angle brackets
    if (!/<[a-zA-Z]/.test(line)) return line;
    return line.replace(
      /style="([^"]+)"/g,
      (_, cssString: string) => {
        const props = cssString.split(';')
          .map(s => s.trim())
          .filter(Boolean)
          .map(rule => {
            const colonIdx = rule.indexOf(':');
            if (colonIdx < 0) return null;
            const prop = rule.substring(0, colonIdx).trim();
            const value = rule.substring(colonIdx + 1).trim();
            // Convert kebab-case to camelCase
            const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return `${camelProp}: '${value.replace(/'/g, "\\'")}'`;
          })
          .filter(Boolean);
        return props.length > 0 ? `style={{${props.join(', ')}}}` : '';
      }
    );
  }).join('\n');

  // Step 3.5: Rewrite ESM imports into runtime bindings (globals + UI packages shim).
  // Must run before validation/transform — the runtime IIFE cannot use `import`.
  {
    const rewritten = rewriteComponentImports(processed, options?.availableModules);
    processed = rewritten.code;
    importDiagnostics.push(...rewritten.diagnostics);
  }

  // Step 4: Validate before transform (on the pre-transform source for accurate line numbers)
  const diagnostics = [...importDiagnostics, ...validateComponentCode(processed)];
  const errors = diagnostics.filter(d => d.severity === 'error');

  // If there are hard errors (like unknown hooks), log them but still attempt rendering
  // so the runtime error handler can show line-numbered source
  if (errors.length > 0) {
    console.warn('[custom-ui] Component validation found issues:');
    for (const d of diagnostics) {
      console.warn(`  Line ${d.line}: [${d.severity}] ${d.message}`);
    }
  }

  // Step 5: Detect syntax
  const syntax = detectComponentSyntax(processed);

  // Step 6: Transform JSX if detected
  if (syntax === 'jsx') {
    try {
      processed = transformJsx(processed);
    } catch (error: any) {
      console.error('[custom-ui] JSX transform failed:', error.message);
      // Extract line number from sucrase error if available
      const lineMatch = error.message?.match(/\((\d+):(\d+)\)/);
      const errLine = lineMatch ? parseInt(lineMatch[1]) : null;
      const errCol = lineMatch ? parseInt(lineMatch[2]) : null;
      const locationHint = errLine ? ` (line ${errLine}${errCol ? ', col ' + errCol : ''})` : '';
      processed = `
// JSX Transform Error${locationHint}: ${error.message}
function App() {
  return React.createElement('div', { className: 'p-6 space-y-3' },
    React.createElement('h2', { className: 'text-red-500 font-bold text-lg' }, 'JSX Syntax Error'),
    React.createElement('pre', { className: 'text-xs text-red-400 bg-red-50 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap' },
      ${JSON.stringify(error.message)}
    ),
    React.createElement('p', { className: 'text-slate-500 text-sm' }, 'Check the component code for syntax errors.')
  );
}`;
      return { code: processed, syntax: 'jsx', diagnostics };
    }
  }

  return { code: processed, syntax, diagnostics };
}
