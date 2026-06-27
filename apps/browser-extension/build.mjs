// Build the Stuard Browser Connector (MV3) into ./dist.
//
// We deliberately use plain esbuild instead of @crxjs/vite-plugin: the old
// extension relied on crxjs hashing content-script filenames, which made the
// background↔content wiring fragile ("content scripts with varying hashes").
// Here the background service worker injects everything on demand via
// chrome.scripting / chrome.userScripts, so there are no hashed entrypoints to
// chase — manifest.json references stable, predictable filenames.

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const entryPoints = {
  background: path.join(root, 'src/background/index.ts'),
  popup: path.join(root, 'src/popup/popup.ts'),
};

/** Copy the static assets the manifest references into dist/. */
async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await cp(path.join(root, 'manifest.json'), path.join(outdir, 'manifest.json'));
  await cp(path.join(root, 'src/popup/popup.html'), path.join(outdir, 'popup.html'));
  await cp(path.join(root, 'src/popup/popup.css'), path.join(outdir, 'popup.css'));

  // Reuse the desktop app icon so the toolbar button looks like Stuard.
  // Chrome scales a single PNG for all manifest icon sizes.
  const iconCandidates = [
    path.join(root, 'icon.png'),
    path.join(root, '..', 'desktop', 'build', 'icon.png'),
    path.join(root, '..', 'desktop', 'icons', 'icon2.png'),
  ];
  const icon = iconCandidates.find((p) => existsSync(p));
  if (icon) {
    await cp(icon, path.join(outdir, 'icon.png'));
  } else {
    // 1x1 transparent PNG fallback so the manifest never references a missing file.
    const px = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await writeFile(path.join(outdir, 'icon.png'), px);
  }
}

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

async function run() {
  if (existsSync(outdir)) await rm(outdir, { recursive: true, force: true });
  await copyStatic();

  if (watch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('[stuard-ext] watching for changes → dist/');
  } else {
    await build(buildOptions);
    console.log('[stuard-ext] built → dist/');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
