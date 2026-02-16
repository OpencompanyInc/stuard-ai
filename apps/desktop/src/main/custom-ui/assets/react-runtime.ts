/**
 * React Runtime Loader
 * Reads React + ReactDOM UMD production builds from node_modules at runtime.
 * These are inlined into custom UI HTML for fully offline operation.
 *
 * Since tsup uses skipNodeModulesBundle: true, node_modules remain
 * as external requires and are available at runtime.
 */

import * as fs from 'fs';
import * as path from 'path';

let _reactUmd: string | null = null;
let _reactDomUmd: string | null = null;

function resolveModulePath(modulePath: string): string {
  try {
    return require.resolve(modulePath);
  } catch {
    // Fallback: walk up from __dirname looking for node_modules
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
 * Get combined React + ReactDOM runtime for inlining into HTML.
 * Cached after first call.
 */
export function getReactRuntime(): string {
  return getReactUmd() + '\n' + getReactDomUmd();
}

