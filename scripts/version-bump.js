#!/usr/bin/env node
/**
 * version-bump.js — CI/CD-friendly version bump script for the StuardAI monorepo
 *
 * Usage:
 *   node scripts/version-bump.js <version> [--apps=all] [--commit] [--tag] [--push]
 *
 * Examples:
 *   node scripts/version-bump.js 1.2.3                  # Bump all apps, no commit
 *   node scripts/version-bump.js 1.2.3 --commit --tag   # Bump + commit + tag
 *   node scripts/version-bump.js patch                   # Auto-bump patch from current
 *   node scripts/version-bump.js minor --apps=desktop,cloud-ai
 *   node scripts/version-bump.js 2.0.0 --commit --tag --push
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APPS = [
  { key: 'desktop', dir: 'apps/desktop' },
  { key: 'website', dir: 'apps/website' },
  { key: 'cloud-ai', dir: 'apps/cloud-ai' },
  { key: 'ops-console', dir: 'apps/ops-console' },
  { key: 'browser-extension', dir: 'apps/browser-extension' },
];

const ROOT = path.resolve(__dirname, '..');

function readPkgVersion(dir) {
  const p = path.join(ROOT, dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')).version || '0.0.0';
}

function writePkgVersion(dir, version) {
  const p = path.join(ROOT, dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
}

function bumpSemver(current, type) {
  const [major, minor, patch] = current.replace(/^v/, '').split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: return current;
  }
}

function getHighestVersion() {
  const versions = APPS.map(a => readPkgVersion(a.dir)).filter(Boolean);
  return versions.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  })[0] || '0.1.0';
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// ── Parse args ──
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
  Usage: node scripts/version-bump.js <version|patch|minor|major> [options]

  Options:
    --apps=all|desktop,website,...   Apps to bump (default: all)
    --commit                        Auto-commit version changes
    --tag                           Create annotated git tag
    --push                          Push commit and tags to origin
    --dry-run                       Show what would change without writing
  `);
  process.exit(0);
}

const versionArg = args[0];
const flags = {
  commit: args.includes('--commit'),
  tag: args.includes('--tag'),
  push: args.includes('--push'),
  dryRun: args.includes('--dry-run'),
};

const appsFlag = args.find(a => a.startsWith('--apps='));
let selectedKeys = APPS.map(a => a.key);
if (appsFlag) {
  const val = appsFlag.split('=')[1];
  if (val !== 'all') {
    selectedKeys = val.split(',').map(s => s.trim());
  }
}

// Resolve version
let targetVersion;
if (['patch', 'minor', 'major'].includes(versionArg)) {
  const current = getHighestVersion();
  targetVersion = bumpSemver(current, versionArg);
  console.log(`\n  Bump type: ${versionArg} (${current} → ${targetVersion})`);
} else {
  targetVersion = versionArg.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
    console.error(`  Error: Invalid version "${versionArg}". Use semver (e.g. 1.2.3) or patch/minor/major.`);
    process.exit(1);
  }
}

console.log(`\n  Target version: ${targetVersion}`);
console.log(`  Apps: ${selectedKeys.join(', ')}`);
console.log(`  Options: commit=${flags.commit}, tag=${flags.tag}, push=${flags.push}, dry-run=${flags.dryRun}\n`);

// ── Execute bumps ──
const changedFiles = [];
for (const key of selectedKeys) {
  const app = APPS.find(a => a.key === key);
  if (!app) {
    console.warn(`  ⚠ Unknown app: ${key}, skipping`);
    continue;
  }
  const current = readPkgVersion(app.dir);
  if (current === null) {
    console.warn(`  ⚠ No package.json found for ${key}, skipping`);
    continue;
  }
  if (flags.dryRun) {
    console.log(`  [dry-run] ${app.key}: ${current} → ${targetVersion}`);
  } else {
    writePkgVersion(app.dir, targetVersion);
    console.log(`  ✓ ${app.key}: ${current} → ${targetVersion}`);
  }
  changedFiles.push(`${app.dir}/package.json`);
}

if (flags.dryRun) {
  console.log('\n  Dry run complete — no files were modified.\n');
  process.exit(0);
}

// ── Git operations ──
if (flags.commit && changedFiles.length > 0) {
  console.log('\n  Committing version changes...');
  run(`git add ${changedFiles.join(' ')}`);
  run(`git commit -m "chore: bump version to ${targetVersion}"`);
}

if (flags.tag) {
  const tagName = `v${targetVersion}`;
  console.log(`\n  Creating tag ${tagName}...`);
  run(`git tag -a ${tagName} -m "Release ${targetVersion}"`);
}

if (flags.push) {
  console.log('\n  Pushing to origin...');
  run('git push origin HEAD');
  if (flags.tag) run('git push origin --tags');
}

console.log(`\n  Done! Version bumped to ${targetVersion}\n`);
