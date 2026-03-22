/**
 * React Runtime Loader
 * Reads React + ReactDOM + Framer Motion UMD production builds
 * from node_modules at runtime.
 * These are inlined into custom UI HTML for fully offline operation.
 *
 * Since tsup uses skipNodeModulesBundle: true, node_modules remain
 * as external requires and are available at runtime.
 */

import * as fs from 'fs';
import * as path from 'path';

let _reactUmd: string | null = null;
let _reactDomUmd: string | null = null;
let _framerMotionUmd: string | null = null;
let _reactMarkdownBundle: string | null = null;
let _katexCss: string | null = null;

function resolveModulePath(modulePath: string): string {
  try {
    return require.resolve(modulePath);
  } catch {
    // require.resolve may fail for subpaths blocked by package.json "exports".
    // Strategy: resolve the package root via package.json (which is always exported),
    // then join the subpath manually.
    const parts = modulePath.split('/');
    const pkgName = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const subPath = parts.slice(pkgName.split('/').length).join('/');

    if (subPath) {
      try {
        const pkgJson = require.resolve(pkgName + '/package.json');
        const pkgDir = path.dirname(pkgJson);
        const candidate = path.join(pkgDir, subPath);
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }

    // Final fallback: walk up from __dirname looking for node_modules
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, 'node_modules', modulePath);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error(`Cannot resolve module: ${modulePath}`);
  }
}

/**
 * Get the minified React UMD production build (~6KB)
 */
export function getReactUmd(): string {
  if (!_reactUmd) {
    const filePath = resolveModulePath('react/umd/react.production.min.js');
    _reactUmd = fs.readFileSync(filePath, 'utf-8');
  }
  return _reactUmd;
}

/**
 * Get the minified ReactDOM UMD production build (~130KB)
 */
export function getReactDomUmd(): string {
  if (!_reactDomUmd) {
    const filePath = resolveModulePath('react-dom/umd/react-dom.production.min.js');
    _reactDomUmd = fs.readFileSync(filePath, 'utf-8');
  }
  return _reactDomUmd;
}

/**
 * Get the Framer Motion UMD build (~154KB)
 * Exports to window.Motion with motion, AnimatePresence, useAnimation, etc.
 */
export function getFramerMotionUmd(): string {
  if (!_framerMotionUmd) {
    try {
      const filePath = resolveModulePath('framer-motion/dist/framer-motion.js');
      _framerMotionUmd = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      console.error('[custom-ui] Failed to load Framer Motion UMD:', err?.message || err);
      _framerMotionUmd = '// Framer Motion failed to load';
    }
  }
  return _framerMotionUmd;
}

/**
 * Get the pre-built react-markdown + remark-gfm + remark-math + rehype-katex bundle.
 * Built at build time by scripts/build-react-markdown-bundle.cjs using esbuild.
 * Exposes window.ReactMarkdown, window.remarkGfm, window.remarkMath, window.rehypeKatex.
 * Requires React to be loaded first.
 */
export function getReactMarkdownBundle(): string {
  if (!_reactMarkdownBundle) {
    try {
      const mod = require('./react-markdown-bundle') as { REACT_MARKDOWN_BUNDLE?: string };
      _reactMarkdownBundle = typeof mod?.REACT_MARKDOWN_BUNDLE === 'string'
        ? mod.REACT_MARKDOWN_BUNDLE
        : '// react-markdown bundle not found';
    } catch (err: any) {
      console.error('[custom-ui] Failed to load react-markdown bundle:', err?.message || err);
      _reactMarkdownBundle = '// react-markdown bundle failed to load';
    }
  }
  return _reactMarkdownBundle;
}

/**
 * Get the KaTeX CSS for math rendering (~24KB).
 * Pre-built alongside the react-markdown bundle.
 */
export function getKatexCss(): string {
  if (!_katexCss) {
    try {
      const mod = require('./react-markdown-bundle') as { KATEX_CSS?: string };
      _katexCss = typeof mod?.KATEX_CSS === 'string'
        ? mod.KATEX_CSS
        : '';
    } catch (err: any) {
      console.error('[custom-ui] Failed to load KaTeX CSS:', err?.message || err);
      _katexCss = '';
    }
  }
  return _katexCss;
}

/**
 * Get combined React + ReactDOM + Framer Motion + React-Markdown runtime for inlining into HTML.
 */
export function getReactRuntime(): string {
  return getReactUmd() + '\n' + getReactDomUmd() + '\n' + getFramerMotionUmd() + '\n' + getReactMarkdownBundle();
}
