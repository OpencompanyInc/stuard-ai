/**
 * UI Packages Bundler
 *
 * Compiles a set of npm packages into a single browser IIFE that attaches each
 * module namespace onto `window.__stuardUiPackages.modules`. React / ReactDOM
 * are kept external and mapped to the runtime globals so we never double-bundle
 * React (which would break hooks). CSS imported by packages is emitted to a
 * sibling stylesheet.
 *
 * esbuild runs only at install/build time. Rendering just reads the cached
 * artifact, so the hot path stays fast and offline.
 */

import type { Plugin } from 'esbuild';

/** Bump when the bundle shape or globals change, to invalidate cached builds. */
export const BUNDLER_VERSION = 1;

const JSX_RUNTIME_SHIM = `
  var React = window.React;
  export function jsx(type, props, key) {
    var p = props || {};
    var c = p.children;
    if (key !== undefined) p = Object.assign({}, p, { key: key });
    if (Array.isArray(c)) {
      var rest = Object.assign({}, p, { children: undefined });
      return React.createElement.apply(React, [type, rest].concat(c));
    }
    if (c !== undefined) {
      return React.createElement(type, Object.assign({}, p, { children: undefined }), c);
    }
    return React.createElement(type, p);
  }
  export var jsxs = jsx;
  export var jsxDEV = jsx;
  export var Fragment = React.Fragment;
`;

function reactGlobalPlugin(): Plugin {
  return {
    name: 'stuard-react-global',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stuard-globals' }));
      build.onResolve({ filter: /^react-dom(\/client)?$/ }, (args) => ({ path: args.path, namespace: 'stuard-globals' }));
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'react/jsx-runtime', namespace: 'stuard-globals' }));
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: 'react/jsx-dev-runtime', namespace: 'stuard-globals' }));

      build.onLoad({ filter: /.*/, namespace: 'stuard-globals' }, (args) => {
        if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
          return { contents: JSX_RUNTIME_SHIM, loader: 'js' };
        }
        if (args.path === 'react-dom' || args.path === 'react-dom/client') {
          return { contents: 'module.exports = window.ReactDOM;', loader: 'js' };
        }
        return { contents: 'module.exports = window.React;', loader: 'js' };
      });
    },
  };
}

function buildEntry(packages: string[]): string {
  const lines: string[] = [
    'window.__stuardUiPackages = window.__stuardUiPackages || { modules: {} };',
  ];
  packages.forEach((name, i) => {
    const alias = `__m${i}`;
    lines.push(`import * as ${alias} from ${JSON.stringify(name)};`);
    lines.push(`window.__stuardUiPackages.modules[${JSON.stringify(name)}] = ${alias};`);
  });
  return lines.join('\n');
}

export interface BundleResult {
  js: string;
  css: string;
}

/**
 * Bundle the given packages. `resolveDir` anchors relative resolution (the set
 * dir); `nodePaths` lists node_modules dirs to search (set + app deps).
 */
export async function bundlePackages(options: {
  packages: string[];
  resolveDir: string;
  nodePaths: string[];
}): Promise<BundleResult> {
  const { packages, resolveDir, nodePaths } = options;

  // Lazily require esbuild so a missing optional dep can't crash unrelated
  // custom_ui rendering at module load time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const esbuild = require('esbuild') as typeof import('esbuild');

  const result = await esbuild.build({
    stdin: {
      contents: buildEntry(packages),
      resolveDir,
      loader: 'js',
      sourcefile: 'stuard-ui-packages-entry.js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    minify: true,
    write: false,
    nodePaths,
    plugins: [reactGlobalPlugin()],
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    legalComments: 'none',
  });

  let js = '';
  let css = '';
  for (const file of result.outputFiles || []) {
    if (file.path.endsWith('.css')) css += file.text;
    else js += file.text;
  }

  return { js, css };
}
