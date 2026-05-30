// One-off rescue: poll a Gemini async embedding batch until it finishes, then
// write the resulting vectors straight into the local file_index.db via the
// stuard-file-indexer `update-embedding` command. Used to recover a batch whose
// desktop poller was lost on app restart.
//
//   node apply-embed-batch.mjs <batches/JOBID>
//
// Reads GOOGLE_API_KEY from apps/cloud-ai/.env. Logs the completed job + first
// result line so the output format is visible if anything is off.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const JOB = process.argv[2] || 'batches/4llcnce2abtvphkqsv2wbe0mle19qrxr1jug';
const POLL_MS = 30_000;
const MAX_POLLS = 160; // ~80 min

const repo = path.resolve(process.cwd());
const envPath = path.join(repo, 'apps', 'cloud-ai', '.env');
const KEY = (fs.readFileSync(envPath, 'utf8').match(/^GOOGLE_API_KEY=(.*)$/m)?.[1] || '')
  .trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('No GOOGLE_API_KEY in', envPath); process.exit(1); }

const dbPath = path.join(process.env.APPDATA || '', 'StuardAI', 'agent', 'file_index.db');
const bin = path.join(repo, 'apps', 'agent', 'native', 'file-indexer', 'target', 'release', 'stuard-file-indexer.exe');
for (const [label, p] of [['db', dbPath], ['binary', bin]]) {
  if (!fs.existsSync(p)) { console.error(`${label} not found: ${p}`); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url) => (await fetch(url)).json();

function l2normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
}

async function main() {
  let job;
  for (let i = 0; i < MAX_POLLS; i++) {
    job = await get(`https://generativelanguage.googleapis.com/v1beta/${JOB}?key=${KEY}`);
    const m = job?.metadata || {};
    const state = m.state || job?.state;
    const st = m.batchStats || {};
    console.log(`[poll ${i}] state=${state} ${st.successfulRequestCount || 0}/${st.requestCount || '?'} done, ${st.pendingRequestCount || 0} pending`);
    if (state === 'BATCH_STATE_SUCCEEDED') break;
    if (['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'].includes(state)) {
      console.error('Batch did not succeed:', state, JSON.stringify(job).slice(0, 400));
      process.exit(2);
    }
    await sleep(POLL_MS);
  }

  console.log('=== completed job ===');
  console.log(JSON.stringify(job, null, 2).slice(0, 1500));

  // Find the output responses file across possible field names.
  const m = job?.metadata || {};
  const out = m.output || m.dest || {};
  const outFile =
    out.responsesFile || out.fileName || out.file_name || m.responsesFile || (typeof out === 'string' ? out : null);
  if (!outFile) { console.error('No output file found on completed job'); process.exit(3); }
  console.log('output file:', outFile);

  const content = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${outFile}:download?key=${KEY}`)).text();
  const lines = content.split('\n').filter((l) => l.trim());
  console.log(`result lines: ${lines.length}`);
  console.log('=== first result line ===');
  console.log(lines[0]?.slice(0, 600));

  // Group embeddings by fileId (key = `<fileId>::<chunkIdx>`).
  const byFile = new Map();
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const key = o.key || o.metadata?.key || '';
    const r = o.response || o;
    const emb = r?.embedding?.values || (Array.isArray(r?.embedding) ? r.embedding : null) || null;
    if (!key || !Array.isArray(emb) || !emb.length) continue;
    const fileId = key.includes('::') ? key.slice(0, key.lastIndexOf('::')) : key;
    if (!byFile.has(fileId)) byFile.set(fileId, []);
    byFile.get(fileId).push(emb);
  }
  console.log(`files with vectors: ${byFile.size}`);

  let written = 0, failed = 0;
  const tmp = path.join(os.tmpdir(), `vec-${Date.now()}.json`);
  for (const [fileId, vecs] of byFile) {
    const dim = vecs[0].length;
    const avg = new Array(dim).fill(0);
    for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] || 0;
    for (let i = 0; i < dim; i++) avg[i] /= vecs.length;
    const vec = l2normalize(avg);
    fs.writeFileSync(tmp, JSON.stringify(vec));
    try {
      execFileSync(bin, ['update-embedding', '--db', dbPath, '--file-id', fileId, '--vector-file', tmp, '--embedding-model', 'gemini-embedding-2-preview'], { stdio: 'ignore' });
      written++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error('write failed for', fileId, e.message);
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  console.log(`DONE: wrote ${written} file vectors, ${failed} failed (dim=${[...byFile.values()][0]?.[0]?.length})`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
