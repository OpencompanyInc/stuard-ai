import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { NextResponse } from 'next/server';
import {
  WEBSITE_MEDIA_ASSETS,
  WEBSITE_VIDEO_ASSETS,
  type WebsiteMediaAsset,
} from '@/lib/websiteMediaManifest';

export const dynamic = 'force-dynamic';

const websiteRoot = process.cwd();
const publicMedia = path.join(websiteRoot, 'public', 'media');
const statusPath = path.join(publicMedia, '.render-status.json');
const incomingDir = path.join(publicMedia, '_incoming');

let renderChild: ReturnType<typeof spawn> | null = null;

function isDevAllowed() {
  return process.env.NODE_ENV === 'development';
}

function fileExists(relPath: string) {
  const full = path.join(websiteRoot, 'public', relPath.replace(/^\//, ''));
  try {
    return fs.existsSync(full) && fs.statSync(full).size > 0;
  } catch {
    return false;
  }
}

function hasIncoming(id: string) {
  if (!fs.existsSync(incomingDir)) return false;
  const exts = ['.mov', '.mkv', '.mp4', '.webm', '.avi'];
  return exts.some((ext) => fs.existsSync(path.join(incomingDir, `${id}${ext}`)));
}

function readStatusFile(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(statusPath)) return null;
    return JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildAssetStatus(asset: WebsiteMediaAsset) {
  const onDisk = fileExists(asset.path);
  return {
    ...asset,
    onDisk,
    hasIncoming: asset.kind === 'video' ? hasIncoming(asset.id) : false,
  };
}

function buildSnapshot() {
  const fileStatus = readStatusFile();
  const assets = WEBSITE_MEDIA_ASSETS.map(buildAssetStatus);
  const videos = assets.filter((a) => a.kind === 'video');
  const missingVideos = videos.filter((a) => !a.onDisk);
  const readyToRender = videos.filter((a) => !a.onDisk && a.hasIncoming);

  const runningFromFile = Boolean(fileStatus?.running);
  const runningFromChild = renderChild !== null && renderChild.exitCode === null;
  const running = runningFromFile || runningFromChild;

  const current = (fileStatus?.current as WebsiteMediaAsset | null) ?? null;
  const remainingFromFile = Array.isArray(fileStatus?.remaining)
    ? (fileStatus.remaining as WebsiteMediaAsset[])
    : null;

  const remaining =
    remainingFromFile ??
    (running && current
      ? missingVideos.filter((v) => v.id !== current.id)
      : readyToRender.length > 0
        ? readyToRender
        : missingVideos);

  return {
    running,
    current: running ? current : null,
    remaining,
    completed: Array.isArray(fileStatus?.completed) ? fileStatus.completed : [],
    skipped: Array.isArray(fileStatus?.skipped) ? fileStatus.skipped : [],
    error: typeof fileStatus?.error === 'string' ? fileStatus.error : null,
    log: typeof fileStatus?.log === 'string' ? fileStatus.log : null,
    assets,
    summary: {
      videosTotal: WEBSITE_VIDEO_ASSETS.length,
      videosOnDisk: videos.filter((v) => v.onDisk).length,
      videosMissing: missingVideos.length,
      videosReadyToRender: readyToRender.length,
      imagesMissing: assets.filter((a) => a.kind === 'image' && !a.onDisk).length,
    },
    incomingDir: 'public/media/_incoming/',
  };
}

export async function GET() {
  if (!isDevAllowed()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  return NextResponse.json(buildSnapshot());
}

export async function POST(req: Request) {
  if (!isDevAllowed()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : 'start';

  if (action === 'start') {
    const snap = buildSnapshot();
    if (snap.running) {
      return NextResponse.json({ ok: false, message: 'Render already in progress', ...snap });
    }
    if (snap.summary.videosReadyToRender === 0) {
      return NextResponse.json({
        ok: false,
        message: 'No incoming sources — drop files into public/media/_incoming/{id}.mov',
        ...snap,
      });
    }

    const scriptPath = path.join(websiteRoot, 'scripts', 'render-website-media.mjs');
    renderChild = spawn(process.execPath, [scriptPath], {
      cwd: websiteRoot,
      stdio: 'ignore',
      detached: false,
    });
    renderChild.on('exit', () => {
      renderChild = null;
    });

    return NextResponse.json({
      ok: true,
      message: 'Started batch render',
      ...buildSnapshot(),
    });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
