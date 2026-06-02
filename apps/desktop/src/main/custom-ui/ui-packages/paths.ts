/**
 * Filesystem layout for custom_ui package sets.
 *
 * Each set is a self-contained directory (install-once, reuse-everywhere):
 *
 *   <userData>/ui-packages/<setId>/
 *     manifest.json   — declared packages + timestamps
 *     meta.json       — built bundle hash + sizes + module list
 *     bundle.js       — esbuild IIFE attaching modules to window.__stuardUiPackages
 *     bundle.css      — collected CSS imported by the bundled packages
 *     node_modules/   — only present when packages were installed via npm
 *     package.json    — only present when packages were installed via npm
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export function sanitizeSetId(setId: string): string {
  const cleaned = String(setId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || 'default';
}

export function getUiPackagesRoot(): string {
  return path.join(app.getPath('userData'), 'ui-packages');
}

export function getUiPackagesDir(setId: string): string {
  return path.join(getUiPackagesRoot(), sanitizeSetId(setId));
}

export function getUiPackagesPaths(setId: string) {
  const dir = getUiPackagesDir(setId);
  return {
    dir,
    manifest: path.join(dir, 'manifest.json'),
    meta: path.join(dir, 'meta.json'),
    bundleJs: path.join(dir, 'bundle.js'),
    bundleCss: path.join(dir, 'bundle.css'),
    nodeModules: path.join(dir, 'node_modules'),
    packageJson: path.join(dir, 'package.json'),
  };
}

/**
 * Candidate `node_modules` directories that hold the desktop app's own
 * dependencies. esbuild uses these (via nodePaths) to resolve builtin curated
 * packages. Handles dev (real tree) and packaged (asar.unpacked) layouts.
 */
export function getAppNodeModulesCandidates(): string[] {
  const candidates: string[] = [];
  const push = (p?: string | null) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  // Packaged: dependencies live unpacked next to the asar so native/binary
  // resolution works. Builtin UI packages are added to asarUnpack for this.
  if (process.resourcesPath) {
    push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'));
    push(path.join(process.resourcesPath, 'app', 'node_modules'));
  }

  // Dev: cwd is apps/desktop; also walk up from this module for monorepo roots.
  push(path.join(process.cwd(), 'node_modules'));

  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    push(path.join(dir, 'node_modules'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return candidates.filter((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  });
}
