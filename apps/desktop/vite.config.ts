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
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
        dashboard: resolve(__dirname, "src/renderer/dashboard.html"),
        onboarding: resolve(__dirname, "src/renderer/onboarding.html"),
        board: resolve(__dirname, "src/renderer/board.html"),
        workflows: resolve(__dirname, "src/renderer/workflows.html"),
        spaces: resolve(__dirname, "src/renderer/spaces.html"),
        sidebar: resolve(__dirname, "src/renderer/sidebar.html"),
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
