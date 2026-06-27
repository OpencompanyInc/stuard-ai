/**
 * Generate electron-updater compatible YAML manifest files for all platforms
 * 
 * Usage: node generate-update-manifest.cjs <version> <channel> <platform>
 * 
 * Example:
 *   node generate-update-manifest.cjs 0.1.6 beta windows
 *   node generate-update-manifest.cjs 0.1.6 stable mac
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const version = args[0] || process.env.APP_VERSION;
const channel = args[1] || process.env.UPDATE_CHANNEL || 'stable';
const platform = args[2] || process.platform;

if (!version) {
  console.error('Error: Version is required');
  console.error('Usage: node generate-update-manifest.cjs <version> <channel> <platform>');
  process.exit(1);
}

const releaseDir = path.join(__dirname, '..', 'release');

function getSha512(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha512');
    hash.update(fileBuffer);
    return hash.digest('base64');
  } catch (err) {
    console.warn(`Warning: Could not compute SHA512 for ${filePath}`);
    return '';
  }
}

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (err) {
    return 0;
  }
}

function generateWindowsManifest() {
  const installerName = `StuardAI-Setup-${version}.exe`;
  const installerPath = path.join(releaseDir, installerName);
  
  if (!fs.existsSync(installerPath)) {
    console.error(`Error: Windows installer not found at ${installerPath}`);
    process.exit(1);
  }
  
  const sha512 = getSha512(installerPath);
  const size = getFileSize(installerPath);
  
  const manifest = `version: ${version}
path: ${installerName}
sha512: ${sha512}
size: ${size}
releaseDate: ${new Date().toISOString()}
`;

  const manifestPath = path.join(releaseDir, 'latest.yml');
  fs.writeFileSync(manifestPath, manifest);
  console.log(`Generated Windows manifest: ${manifestPath}`);
  return manifestPath;
}

function generateMacManifest() {
  // electron-builder generates these files
  const dmgName = `Stuard AI-${version}.dmg`;
  const zipName = `Stuard AI-${version}-mac.zip`;
  
  // Look for the actual files
  const files = fs.readdirSync(releaseDir);
  const dmgFile = files.find(f => f.endsWith('.dmg'));
  const zipFile = files.find(f => f.endsWith('.zip') && f.includes('mac'));
  
  if (!dmgFile && !zipFile) {
    console.error('Error: No macOS installer found');
    process.exit(1);
  }
  
  const primaryFile = zipFile || dmgFile;
  const filePath = path.join(releaseDir, primaryFile);
  const sha512 = getSha512(filePath);
  const size = getFileSize(filePath);
  
  const manifest = `version: ${version}
files:
  - url: ${primaryFile}
    sha512: ${sha512}
    size: ${size}
path: ${primaryFile}
sha512: ${sha512}
releaseDate: ${new Date().toISOString()}
`;

  const manifestPath = path.join(releaseDir, 'latest-mac.yml');
  fs.writeFileSync(manifestPath, manifest);
  console.log(`Generated macOS manifest: ${manifestPath}`);
  return manifestPath;
}

function generateLinuxManifest() {
  const files = fs.readdirSync(releaseDir);
  const appImageFile = files.find(f => f.endsWith('.AppImage'));
  
  if (!appImageFile) {
    console.error('Error: No Linux AppImage found');
    process.exit(1);
  }
  
  const filePath = path.join(releaseDir, appImageFile);
  const sha512 = getSha512(filePath);
  const size = getFileSize(filePath);
  
  const manifest = `version: ${version}
files:
  - url: ${appImageFile}
    sha512: ${sha512}
    size: ${size}
path: ${appImageFile}
sha512: ${sha512}
releaseDate: ${new Date().toISOString()}
`;

  const manifestPath = path.join(releaseDir, 'latest-linux.yml');
  fs.writeFileSync(manifestPath, manifest);
  console.log(`Generated Linux manifest: ${manifestPath}`);
  return manifestPath;
}

// Main
console.log(`Generating update manifest for v${version} (${channel}) on ${platform}`);

let manifestPath;
if (platform === 'win32' || platform === 'windows') {
  manifestPath = generateWindowsManifest();
} else if (platform === 'darwin' || platform === 'mac' || platform === 'macos') {
  manifestPath = generateMacManifest();
} else if (platform === 'linux') {
  manifestPath = generateLinuxManifest();
} else {
  console.error(`Error: Unknown platform ${platform}`);
  process.exit(1);
}

console.log('Done!');
