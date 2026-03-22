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
 * Prepare component code for embedding in HTML.
 *
 * - Sanitizes double-escaped strings from LLM output
 * - Strips leaked scaffolding from UI builder
 * - Detects JSX syntax and transforms to React.createElement calls
 *
 * @param code - Raw component code string
 * @returns Object with the processed code and detected syntax type
 */
export function prepareComponentCode(code: string): { code: string; syntax: 'jsx' | 'plain' } {
  let processed = code;

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

  // Step 4: Detect syntax
  const syntax = detectComponentSyntax(processed);

  // Step 5: Transform JSX if detected
  if (syntax === 'jsx') {
    try {
      processed = transformJsx(processed);
    } catch (error: any) {
      console.error('[custom-ui] JSX transform failed:', error.message);
      processed = `
// JSX Transform Error: ${error.message}
function App() {
  return React.createElement('div', { className: 'p-6 space-y-3' },
    React.createElement('h2', { className: 'text-red-500 font-bold text-lg' }, 'JSX Syntax Error'),
    React.createElement('pre', { className: 'text-xs text-red-400 bg-red-50 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap' },
      ${JSON.stringify(error.message)}
    ),
    React.createElement('p', { className: 'text-slate-500 text-sm' }, 'Check the component code for syntax errors.')
  );
}`;
      return { code: processed, syntax: 'jsx' };
    }
  }

  return { code: processed, syntax };
}
