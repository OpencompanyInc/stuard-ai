const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function copyNodeTypesForNodeWindowManager(appDir) {
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  const windowManagerPackage = appRequire.resolve('node-window-manager/package.json');
  const nodeTypesPackage = appRequire.resolve('@types/node/package.json');

  const windowManagerDir = path.dirname(windowManagerPackage);
  const nodeTypesDir = path.dirname(nodeTypesPackage);
  const targetDir = path.join(windowManagerDir, 'node_modules', '@types', 'node');

  if (fs.existsSync(path.join(targetDir, 'index.d.ts'))) {
    console.log('[electron-before-build] node-window-manager @types/node already present');
    return;
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(nodeTypesDir, targetDir, { recursive: true });
  console.log(`[electron-before-build] Copied @types/node for node-window-manager rebuild: ${targetDir}`);
}

function disableNativePackagePrepare(appDir, packageName) {
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  const packageJsonPath = appRequire.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  if (!packageJson.scripts?.prepare) {
    return;
  }

  packageJson.scripts.prepare = 'node -e "process.exit(0)"';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`[electron-before-build] Disabled ${packageName} prepare script for Electron native rebuild`);
}

module.exports = async function beforeBuild(context) {
  copyNodeTypesForNodeWindowManager(context.appDir);
  disableNativePackagePrepare(context.appDir, 'node-pty');
  disableNativePackagePrepare(context.appDir, 'node-window-manager');
  return true;
};
