/**
 * UI Packages — install-once, reuse-everywhere local package sets for custom_ui.
 *
 * Builtin curated packages bundle fully offline; arbitrary packages can be
 * installed via npm when explicitly allowed. The built artifact is cached and
 * keyed by a hash of the resolved package set, so rendering only ever reads a
 * prebuilt bundle.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

import { bundlePackages, BUNDLER_VERSION } from './bundler';
import {
  getAppNodeModulesCandidates,
  getUiPackagesDir,
  getUiPackagesPaths,
  getUiPackagesRoot,
  sanitizeSetId,
} from './paths';
import {
  CURATED_UI_PACKAGES,
  isBuiltinPackage,
  isGlobalAliasPackage,
  isValidPackageName,
} from './registry';
import type {
  InstallUiPackagesOptions,
  UiPackagesBundle,
  UiPackagesManifest,
  UiPackagesMeta,
  UiPackagesStatus,
} from './types';

export { CURATED_UI_PACKAGES, isValidPackageName } from './registry';
export type { UiPackagesStatus, UiPackagesBundle } from './types';

const noop = () => {};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}

/** Directories to start Node resolution from (parent of each node_modules). */
function resolveStartPaths(extra: string[] = []): string[] {
  const nm = getAppNodeModulesCandidates();
  const starts: string[] = [];
  for (const dir of [...extra, ...nm]) {
    starts.push(dir);
    starts.push(path.dirname(dir));
  }
  return Array.from(new Set(starts));
}

function isResolvable(name: string, startPaths: string[]): boolean {
  for (const probe of [`${name}/package.json`, name]) {
    try {
      require.resolve(probe, { paths: startPaths });
      return true;
    } catch {
      /* keep trying */
    }
  }
  return false;
}

function readPackageVersion(name: string, startPaths: string[]): string {
  try {
    const pkgPath = require.resolve(`${name}/package.json`, { paths: startPaths });
    const pkg = readJson<{ version?: string }>(pkgPath);
    return pkg?.version || '0.0.0';
  } catch {
    return 'unknown';
  }
}

/** Node 20+ on Windows rejects .cmd/.bat without shell (EINVAL); npm is a .cmd wrapper. */
function npmSpawnOpts(): { shell: boolean; windowsHide: boolean } {
  return { shell: process.platform === 'win32', windowsHide: true };
}

