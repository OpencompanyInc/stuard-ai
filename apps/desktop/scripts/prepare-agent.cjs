// Prepare packaged service binaries for inclusion in the Electron app.
//
// Copies prebuilt binaries from the monorepo `dist/` folder into
// `apps/desktop/build/agent/`, with OS-specific names:
//
//   Service     | Windows                   | macOS / Linux
//   ------------|---------------------------|------------------
//   Agent       | "Stuard AI.exe"           | "stuard-agent"
//   Browser     | "stuard-browser.exe"      | "stuard-browser"
//   MediaPipe   | "stuard-mediapipe.exe"    | "stuard-mediapipe"
//   Wakeword    | "stuard-wakeword.exe"     | "stuard-wakeword"
//   FileIndexer | "stuard-file-indexer.exe" | "stuard-file-indexer"
//
// When packaged binaries exist, the desktop app spawns them directly.
// When they don't exist, it falls back to `python <script>.py` (dev mode).
//
// This script is idempotent and safe to run in CI before electron-builder.

const fs = require("fs");
const path = require("path");

function ensureDirSync(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function copyFileSync(src, dest) {
  ensureDirSync(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`[prepare-agent] Copied ${src} -> ${dest}`);
}

/**
 * Try to find and copy a platform-specific binary from dist/ to outDir.
 * Returns true if found and copied, false otherwise.
 */
function copyServiceBinary(distDir, outDir, { winName, macName, linuxName, destName }) {
  const platform = process.platform;

  if (platform === "win32") {
    const src = path.join(distDir, winName);
    if (fs.existsSync(src)) {
      copyFileSync(src, path.join(outDir, destName || winName));
      return true;
    }
    return false;
  }

  // macOS / Linux: try platform-specific, then generic
  const genericName = destName || winName.replace(".exe", "");
  const specificName = platform === "darwin" ? macName : linuxName;
  const specific = path.join(distDir, specificName);
  const generic = path.join(distDir, genericName);

  if (fs.existsSync(specific)) {
    copyFileSync(specific, path.join(outDir, genericName));
    return true;
  }
  if (fs.existsSync(generic)) {
    copyFileSync(generic, path.join(outDir, genericName));
    return true;
  }
  return false;
}

function main() {
  const rootDir = path.resolve(__dirname, "..", "..", "..");
  const distDir = path.join(rootDir, "dist");
  const buildDir = path.join(__dirname, "..", "build");
  const outDir = path.join(buildDir, "agent");
  const agentSrcDir = path.join(rootDir, "apps", "agent");

  console.log(`[prepare-agent] Root dir: ${rootDir}`);
  console.log(`[prepare-agent] Dist dir: ${distDir}`);
  console.log(`[prepare-agent] Output dir: ${outDir}`);

  // ── Ensure .env exists ──
  const envFile = path.join(buildDir, ".env");
  const agentEnvFile = path.join(outDir, ".env");
  ensureDirSync(outDir);

  if (!fs.existsSync(envFile)) {
    const defaultEnv = [
      "# Auto-generated for local dev builds",
      "# CI will overwrite with beta/prod URLs",
      "CLOUD_PUBLIC_URL=http://127.0.0.1:8082",
      "CLOUD_AI_HTTP=http://127.0.0.1:8082",
      "",
    ].join("\n");
    fs.writeFileSync(envFile, defaultEnv);
    console.log(`[prepare-agent] Created default .env for local dev: ${envFile}`);
  } else {
    console.log(`[prepare-agent] Using existing .env: ${envFile}`);
  }

  if (fs.existsSync(envFile)) {
    fs.copyFileSync(envFile, agentEnvFile);
    console.log(`[prepare-agent] Copied .env to agent dir: ${agentEnvFile}`);
  }

  // Note: browser-use and mediapipe Python shims and their Python packages
  // (browser_server_main.py, browser_use_server.py, mediapipe_service.py,
  // browser_server/, app/browser_cookies.py) are intentionally NOT copied
  // here. They were originally fallbacks for dev mode, but dev mode reads
  // them directly from apps/agent/ source — bundling them into the release
  // just bloats the installer. In packaged builds, browser-use and
  // mediapipe download their native binaries on demand from R2 into
  // userData/integrations/<service>/.

  // ── Copy packaged service binaries ──
  if (!fs.existsSync(distDir)) {
    console.warn(
      `[prepare-agent] dist/ not found at ${distDir}. ` +
        `Skipping binary copy — Python fallback scripts were copied above.`
    );
    return;
  }

  console.log(`\n[prepare-agent] === Copying service binaries ===`);

  // 1. Agent binary
  const agentCopied = copyServiceBinary(distDir, outDir, {
    winName: "stuard-agent.exe",
    macName: "stuard-agent-macos",
    linuxName: "stuard-agent-linux",
    destName: process.platform === "win32" ? "Stuard AI.exe" : "stuard-agent",
  });
  if (agentCopied) {
    console.log(`[prepare-agent] Agent binary: OK`);
  } else {
    console.warn(`[prepare-agent] Agent binary: NOT FOUND (will use Python fallback in dev)`);
  }

  // 2. Browser server binary — no longer bundled in the app.
  // Downloaded on demand from R2 to userData/integrations/browser/ at runtime.
  const browserCopied = false;
  console.log(`[prepare-agent] Browser binary: SKIPPED (downloaded on demand from R2)`);

  // 3. MediaPipe service binary — no longer bundled in the app.
  // Like browser-use, it's downloaded on demand from R2 into
  // userData/integrations/mediapipe/ at runtime (see mediapipe-service.ts).
  // Bundling the ~hundreds-of-MB native binary into every installer is a waste
  // for a feature most users never touch, so we intentionally skip it here.
  const mediapipeCopied = false;
  console.log(`[prepare-agent] MediaPipe binary: SKIPPED (downloaded on demand from R2)`);

  // 4. Wakeword listener binary (optional in dev, included in release builds)
  const wakewordCopied = copyServiceBinary(distDir, outDir, {
    winName: "stuard-wakeword.exe",
    macName: "stuard-wakeword-macos",
    linuxName: "stuard-wakeword-linux",
    destName: process.platform === "win32" ? "stuard-wakeword.exe" : "stuard-wakeword",
  });
  if (wakewordCopied) {
    console.log(`[prepare-agent] Wakeword binary: OK`);
  } else {
    console.log(`[prepare-agent] Wakeword binary: NOT FOUND (will use Python fallback in dev)`);
  }

  // 5. Native file indexer used by the Python agent for high-throughput scans.
  const fileIndexerCopied = copyServiceBinary(distDir, outDir, {
    winName: "stuard-file-indexer.exe",
    macName: "stuard-file-indexer-macos",
    linuxName: "stuard-file-indexer-linux",
    destName: process.platform === "win32" ? "stuard-file-indexer.exe" : "stuard-file-indexer",
  });
  if (fileIndexerCopied) {
    console.log(`[prepare-agent] File indexer binary: OK`);
  } else {
    console.log(`[prepare-agent] File indexer binary: NOT FOUND (Python scanner fallback will be used)`);
  }

  // Summary
  const total = [agentCopied, browserCopied, mediapipeCopied, wakewordCopied, fileIndexerCopied].filter(Boolean).length;
  console.log(`\n[prepare-agent] Done. ${total}/5 service binaries packaged.`);
}

main();
