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
  // Copy runtime data files the bundle reads via import.meta.url (the bundle is a
  // single dist/server.js, so import.meta.url resolves to dist/). Currently the
  // MCP workflow-authoring SKILL.md, read by mcp-server/skills/workflow-authoring.ts.
  // Cross-platform (Node fs, runs on Windows + Linux CI).
  async onSuccess() {
    const { copyFileSync, mkdirSync } = await import('fs');
    const { dirname } = await import('path');
    const src = 'src/mcp-server/skills/workflow-authoring.SKILL.md';
    const dest = 'dist/workflow-authoring.SKILL.md';
    try {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    } catch (err) {
      console.warn('[tsup] failed to copy SKILL.md:', (err as Error)?.message);
    }
  },
});
