// Prepare packaged service binaries for inclusion in the Electron app.
//
// Copies prebuilt binaries from the monorepo `dist/` folder into
// `apps/desktop/build/agent/`, with OS-specific names:
//
//   Service     | Windows                   | macOS / Linux
//   ------------|---------------------------|------------------
//   Agent       | "Stuard AI Agent.exe"     | "stuard-agent"
//   Browser     | "stuard-browser.exe"      | "stuard-browser"
//   MediaPipe   | "stuard-mediapipe.exe"    | "stuard-mediapipe"
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

  // ── Copy Python fallback scripts (used when packaged binaries are absent) ──
  const pythonScripts = ["browser_server_main.py", "browser_use_server.py", "mediapipe_service.py"];
  for (const script of pythonScripts) {
    const src = path.join(agentSrcDir, script);
    if (fs.existsSync(src)) {
      copyFileSync(src, path.join(outDir, script));
    }
  }

  // ── Copy browser_server/ Python package (fallback for dev mode) ──
  const browserServerSrc = path.join(agentSrcDir, "browser_server");
  const browserServerDest = path.join(outDir, "browser_server");
  if (fs.existsSync(browserServerSrc)) {
    ensureDirSync(browserServerDest);
    const serverFiles = fs.readdirSync(browserServerSrc).filter((f) => f.endsWith(".py"));
    for (const f of serverFiles) {
      copyFileSync(path.join(browserServerSrc, f), path.join(browserServerDest, f));
    }
  }

  // ── Copy app/ Python package (fallback) ──
  const appPkgSrc = path.join(agentSrcDir, "app");
  const appPkgDest = path.join(outDir, "app");
  const appFiles = ["__init__.py", "browser_cookies.py"];
  if (fs.existsSync(appPkgSrc)) {
    ensureDirSync(appPkgDest);
    for (const f of appFiles) {
      const src = path.join(appPkgSrc, f);
      if (fs.existsSync(src)) {
        copyFileSync(src, path.join(appPkgDest, f));
      }
    }
  }

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
    destName: process.platform === "win32" ? "Stuard AI Agent.exe" : "stuard-agent",
  });
  if (agentCopied) {
    console.log(`[prepare-agent] Agent binary: OK`);
  } else {
    console.warn(`[prepare-agent] Agent binary: NOT FOUND (will use Python fallback in dev)`);
  }

  // 2. Browser server binary
  const browserCopied = copyServiceBinary(distDir, outDir, {
    winName: "stuard-browser.exe",
    macName: "stuard-browser-macos",
    linuxName: "stuard-browser-linux",
    destName: process.platform === "win32" ? "stuard-browser.exe" : "stuard-browser",
  });
  if (browserCopied) {
    console.log(`[prepare-agent] Browser binary: OK`);
  } else {
    console.warn(`[prepare-agent] Browser binary: NOT FOUND (will use Python fallback)`);
  }

  // 3. MediaPipe service binary (optional — not all builds include it)
  const mediapipeCopied = copyServiceBinary(distDir, outDir, {
    winName: "stuard-mediapipe.exe",
    macName: "stuard-mediapipe-macos",
    linuxName: "stuard-mediapipe-linux",
    destName: process.platform === "win32" ? "stuard-mediapipe.exe" : "stuard-mediapipe",
  });
  if (mediapipeCopied) {
    console.log(`[prepare-agent] MediaPipe binary: OK`);
  } else {
    console.log(`[prepare-agent] MediaPipe binary: NOT FOUND (optional — will install on demand)`);
  }

  // Summary
  const total = [agentCopied, browserCopied, mediapipeCopied].filter(Boolean).length;
  console.log(`\n[prepare-agent] Done. ${total}/3 service binaries packaged.`);
}

main();
