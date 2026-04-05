import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(() => ({
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
    minify: "terser",
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
        board: resolve(__dirname, "src/renderer/board.html"),
        workflows: resolve(__dirname, "src/renderer/workflows.html"),
        spaces: resolve(__dirname, "src/renderer/spaces.html"),
        sidebar: resolve(__dirname, "src/renderer/sidebar.html"),
        notification: resolve(__dirname, "src/renderer/notification.html"),
        voicetest: resolve(__dirname, "src/renderer/voicetest.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@website-assets": resolve(__dirname, "../website/assets"),
    },
  },
}));
