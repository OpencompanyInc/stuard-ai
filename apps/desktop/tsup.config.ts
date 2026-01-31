import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "main/index": "src/main/app.ts",
    "main/custom-ui-preload": "src/main/custom-ui-preload.ts",
    "preload/index": "src/preload/index.ts",
  },
  outDir: "dist",
  sourcemap: true,
  format: ["cjs"],
  target: "node18",
  platform: "node",
  minify: false,
  splitting: false,
  clean: false,
  dts: false,
  shims: false,
  skipNodeModulesBundle: true,
  external: ["electron", "electron-updater", "node-pty-prebuilt-multiarch"],
});
