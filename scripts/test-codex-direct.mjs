#!/usr/bin/env node
/**
 * Standalone Codex backend probe.
 *
 * Reads ~/.codex/auth.json (the file written by `codex login`), pulls the
 * access_token + chatgpt-account-id, and POSTs a tiny non-streaming request
 * to https://chatgpt.com/backend-api/codex/responses with the exact headers
 * cloud-ai's codex-client.ts uses.
 *
 * Run:
 *   node scripts/test-codex-direct.mjs                  # uses gpt-5.3-codex
 *   node scripts/test-codex-direct.mjs gpt-5.2-codex    # override model
 *
 * Output: status code + first ~2KB of response body. If you see the same
 * insufficient_quota error here, the problem is upstream of cloud-ai (the
 * Codex backend itself is rejecting the call for this account/model).
 * If this succeeds but cloud-ai still 402s, the problem is cloud-ai routing
 * the request away from Codex.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MODEL = process.argv[2] || 'gpt-5.3-codex';
const AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');

if (!fs.existsSync(AUTH_PATH)) {
  console.error(`No auth.json at ${AUTH_PATH}. Run 'codex login' first.`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
const accessToken = raw?.tokens?.access_token || raw?.access_token || raw?.accessToken;
if (!accessToken) {
  console.error('No access_token found in auth.json. Keys present:', Object.keys(raw || {}));
  process.exit(1);
}

function extractChatGptAccountId(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const obj = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    const claim = obj?.['https://api.openai.com/auth'];
    return claim?.chatgpt_account_id || claim?.account_id || null;
  } catch {
    return null;
  }
}

const accountId = extractChatGptAccountId(accessToken);
if (!accountId) {
  console.error('Could not extract chatgpt-account-id from access_token JWT.');
  process.exit(1);
}

const sessionId = randomUUID();
const url = 'https://chatgpt.com/backend-api/codex/responses';

const body = {
  model: MODEL,
  instructions: 'You are a probe. Reply with the single word OK.',
  stream: true,
  store: false,
  include: ['reasoning.encrypted_content'],
  reasoning: { effort: 'medium', summary: 'auto' },
  text: { verbosity: 'medium' },
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'ping' }],
    },
  ],
};

const headers = {
  'Content-Type': 'application/json',
  'Accept': 'text/event-stream',
  'Authorization': `Bearer ${accessToken}`,
  'OpenAI-Beta': 'responses=experimental',
  'originator': 'codex_cli_rs',
  'chatgpt-account-id': accountId,
  'session_id': sessionId,
  'conversation_id': sessionId,
};

console.log('═══════════════════════════════════════════════════════════');
console.log('Target :', url);
console.log('Model  :', MODEL);
console.log('Account:', accountId);
console.log('Token  : ***' + accessToken.slice(-6), `(len=${accessToken.length})`);
console.log('═══════════════════════════════════════════════════════════');

const r = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});

console.log('HTTP', r.status, r.statusText);
console.log('Headers:');
for (const [k, v] of r.headers.entries()) {
  if (k.toLowerCase().startsWith('content-') || k.toLowerCase().includes('rate') || k === 'date') {
    console.log(`  ${k}: ${v}`);
  }
}
console.log('───────────────── body (first 2KB) ─────────────────');

const reader = r.body?.getReader();
if (!reader) {
  console.log('(no body)');
  process.exit(r.ok ? 0 : 1);
}

let acc = '';
const decoder = new TextDecoder();
while (acc.length < 2048) {
  const { value, done } = await reader.read();
  if (done) break;
  acc += decoder.decode(value, { stream: true });
}
console.log(acc.slice(0, 2048));
console.log('────────────────────────────────────────────────────');
console.log(r.ok ? '✓ Codex call OK' : '✗ Codex call failed');
process.exit(r.ok ? 0 : 1);