function detectNpm(): string | null {
  for (const bin of process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm']) {
    try {
      const res = spawnSync(bin, ['--version'], { encoding: 'utf-8', timeout: 15000, ...npmSpawnOpts() });
      if (res.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

function npmInstall(setDir: string, packages: string[], logFn: (m: string) => void): { ok: boolean; error?: string } {
  const npm = detectNpm();
  if (!npm) return { ok: false, error: 'npm is not available on this machine' };

  // Ensure a package.json exists so npm has a project to install into.
  const pkgJsonPath = path.join(setDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    writeJson(pkgJsonPath, { name: 'stuard-ui-packages', private: true, version: '1.0.0' });
  }

  logFn(`ui_packages: npm install ${packages.join(' ')} (this can take a moment)`);
  // Run inside setDir — do NOT pass setDir via --prefix. With shell:true on Windows,
  // paths containing spaces (e.g. …/Stuard AI/…) get split by cmd unless quoted, which
  // Node's argv→shell bridge does not reliably do for every arg.
  const res = spawnSync(
    npm,
    ['install', ...packages, '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: setDir, encoding: 'utf-8', timeout: 5 * 60 * 1000, ...npmSpawnOpts() },
  );
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').toString().trim().slice(-600);
    return { ok: false, error: err || `npm exited with code ${res.status}` };
  }
  return { ok: true };
}

function computeHash(resolved: Array<{ name: string; version: string }>): string {
  const payload = JSON.stringify({
    bundler: BUNDLER_VERSION,
    packages: [...resolved].sort((a, b) => a.name.localeCompare(b.name)),
  });
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

/** Packages that are runtime globals — never bundled, always "available". */
function partitionPackages(packages: string[]): { bundleable: string[]; globals: string[] } {
  const bundleable: string[] = [];
  const globals: string[] = [];
  for (const name of packages) {
    if (isGlobalAliasPackage(name)) globals.push(name);
    else bundleable.push(name);
  }
  return { bundleable, globals };
}

export async function installUiPackages(options: InstallUiPackagesOptions): Promise<UiPackagesStatus> {
  const logFn = options.logFn || noop;
  const setId = sanitizeSetId(options.setId);
  const mode = options.mode || 'add';
  const allowNpm = options.allowNpm === true;
  const paths = getUiPackagesPaths(setId);

  const requested = (options.packages || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);

  const invalid = requested.filter((p) => !isValidPackageName(p));
  if (invalid.length) {
    throw new Error(`Invalid package name(s): ${invalid.join(', ')}`);
  }

  fs.mkdirSync(paths.dir, { recursive: true });

  const existing = readJson<UiPackagesManifest>(paths.manifest);
  const prevPackages = existing?.packages || [];
  const merged = mode === 'set' ? requested : Array.from(new Set([...prevPackages, ...requested]));

  const { bundleable, globals } = partitionPackages(merged);

  // Resolve which packages are present; npm-install the missing ones if allowed.
  const startPaths = resolveStartPaths([paths.nodeModules]);
  const failed: Array<{ name: string; reason: string }> = [];
  const missing = bundleable.filter((p) => !isResolvable(p, startPaths));

  if (missing.length) {
    const offlineMissing = missing.filter((p) => isBuiltinPackage(p));
    if (offlineMissing.length) {
      // Builtin packages should always resolve; surface a clear note if not.
      logFn(`ui_packages: builtin package(s) unexpectedly unresolved: ${offlineMissing.join(', ')}`);
    }
    if (allowNpm) {
      const res = npmInstall(paths.dir, missing, logFn);
      if (!res.ok) {
        for (const p of missing) failed.push({ name: p, reason: res.error || 'npm install failed' });
      }
    } else {
      for (const p of missing) {
        failed.push({
          name: p,
          reason: isBuiltinPackage(p)
            ? 'builtin package not found in app dependencies'
            : 'not a builtin package — re-run with allowNpm: true to install via npm',
        });
      }
    }
  }

  // Recompute resolvable set after any install.
  const startPaths2 = resolveStartPaths([paths.nodeModules]);
  const resolvable = bundleable.filter((p) => isResolvable(p, startPaths2));
  const unresolved = bundleable.filter((p) => !resolvable.includes(p));
  for (const p of unresolved) {
    if (!failed.find((f) => f.name === p)) failed.push({ name: p, reason: 'could not resolve package' });
  }

  const resolvedWithVersions = resolvable.map((name) => ({ name, version: readPackageVersion(name, startPaths2) }));
  const hash = computeHash(resolvedWithVersions);

  // Build (or reuse cached) bundle.
  let js = '';
  let css = '';
  const prevMeta = readJson<UiPackagesMeta>(paths.meta);
  const cacheHit =
    !options.force &&
    failed.length === 0 &&
    unresolved.length === 0 &&
    prevMeta?.hash === hash &&
    fs.existsSync(paths.bundleJs);

  if (cacheHit) {
    logFn(`ui_packages: '${setId}' already built (hash ${hash}), skipping rebuild`);
    js = fs.readFileSync(paths.bundleJs, 'utf-8');
    css = fs.existsSync(paths.bundleCss) ? fs.readFileSync(paths.bundleCss, 'utf-8') : '';
  } else if (resolvable.length > 0) {
    logFn(`ui_packages: bundling ${resolvable.length} package(s) for '${setId}'`);
    try {
      const out = await bundlePackages({
        packages: resolvable,
        resolveDir: paths.dir,
        nodePaths: getAppNodeModulesCandidates().concat(fs.existsSync(paths.nodeModules) ? [paths.nodeModules] : []),
      });
      js = out.js;
      css = out.css;
      fs.writeFileSync(paths.bundleJs, js, 'utf-8');
      fs.writeFileSync(paths.bundleCss, css, 'utf-8');
    } catch (e: any) {
      throw new Error(`ui_packages bundle failed: ${e?.message || e}`);
    }
  } else {
    // Nothing to bundle — write empty artifacts so the set is "built".
    fs.writeFileSync(paths.bundleJs, '', 'utf-8');
    fs.writeFileSync(paths.bundleCss, '', 'utf-8');
  }

  // The set of import names available to component code = bundled + globals.
  const modules = [...resolvable, ...globals];

  const now = new Date().toISOString();
  const manifest: UiPackagesManifest = {
    id: setId,
    packages: merged,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const meta: UiPackagesMeta = {
    hash,
    builtAt: now,
    modules,
    jsBytes: Buffer.byteLength(js, 'utf-8'),
    cssBytes: Buffer.byteLength(css, 'utf-8'),
    bundlerVersion: BUNDLER_VERSION,
    failed: failed.length ? failed : undefined,
  };
  writeJson(paths.manifest, manifest);
  writeJson(paths.meta, meta);

  return toStatus(setId, manifest, meta);
}

function toStatus(setId: string, manifest: UiPackagesManifest | null, meta: UiPackagesMeta | null): UiPackagesStatus {
  return {
    id: setId,
    exists: !!manifest,
    built: !!meta,
    packages: manifest?.packages || [],
    modules: meta?.modules || [],
    hash: meta?.hash,
    builtAt: meta?.builtAt,
    jsBytes: meta?.jsBytes,
    cssBytes: meta?.cssBytes,
    failed: meta?.failed,
  };
}

export function getUiPackagesStatus(setId: string): UiPackagesStatus {
  const id = sanitizeSetId(setId);
  const paths = getUiPackagesPaths(id);
  return toStatus(id, readJson<UiPackagesManifest>(paths.manifest), readJson<UiPackagesMeta>(paths.meta));
}

export function listUiPackageSets(): UiPackagesStatus[] {
  const root = getUiPackagesRoot();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return entries.map((id) => getUiPackagesStatus(id));
}

export function removeUiPackageSet(setId: string): { ok: boolean } {
  const dir = getUiPackagesDir(setId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function loadUiPackagesBundle(setId: string): UiPackagesBundle | null {
  const id = sanitizeSetId(setId);
  const paths = getUiPackagesPaths(id);
  const meta = readJson<UiPackagesMeta>(paths.meta);
  if (!meta || !fs.existsSync(paths.bundleJs)) return null;
  return {
    js: fs.readFileSync(paths.bundleJs, 'utf-8'),
    css: fs.existsSync(paths.bundleCss) ? fs.readFileSync(paths.bundleCss, 'utf-8') : '',
    modules: meta.modules || [],
    hash: meta.hash,
  };
}

/**
 * Convenience for inline `uiPackages` on a custom_ui call: builds (once) a
 * cached, builtin-only set keyed by the package list and returns its bundle.
 * Never shells out to npm, so it is safe to call on the render path.
 */
export async function ensureInlineUiPackages(packages: string[], logFn: (m: string) => void = noop): Promise<UiPackagesBundle | null> {
  const clean = (packages || []).map((p) => String(p || '').trim()).filter(Boolean);
  if (!clean.length) return null;

  const key = crypto.createHash('sha1').update(clean.slice().sort().join(',')).digest('hex').slice(0, 12);
  const setId = `auto_${key}`;

  // Reuse the cached bundle only when it was built by the current bundler. The
  // setId is keyed on the package list alone, so a BUNDLER_VERSION bump (changed
  // bundle shape/globals) must still force a rebuild — otherwise this fast path
  // would serve a stale artifact forever. installUiPackages does the same check
  // for named sets via the version-aware hash; mirror it here.
  const cachedMeta = readJson<UiPackagesMeta>(getUiPackagesPaths(setId).meta);
  if (cachedMeta?.bundlerVersion === BUNDLER_VERSION) {
    const existing = loadUiPackagesBundle(setId);
    if (existing) return existing;
  }

  await installUiPackages({ setId, packages: clean, mode: 'set', allowNpm: false, logFn });
  return loadUiPackagesBundle(setId);
}
