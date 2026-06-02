import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A throwaway userData dir so the on-disk ui-packages layout is isolated per run.
const { userDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  const dir = path.join(os.tmpdir(), `stuard-ui-packages-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return { userDataDir: dir };
});

vi.mock('electron', () => ({
  app: { getPath: (_key: string) => userDataDir },
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  CURATED_UI_PACKAGES,
  ensureInlineUiPackages,
  getUiPackagesStatus,
  installUiPackages,
  isValidPackageName,
  listUiPackageSets,
  loadUiPackagesBundle,
  removeUiPackageSet,
} from '../ui-packages';
import { isBuiltinPackage, isGlobalAliasPackage } from '../ui-packages/registry';
import { rewriteComponentImports } from '../jsx-transform';
import { execUiPackagesInstall, execUiPackagesList } from '../../tools/handlers/ui-packages';

afterAll(() => {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Execute an esbuild package bundle IIFE against a fake window and return its module registry. */
function evalBundle(js: string): Record<string, any> {
  const win: any = {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'self', 'globalThis', js)(win, win, win);
  return (win.__stuardUiPackages && win.__stuardUiPackages.modules) || {};
}

describe('ui-packages registry', () => {
  it('accepts plain and scoped npm names', () => {
    for (const name of ['clsx', 'recharts', 'lucide-react', '@scope/pkg', 'tailwind-merge']) {
      expect(isValidPackageName(name)).toBe(true);
    }
  });

  it('rejects shell metacharacters, paths, and traversal', () => {
    for (const name of ['', '   ', 'a;rm -rf', 'foo && bar', '$(whoami)', '../evil', './local', '/abs/path', 'a/../b', 'pkg with space']) {
      expect(isValidPackageName(name)).toBe(false);
    }
  });

  it('flags curated builtins and runtime globals', () => {
    expect(isBuiltinPackage('clsx')).toBe(true);
    expect(isBuiltinPackage('definitely-not-curated')).toBe(false);
    for (const g of ['react', 'react-dom', 'react-dom/client', 'framer-motion']) {
      expect(isGlobalAliasPackage(g)).toBe(true);
    }
    expect(isGlobalAliasPackage('clsx')).toBe(false);
  });

  it('exposes a curated list to callers', () => {
    expect(CURATED_UI_PACKAGES.some((p) => p.name === 'clsx' && p.builtin)).toBe(true);
  });
});

describe('rewriteComponentImports', () => {
  it('maps react / react-dom / framer-motion to runtime globals', () => {
    const { code } = rewriteComponentImports(
      [
        "import React from 'react';",
        "import { useState } from 'react';",
        "import { motion, AnimatePresence } from 'framer-motion';",
        "import ReactDOM from 'react-dom';",
      ].join('\n'),
    );
    expect(code).toContain('var React = React;');
    expect(code).toContain('var { useState } = React;');
    expect(code).toContain('var { motion, AnimatePresence } = window.Motion;');
    expect(code).toContain('var ReactDOM = ReactDOM;');
    expect(code).not.toContain('__stuardRequire("react")');
  });

  it('routes other packages through the require shim (default vs namespace vs named)', () => {
    const { code } = rewriteComponentImports(
      [
        "import clsx from 'clsx';",
        "import * as charts from 'recharts';",
        "import { twMerge } from 'tailwind-merge';",
        "import 'some-side-effect/styles.css';",
      ].join('\n'),
    );
    expect(code).toContain('var clsx = __stuardImportDefault("clsx");');
    expect(code).toContain('var charts = __stuardRequire("recharts");');
    expect(code).toContain('var { twMerge } = __stuardRequire("tailwind-merge");');
    expect(code).toContain('__stuardRequire("some-side-effect/styles.css");');
  });

  it('emits diagnostics for packages not in the available module list', () => {
    const { diagnostics } = rewriteComponentImports("import x from 'not-installed';\n", ['clsx']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toContain('not-installed');
  });

  it('does not flag runtime globals even when absent from the available list', () => {
    const { diagnostics } = rewriteComponentImports("import React from 'react';\n", ['clsx']);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('installUiPackages (real esbuild bundle)', () => {
  beforeEach(() => {
    // Clear any sets from a prior test so caching assertions are deterministic.
    for (const s of listUiPackageSets()) removeUiPackageSet(s.id);
  });

  it('bundles a curated builtin and round-trips through loadUiPackagesBundle', async () => {
    const status = await installUiPackages({ setId: 'charts-test', packages: ['clsx'], mode: 'set' });

    expect(status.built).toBe(true);
    expect(status.failed).toBeUndefined();
    expect(status.modules).toContain('clsx');
    expect(status.jsBytes).toBeGreaterThan(0);

    const bundle = loadUiPackagesBundle('charts-test');
    expect(bundle).not.toBeNull();
    expect(bundle!.modules).toContain('clsx');
    expect(bundle!.js).toContain('__stuardUiPackages');

    // The emitted IIFE must actually execute and register a usable module.
    const modules = evalBundle(bundle!.js);
    expect(modules.clsx).toBeDefined();
    const clsx = modules.clsx.default ?? modules.clsx;
    expect(typeof clsx).toBe('function');
    expect(clsx('a', false && 'b', 'c')).toBe('a c');
  }, 30000);

  it('bundles a React-importing package against the runtime React global (no double-bundle)', async () => {
    const status = await installUiPackages({ setId: 'icons-test', packages: ['lucide-react'], mode: 'set' });
    expect(status.failed).toBeUndefined();
    expect(status.modules).toContain('lucide-react');

    // Supply the real React as the runtime global the bundle externalizes to.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require('react');
    const win: any = { React, ReactDOM: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'self', 'globalThis', loadUiPackagesBundle('icons-test')!.js)(win, win, win);

    const lucide = win.__stuardUiPackages.modules['lucide-react'];
    expect(lucide).toBeDefined();
    // An icon export must render through the *same* React instance we injected.
    const Icon = lucide.Home ?? lucide.Camera;
    expect(Icon).toBeDefined();
    expect(React.isValidElement(React.createElement(Icon))).toBe(true);
  }, 30000);

  it('reuses the cached bundle on a second identical install', async () => {
    await installUiPackages({ setId: 'cache-test', packages: ['clsx'], mode: 'set' });

    const logs: string[] = [];
    const status = await installUiPackages({
      setId: 'cache-test',
      packages: ['clsx'],
      mode: 'set',
      logFn: (m) => logs.push(m),
    });

    expect(status.built).toBe(true);
    expect(logs.some((m) => m.includes('already built'))).toBe(true);
  }, 30000);

  it('treats react/framer-motion as globals (listed in modules, never bundled)', async () => {
    const status = await installUiPackages({ setId: 'globals-test', packages: ['react', 'clsx'], mode: 'set' });

    expect(status.failed).toBeUndefined();
    expect(status.modules).toEqual(expect.arrayContaining(['clsx', 'react']));

    // react must NOT be bundled into the artifact — only clsx is registered there.
    const modules = evalBundle(loadUiPackagesBundle('globals-test')!.js);
    expect(Object.keys(modules)).toContain('clsx');
    expect(Object.keys(modules)).not.toContain('react');
  }, 30000);

  it('rejects invalid package names before doing any work', async () => {
    await expect(installUiPackages({ setId: 'bad', packages: ['$(rm -rf /)'], mode: 'set' })).rejects.toThrow(
      /Invalid package name/,
    );
  });

  it('reports a clear failure for non-builtin packages when allowNpm is off', async () => {
    const status = await installUiPackages({
      setId: 'missing-test',
      packages: ['totally-not-a-real-package-xyz'],
      mode: 'set',
      allowNpm: false,
    });

    expect(status.modules).toHaveLength(0);
    expect(status.failed).toBeDefined();
    expect(status.failed![0].name).toBe('totally-not-a-real-package-xyz');
    expect(status.failed![0].reason).toMatch(/allowNpm/);
  }, 30000);

  it('merges packages in add mode and replaces them in set mode', async () => {
    await installUiPackages({ setId: 'mode-test', packages: ['clsx'], mode: 'set' });
    const added = await installUiPackages({ setId: 'mode-test', packages: ['tailwind-merge'], mode: 'add' });
    expect(added.packages).toEqual(expect.arrayContaining(['clsx', 'tailwind-merge']));

    const replaced = await installUiPackages({ setId: 'mode-test', packages: ['clsx'], mode: 'set' });
    expect(replaced.packages).toEqual(['clsx']);
  }, 30000);

  it('ensureInlineUiPackages builds a cached auto set from a bare list', async () => {
    const bundle = await ensureInlineUiPackages(['clsx']);
    expect(bundle).not.toBeNull();
    expect(bundle!.modules).toContain('clsx');

    // The auto set is discoverable and reused (no rebuild on a second call).
    const auto = listUiPackageSets().find((s) => s.id.startsWith('auto_'));
    expect(auto).toBeDefined();
  }, 30000);

  it('rebuilds an inline auto set when its cached bundler version is stale', async () => {
    await ensureInlineUiPackages(['clsx']);
    const auto = listUiPackageSets().find((s) => s.id.startsWith('auto_'))!;
    expect(auto).toBeDefined();

    // Simulate a BUNDLER_VERSION bump: an older bundler wrote both an older
    // version stamp AND a hash computed from that older version (the cache hash
    // folds BUNDLER_VERSION in), so both fields differ from what we'd build now.
    const dir = path.join(userDataDir, 'ui-packages', auto.id);
    const metaPath = path.join(dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.bundlerVersion = 0; // older than current BUNDLER_VERSION
    meta.hash = 'stalehash000000'; // what an older bundler would have stored
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, 'bundle.js'), '/* stale */');

    const rebuilt = await ensureInlineUiPackages(['clsx']);
    expect(rebuilt!.js).not.toContain('/* stale */');
    expect(rebuilt!.js).toContain('__stuardUiPackages');
    const freshMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(freshMeta.bundlerVersion).toBeGreaterThan(0);
  }, 30000);

  it('status + remove reflect the on-disk lifecycle', async () => {
    await installUiPackages({ setId: 'lifecycle', packages: ['clsx'], mode: 'set' });
    expect(getUiPackagesStatus('lifecycle').built).toBe(true);

    removeUiPackageSet('lifecycle');
    const after = getUiPackagesStatus('lifecycle');
    expect(after.exists).toBe(false);
    expect(after.built).toBe(false);
  }, 30000);
});

describe('ui-packages tool handlers', () => {
  beforeEach(() => {
    for (const s of listUiPackageSets()) removeUiPackageSet(s.id);
  });

  it('parses comma/space-separated package strings and a custom set name', async () => {
    const res = await execUiPackagesInstall(
      { set: 'handler-set', packages: 'clsx, tailwind-merge', mode: 'set' },
      { logFn: () => {} } as any,
    );
    expect(res.ok).toBe(true);
    expect(res.set).toBe('handler-set');
    expect(res.installed).toEqual(expect.arrayContaining(['clsx', 'tailwind-merge']));
  }, 30000);

  it('returns a curated catalog when no packages are supplied', async () => {
    const res = await execUiPackagesInstall({ set: 'empty' }, { logFn: () => {} } as any);
    expect(res.ok).toBe(false);
    expect(res.curated).toEqual(CURATED_UI_PACKAGES);
  });

  it('lists installed sets alongside the curated catalog', async () => {
    await installUiPackages({ setId: 'listed', packages: ['clsx'], mode: 'set' });
    const res = await execUiPackagesList({}, { logFn: () => {} } as any);
    expect(res.ok).toBe(true);
    expect(res.sets.some((s: any) => s.id === 'listed')).toBe(true);
    expect(res.curated).toEqual(CURATED_UI_PACKAGES);
  }, 30000);
});
