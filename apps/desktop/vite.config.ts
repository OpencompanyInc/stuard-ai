import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    fs: {
      allow: [
        resolve(__dirname, ".."),
        resolve(__dirname, "../website/assets"),
      ],
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    minify: "terser" as const,
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
      mangle: {
        toplevel: true,
        properties: { regex: /^_/ },
      },
      format: { comments: false },
    },
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
        dashboard: resolve(__dirname, "src/renderer/dashboard.html"),
        onboarding: resolve(__dirname, "src/renderer/onboarding.html"),
workflows: resolve(__dirname, "src/renderer/workflows.html"),
        sidebar: resolve(__dirname, "src/renderer/sidebar.html"),
        notification: resolve(__dirname, "src/renderer/notification.html"),
        voicetest: resolve(__dirname, "src/renderer/voicetest.html"),
        "voice-border": resolve(__dirname, "src/renderer/voice-border.html"),
      },
    },
  },
  resolve: {
    // Only for the npm-based CI desktop build (release matrix), set via
    // STUARD_DESKTOP_NPM_BUILD. There the @stuardai/* workspace packages are
    // symlinked into a FLAT apps/desktop/node_modules; without preserveSymlinks
    // Rollup canonicalises them to packages/<name> and can't resolve their
    // transitive @stuardai imports (e.g. vm-chat -> @stuardai/chat-ui/ui)
    // because the real path only sees the empty root node_modules.
    // Under pnpm (the CI gate + local dev) preserveSymlinks does the OPPOSITE:
    // it breaks resolution of deps that live co-located in the .pnpm store
    // (e.g. framer-motion -> motion-utils), so it must stay off there.
    preserveSymlinks:
      command === "build" && process.env.STUARD_DESKTOP_NPM_BUILD === "1",
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@website-assets": resolve(__dirname, "../website/assets"),
      "clsx": resolve(__dirname, "node_modules/clsx"),
      "lucide-react": resolve(__dirname, "node_modules/lucide-react"),
      "framer-motion": resolve(__dirname, "node_modules/framer-motion"),
      "react-markdown": resolve(__dirname, "node_modules/react-markdown"),
      "rehype-katex": resolve(__dirname, "node_modules/rehype-katex"),
      "remark-gfm": resolve(__dirname, "node_modules/remark-gfm"),
      "remark-math": resolve(__dirname, "node_modules/remark-math"),
    },
  },
}));
