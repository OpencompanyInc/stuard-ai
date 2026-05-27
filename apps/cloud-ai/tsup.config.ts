import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  minify: true,
  sourcemap: true,
  outDir: 'dist',
  // Clean stale chunks each build so dead code from prior builds can't linger.
  clean: true,
  // better-sqlite3 is a native module — keep it external, resolved at runtime.
  external: ['better-sqlite3'],
  // @stuardai/* workspace packages ship raw TS (their `exports` map points at
  // `.ts` source, not compiled JS). tsup externalizes `dependencies` by default,
  // which would leave `import … from "@stuardai/…"` in the bundle — and the
  // image runs plain `node dist/server.js`, which throws "Unknown file
  // extension .ts" on those. Inline them so the bundle is self-contained.
  // (Mirrors the desktop main bundle's fix; covers bots-core + workflow-core.)
  noExternal: [/^@stuardai\//],
});
