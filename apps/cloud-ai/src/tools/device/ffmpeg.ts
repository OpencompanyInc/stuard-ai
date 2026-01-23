import { z } from 'zod';
import { makeLocalTool } from './shared';

export const ffmpeg_status = makeLocalTool(
  'ffmpeg_status',
  'Check if FFmpeg is available locally (downloaded or system-installed).',
  z.object({}),
  z.object({
    ok: z.boolean().optional(),
    available: z.boolean().optional(),
    source: z.string().optional(),
    ffmpegPath: z.string().optional(),
    ffprobePath: z.string().optional(),
    meta: z.any().optional(),
  }),
);

export const ffmpeg_setup = makeLocalTool(
  'ffmpeg_setup',
  'Ensure FFmpeg is available locally (auto-downloads if needed).',
  z.object({}),
  z.any(),
  1200000,
);

export const ffmpeg_run = makeLocalTool(
  'ffmpeg_run',
  'Run FFmpeg with custom arguments. Use for advanced conversions and edits.',
  z.object({
    args: z.array(z.union([z.string(), z.number()])).describe('FFmpeg arguments, not including the ffmpeg executable itself'),
    timeoutMs: z.number().int().min(100).max(1800000).optional().describe('Optional timeout for the FFmpeg process'),
    cwd: z.string().optional().describe('Optional working directory'),
  }),
  z.object({
    ok: z.boolean().optional(),
    exitCode: z.number().int().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    ffmpegPath: z.string().optional(),
  }),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 600000;
  },
);

export const ffmpeg_convert_media = makeLocalTool(
  'ffmpeg_convert_media',
  'Convert media from one format to another using FFmpeg.',
  z.object({
    inputPath: z.string(),
    outputPath: z.string(),
    overwrite: z.boolean().optional().default(true),
    extraArgs: z.array(z.union([z.string(), z.number()])).optional().describe('Additional FFmpeg arguments between input and output'),
    timeoutMs: z.number().int().min(100).max(1800000).optional(),
    cwd: z.string().optional(),
  }),
  z.any(),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 600000;
  },
);

export const ffmpeg_extract_audio = makeLocalTool(
  'ffmpeg_extract_audio',
  'Extract audio from a video/media file into an audio-only output (e.g., mp3, wav).',
  z.object({
    inputPath: z.string(),
    outputPath: z.string(),
    overwrite: z.boolean().optional().default(true),
    timeoutMs: z.number().int().min(100).max(1800000).optional(),
    cwd: z.string().optional(),
  }),
  z.any(),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 600000;
  },
);

export const ffmpeg_trim_media = makeLocalTool(
  'ffmpeg_trim_media',
  'Trim a media file to a time range (fast copy mode).',
  z.object({
    inputPath: z.string(),
    outputPath: z.string(),
    startSeconds: z.number().optional().default(0),
    durationSeconds: z.number().optional(),
    overwrite: z.boolean().optional().default(true),
    timeoutMs: z.number().int().min(100).max(1800000).optional(),
    cwd: z.string().optional(),
  }),
  z.any(),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 600000;
  },
);

export const ffmpeg_probe_media = makeLocalTool(
  'ffmpeg_probe_media',
  'Inspect a media file using ffprobe and return JSON metadata.',
  z.object({
    inputPath: z.string(),
    timeoutMs: z.number().int().min(100).max(1800000).optional(),
    cwd: z.string().optional(),
  }),
  z.object({
    ok: z.boolean().optional(),
    data: z.any().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    ffprobePath: z.string().optional(),
  }),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 300000;
  },
);

export const ffmpeg_extract_frames = makeLocalTool(
  'ffmpeg_extract_frames',
  'Extract image frames from a video to a numbered file pattern (e.g. frames/%04d.jpg).',
  z.object({
    inputPath: z.string(),
    outputPattern: z.string().describe('Output pattern, e.g. C:/frames/%04d.jpg'),
    overwrite: z.boolean().optional().default(true),
    fps: z.number().optional().describe('Optional frames-per-second extraction rate'),
    startSeconds: z.number().optional(),
    durationSeconds: z.number().optional(),
    timeoutMs: z.number().int().min(100).max(1800000).optional(),
    cwd: z.string().optional(),
  }),
  z.any(),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) return Math.min(ms + 30000, 1800000);
    } catch {}
    return 600000;
  },
);
