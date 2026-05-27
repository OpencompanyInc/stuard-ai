import { defineConfig } from "tsup";

export default defineConfig((options) => ({
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
  minify: !options.watch,
  splitting: false,
  clean: false,
  dts: false,
  shims: false,
  skipNodeModulesBundle: true,
  // @stuardai/* are workspace packages shipped as raw TS (exports map points at
  // .ts source). skipNodeModulesBundle would leave them as runtime require()s of
  // raw TS — which Node can't parse. Force-bundle them so esbuild transpiles +
  // inlines the source into the main bundle.
  noExternal: [/^@stuardai\//],
  external: ["electron", "electron-updater", "node-pty"],
}));
