/**
 * Batch-transcode raw screen captures into public/media/*.mp4 for the marketing site.
 *
 * Drop sources in apps/website/public/media/_incoming/{id}.mov (or .mkv / .mp4).
 * Run: pnpm run render:media   (from apps/website)
 *
 * Progress is written to public/media/.render-status.json for /dev/media-render.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, '..');
const publicMedia = path.join(websiteRoot, 'public', 'media');
const incomingDir = path.join(publicMedia, '_incoming');
const statusPath = path.join(publicMedia, '.render-status.json');

const VIDEO_JOBS = [
  { id: 'workflow-demo', path: '/media/workflow-demo.mp4', label: 'Build demo — chat → workflow → mini-app', section: 'Demo' },
  { id: 'toolbelt-browser-form', path: '/media/toolbelt/browser-form.mp4', label: 'Browser auto-filling a form', section: 'Toolbelt' },
  { id: 'toolbelt-ffmpeg-trim', path: '/media/toolbelt/ffmpeg-trim.mp4', label: 'ffmpeg trimming a clip', section: 'Toolbelt' },
  { id: 'toolbelt-file-search', path: '/media/toolbelt/file-search.mp4', label: 'Semantic file search', section: 'Toolbelt' },
  { id: 'toolbelt-gmail-draft', path: '/media/toolbelt/gmail-draft.mp4', label: 'Gmail draft writing itself', section: 'Toolbelt' },
  { id: 'toolbelt-window-control', path: '/media/toolbelt/window-control.mp4', label: 'Screen & windows control', section: 'Toolbelt' },
];

function writeStatus(payload) {
  fs.mkdirSync(publicMedia, { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify({ updatedAt: new Date().toISOString(), ...payload }, null, 2));
}

function findIncomingSource(id) {
  if (!fs.existsSync(incomingDir)) return null;
  const exts = ['.mov', '.mkv', '.mp4', '.webm', '.avi'];
  for (const ext of exts) {
    const p = path.join(incomingDir, `${id}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function outputExists(relPath) {
  const full = path.join(websiteRoot, 'public', relPath.replace(/^\//, ''));
  return fs.existsSync(full) && fs.statSync(full).size > 0;
}

function detectFfmpeg() {
  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const res = spawnSync(bin, ['-version'], {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  return res.status === 0 ? bin : null;
}

function renderOne(ffmpeg, job, sourcePath) {
  const outRel = job.path;
  const outFull = path.join(websiteRoot, 'public', outRel.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(outFull), { recursive: true });
  const tmpOut = `${outFull}.tmp.mp4`;

  const args = [
    '-y',
    '-i',
    sourcePath,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    tmpOut,
  ];

  const res = spawnSync(ffmpeg, args, {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  });

  if (res.status !== 0) {
    try {
      fs.unlinkSync(tmpOut);
    } catch {
      /* ignore */
    }
    const err = (res.stderr || res.stdout || '').trim().slice(-800);
    throw new Error(err || `ffmpeg exited ${res.status}`);
  }

  fs.renameSync(tmpOut, outFull);
}

function main() {
  const ffmpeg = detectFfmpeg();
  if (!ffmpeg) {
    writeStatus({
      running: false,
      error: 'ffmpeg not found on PATH — install FFmpeg or use Stuard’s ffmpeg_setup tool first.',
      current: null,
      remaining: VIDEO_JOBS,
      completed: [],
      skipped: [],
    });
    process.exit(1);
  }

  const completed = [];
  const skipped = [];
  const queue = [];

  for (const job of VIDEO_JOBS) {
    if (outputExists(job.path)) {
      completed.push(job);
      continue;
    }
    const source = findIncomingSource(job.id);
    if (!source) {
      skipped.push({ ...job, reason: 'no file in public/media/_incoming/' });
      continue;
    }
    queue.push({ job, source });
  }

  const remaining = [...queue.map((q) => q.job), ...skipped];

  writeStatus({
    running: true,
    current: null,
    remaining,
    completed: completed.map((j) => j.id),
    skipped: skipped.map((j) => j.id),
    error: null,
  });

  for (let i = 0; i < queue.length; i++) {
    const { job, source } = queue[i];
    const stillRemaining = queue.slice(i + 1).map((q) => q.job);

    writeStatus({
      running: true,
      current: job,
      remaining: stillRemaining,
      completed: completed.map((j) => j.id),
      skipped: skipped.map((j) => j.id),
      error: null,
      log: `Rendering ${job.path} from ${path.basename(source)}…`,
    });

    try {
      renderOne(ffmpeg, job, source);
      completed.push(job);
    } catch (e) {
      writeStatus({
        running: false,
        current: job,
        remaining: stillRemaining,
        completed: completed.map((j) => j.id),
        skipped: skipped.map((j) => j.id),
        error: String(e?.message || e),
        log: `Failed on ${job.path}`,
      });
      process.exit(1);
    }
  }

  const missingOutputs = VIDEO_JOBS.filter((j) => !outputExists(j.path));

  writeStatus({
    running: false,
    current: null,
    remaining: missingOutputs,
    completed: completed.map((j) => j.id),
    skipped: skipped.map((j) => j.id),
    error: null,
    log:
      missingOutputs.length === 0
        ? 'All video outputs present.'
        : `Done. ${missingOutputs.length} still missing (no incoming source or not rendered).`,
  });
}

main();
