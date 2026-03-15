// Prepare the packaged Python agent binary for inclusion in the Electron app.
// This copies a prebuilt agent binary from the monorepo `dist/` folder into
// `apps/desktop/build/agent`, with the OS-specific name that `agent.ts` expects:
//
// - Windows:  "Stuard AI Agent.exe"
// - macOS:    "stuard-agent"
// - Linux:    "stuard-agent"
//
// For Windows we currently ship `dist/stuard-agent.exe` and rename it.
// For macOS/Linux, place a suitable binary at:
//   - `dist/stuard-agent-macos`   (preferred on macOS, falls back to `dist/stuard-agent`)
//   - `dist/stuard-agent-linux`   (preferred on Linux, falls back to `dist/stuard-agent`)
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

function main() {
  // __dirname is apps/desktop/scripts, go up 3 levels to monorepo root
  const rootDir = path.resolve(__dirname, "..", "..", "..");
  const distDir = path.join(rootDir, "dist");
  const buildDir = path.join(__dirname, "..", "build");
  const outDir = path.join(buildDir, "agent");
  const agentSrcDir = path.join(rootDir, "apps", "agent");

  console.log(`[prepare-agent] Root dir: ${rootDir}`);
  console.log(`[prepare-agent] Dist dir: ${distDir}`);
  console.log(`[prepare-agent] Output dir: ${outDir}`);

  // Ensure .env exists for electron-builder extraResources
  // CI creates this with prod/beta URLs; for local dev, create a default
  const envFile = path.join(buildDir, ".env");
  const agentEnvFile = path.join(outDir, ".env");
  ensureDirSync(outDir);
  
  if (!fs.existsSync(envFile)) {
    const defaultEnv = [
      "# Auto-generated for local dev builds",
      "# CI will overwrite with beta/prod URLs",
      "CLOUD_PUBLIC_URL=http://127.0.0.1:8082",
      "CLOUD_AI_HTTP=http://127.0.0.1:8082",
      ""
    ].join("\n");
    fs.writeFileSync(envFile, defaultEnv);
    console.log(`[prepare-agent] Created default .env for local dev: ${envFile}`);
  } else {
    console.log(`[prepare-agent] Using existing .env: ${envFile}`);
  }
  
  // Copy .env to agent directory too
  if (fs.existsSync(envFile)) {
    fs.copyFileSync(envFile, agentEnvFile);
    console.log(`[prepare-agent] Copied .env to agent dir: ${agentEnvFile}`);
  }

  // ── Copy Python scripts needed at runtime (browser_use_server, etc.) ──
  const pythonScripts = ["browser_use_server.py"];
  for (const script of pythonScripts) {
    const src = path.join(agentSrcDir, script);
    if (fs.existsSync(src)) {
      copyFileSync(src, path.join(outDir, script));
    } else {
      console.warn(`[prepare-agent] Python script not found: ${src} — skipping`);
    }
  }

  // ── Copy the app/ Python package (browser_cookies etc.) needed by browser_use_server ──
  const appPkgSrc = path.join(agentSrcDir, "app");
  const appPkgDest = path.join(outDir, "app");
  const appFiles = ["__init__.py", "browser_cookies.py"];
  if (fs.existsSync(appPkgSrc)) {
    ensureDirSync(appPkgDest);
    for (const f of appFiles) {
      const src = path.join(appPkgSrc, f);
      if (fs.existsSync(src)) {
        copyFileSync(src, path.join(appPkgDest, f));
      } else {
        console.warn(`[prepare-agent] app/${f} not found — skipping`);
      }
    }
  } else {
    console.warn(`[prepare-agent] app/ package not found at ${appPkgSrc} — skipping`);
  }

  const platform = process.platform;

  if (!fs.existsSync(distDir)) {
    console.warn(
      `[prepare-agent] Skipping: dist directory not found at ${distDir}. ` +
        `Place your prebuilt agent binaries in dist/ before running this script.`
    );
    return;
  }

  if (platform === "win32") {
    const src = path.join(distDir, "stuard-agent.exe");
    const dest = path.join(outDir, "Stuard AI Agent.exe");

    if (!fs.existsSync(src)) {
      console.warn(
        `[prepare-agent] Windows agent binary not found at ${src}. ` +
          `Expected a prebuilt stuard-agent.exe.`
      );
      return;
    }

    copyFileSync(src, dest);
    return;
  }

  // Non-Windows: use a generic `stuard-agent` name inside the app.
  const generic = path.join(distDir, "stuard-agent");
  const macSpecific = path.join(distDir, "stuard-agent-macos");
  const linuxSpecific = path.join(distDir, "stuard-agent-linux");

  let src = null;
  if (platform === "darwin") {
    if (fs.existsSync(macSpecific)) src = macSpecific;
    else if (fs.existsSync(generic)) src = generic;
  } else if (platform === "linux") {
    if (fs.existsSync(linuxSpecific)) src = linuxSpecific;
    else if (fs.existsSync(generic)) src = generic;
  }

  if (!src) {
    console.warn(
      `[prepare-agent] No suitable agent binary found for platform=${platform}. ` +
        `Looked for: ${platform === "darwin" ? macSpecific : linuxSpecific} and ${generic}`
    );
    return;
  }

  const dest = path.join(outDir, "stuard-agent");
  copyFileSync(src, dest);
}

main();



