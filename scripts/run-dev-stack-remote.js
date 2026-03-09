#!/usr/bin/env node
const path = require('path');
const concurrently = require('concurrently');

const targetArg = String(process.argv[2] || 'beta').trim().toLowerCase();
const targetAliases = {
  beta: 'beta',
  staging: 'staging',
  prod: 'prod',
  production: 'prod',
};

const target = targetAliases[targetArg];

const endpoints = {
  beta: 'https://beta-api.stuard.ai',
  staging: 'https://staging-api.stuard.ai',
  prod: 'https://api.stuard.ai',
};

if (!target) {
  console.error('[run-dev-stack-remote] Invalid target:', targetArg);
  console.error('[run-dev-stack-remote] Usage: node scripts/run-dev-stack-remote.js <beta|staging|prod>');
  process.exit(1);
}

const cloudHttp = endpoints[target];
const cloudWs = `${cloudHttp.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/+$/, '')}/ws`;
const repoRoot = path.resolve(__dirname, '..');
const sharedEnv = {
  ...process.env,
  CLOUD_AI_HTTP: cloudHttp,
  CLOUD_PUBLIC_URL: cloudHttp,
  VITE_CLOUD_AI_URL: cloudHttp,
  CLOUD_AI_WS: cloudWs,
};

console.log(`[run-dev-stack-remote] Target: ${target}`);
console.log(`[run-dev-stack-remote] CLOUD_AI_HTTP=${cloudHttp}`);
console.log(`[run-dev-stack-remote] CLOUD_AI_WS=${cloudWs}`);
console.log('[run-dev-stack-remote] Starting AGENT, DESKTOP, OPS, WEB (remote cloud, no local Cloud AI)...');

const { result } = concurrently(
  [
    {
      command: 'node scripts/run-agent.js',
      name: 'AGENT',
      cwd: repoRoot,
      env: sharedEnv,
    },
    {
      command: 'npm run dev',
      name: 'DESKTOP',
      cwd: path.join(repoRoot, 'apps', 'desktop'),
      env: sharedEnv,
    },
    {
      command: 'pnpm -F ops-console dev',
      name: 'OPS',
      cwd: repoRoot,
      env: sharedEnv,
    },
    {
      command: 'pnpm -F stuard-ai-website dev',
      name: 'WEB',
      cwd: repoRoot,
      env: sharedEnv,
    },
  ],
  {
    killOthers: ['failure'],
    prefix: 'name',
    timestampFormat: 'HH:mm:ss',
  }
);

result
  .then(() => {
    process.exit(0);
  })
  .catch(() => {
    process.exit(1);
  });
