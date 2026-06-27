import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// vm-agent ships as a standalone bundle with no node_modules symlink for the
// workspace package, so mirror the esbuild alias (build.cjs) + tsconfig paths
// here for test resolution. Most-specific subpath first.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@stuardai/workflow-core/runtime', replacement: r('../../packages/workflow-core/src/runtime/index.ts') },
      { find: '@stuardai/workflow-core', replacement: r('../../packages/workflow-core/src/index.ts') },
      { find: '@stuardai/bots-core/bot-memory', replacement: r('../../packages/bots-core/src/bot-memory.ts') },
      { find: '@stuardai/bots-core', replacement: r('../../packages/bots-core/src/index.ts') },
    ],
  },
});
