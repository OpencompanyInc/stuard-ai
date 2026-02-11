/* eslint-disable no-console */
/**
 * Ensure `node-pty` native binaries match the Electron runtime on Windows.
 *
 * Why:
 * - pnpm installs run in "Node" (your system Node version), but the app runs in Electron.
 * - `node-pty` includes native .node addons that must match Electron's ABI.
 * - Prefer downloading prebuilt Electron binaries; fall back to electron-rebuild if needed.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(msg) {
  console.log(`[postinstall:pty] ${msg}`);
}

function tryResolve(request, fromDir) {
  try {
    return require.resolve(request, { paths: [fromDir] });
  } catch {
    return null;
  }
}

function runNodeScript(scriptPath, args, cwd) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  return res.status ?? 1;
}

function runCommand(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    // Important on Windows for .cmd shims (eg. electron-rebuild.cmd)
    shell: process.platform === 'win32',
  });
  return res.status ?? 1;
}

function cleanupNodePtyBuildArtifacts(nodePtyDir) {
  try {
    const buildDir = path.join(nodePtyDir, 'build');
    if (!fs.existsSync(buildDir)) return;

    const junkExts = new Set([
      '.pdb',
      '.ipdb',
      '.iobj',
      '.lib',
      '.exp',
      '.ilk',
      '.idb',
      '.log',
    ]);

    const junkDirNames = new Set([
      'obj',
      'obj.target',
      '.deps',
      '.cache',
    ]);

    const stack = [buildDir];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (junkDirNames.has(ent.name)) {
            try {
              fs.rmSync(full, { recursive: true, force: true });
            } catch {
              // ignore
            }
            continue;
          }
          stack.push(full);
          continue;
        }

        // Remove common debug/intermediate artifacts produced by MSBuild/node-gyp.
        const lower = ent.name.toLowerCase();
        const ext = path.extname(lower);
        if (junkExts.has(ext) || lower.endsWith('.lastbuildstate') || lower.endsWith('.tlog')) {
          try {
            fs.rmSync(full, { force: true });
          } catch {
            // ignore
          }
        }
      }
    }

    log('cleaned node-pty build artifacts (pdb/ipdb/iobj/obj dirs)');
  } catch (e) {
    log(`warning: cleanup failed (${String(e)})`);
  }
}

function disableSpectreMitigation(bindingGypPath) {
  if (process.platform !== 'win32') return;
  try {
    const src = fs.readFileSync(bindingGypPath, 'utf8');
    if (!src.includes('SpectreMitigation')) return;

    // node-gyp/gyp consume binding.gyp; setting this to false avoids requiring
    // "Spectre-mitigated libraries" (MSB8040) on machines without that VS component.
    const next = src
      .replace(/'SpectreMitigation'\s*:\s*'Spectre'/g, "'SpectreMitigation': 'false'")
      .replace(/"SpectreMitigation"\s*:\s*"Spectre"/g, '"SpectreMitigation": "false"');

    if (next !== src) {
      fs.writeFileSync(bindingGypPath, next, 'utf8');
      log('disabled SpectreMitigation in node-pty binding.gyp');
    }
  } catch (e) {
    log(`warning: failed to patch SpectreMitigation (${String(e)})`);
  }
}

function disableSpectreMitigationForNodePty(nodePtyDir) {
  if (process.platform !== 'win32') return;
  disableSpectreMitigation(path.join(nodePtyDir, 'binding.gyp'));
  disableSpectreMitigation(path.join(nodePtyDir, 'deps', 'winpty', 'src', 'winpty.gyp'));
}

function main() {
  const projectDir = process.cwd();

  const nodePtyPkgPath = tryResolve('node-pty/package.json', projectDir);
  if (!nodePtyPkgPath) {
    log('node-pty not installed; skipping');
    return;
  }
  const nodePtyDir = path.dirname(nodePtyPkgPath);

  const electronPkgPath = tryResolve('electron/package.json', projectDir);
  if (!electronPkgPath) {
    log('electron not installed; skipping electron-targeted install');
    return;
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const electronVersion = require(electronPkgPath).version;

  const prebuildInstallBin =
    tryResolve('prebuild-install/bin.js', nodePtyDir) ||
    tryResolve('prebuild-install/bin', nodePtyDir);

  if (prebuildInstallBin) {
    log(`trying prebuilt node-pty for Electron ${electronVersion}...`);
    const code = runNodeScript(
      prebuildInstallBin,
      ['--runtime=electron', `--target=${electronVersion}`, '--verbose'],
      nodePtyDir
    );
    if (code === 0) {
      log('installed prebuilt Electron binary successfully');
      cleanupNodePtyBuildArtifacts(nodePtyDir);
      return;
    }
    log('prebuilt Electron binary not available (or failed to install); falling back to rebuild');
  } else {
    log('prebuild-install not found inside node-pty; falling back to rebuild');
  }

  // Fallback: rebuild native module against Electron headers (requires build toolchain)
  disableSpectreMitigationForNodePty(nodePtyDir);
  const rebuildCode = runCommand('electron-rebuild', ['-f', '-w', 'node-pty'], projectDir);
  if (rebuildCode !== 0) {
    log('electron-rebuild failed. If you do not have build tools installed, install:');
    log('- Visual Studio Build Tools (Desktop development with C++)');
    log('- Python 3.x (for node-gyp)');
    process.exit(rebuildCode);
  }
  log('electron-rebuild completed');
  cleanupNodePtyBuildArtifacts(nodePtyDir);
}

main();


