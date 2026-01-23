import { z } from 'zod';
import { makeLocalTool } from './shared';

const regionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const capture_screen = makeLocalTool(
  'capture_screen',
  'Record the screen (full screen, specific monitor, window, or region). Supports fixed duration or until_stop mode. Can optionally include system audio with silence detection to auto-stop when audio is silent.',
  z.object({
    mode: z
      .enum(['fixed', 'until_stop'])
      .default('fixed')
      .describe('fixed: capture for durationMs. until_stop: capture until stop_screen_capture is called'),
    durationMs: z
      .number()
      .int()
      .optional()
      .describe('Duration in ms for fixed mode (required for fixed mode)'),
    target: z
      .enum(['fullscreen', 'monitor', 'window', 'region'])
      .default('fullscreen')
      .describe('What to capture: fullscreen (all monitors), monitor (single), window (specific app), or region'),
    monitorId: z
      .number()
      .int()
      .optional()
      .describe('Monitor index (0-based) when target=monitor'),
    windowTitle: z
      .string()
      .optional()
      .describe('Window title substring to capture when target=window'),
    region: regionSchema
      .optional()
      .describe('Region coordinates when target=region'),
    includeSystemAudio: z
      .boolean()
      .default(false)
      .describe('Include system audio in the recording (what you hear from speakers)'),
    fps: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(30)
      .describe('Frames per second (1-60)'),
    quality: z
      .enum(['low', 'medium', 'high'])
      .default('medium')
      .describe('Video quality: low (720p), medium (1080p), high (native resolution)'),
    filePath: z
      .string()
      .optional()
      .describe('Output file path (auto-generated if not provided)'),
    sessionId: z
      .string()
      .optional()
      .describe('Session ID for until_stop mode (auto-generated if not provided). Use this ID with stop_screen_capture.'),
    maxDurationMs: z
      .number()
      .int()
      .optional()
      .default(7200000)
      .describe('Safety limit for until_stop mode (default: 2 hours)'),
    silenceThreshold: z
      .number()
      .optional()
      .default(0.01)
      .describe('Audio RMS threshold for silence detection (0.0-1.0, default 0.01). Only applies when includeSystemAudio is true.'),
    silenceDurationMs: z
      .number()
      .int()
      .optional()
      .default(2000)
      .describe('Duration of silence in ms before stopping recording (default 2000). Only applies when includeSystemAudio is true.'),
  }),
  z.object({
    ok: z.boolean(),
    filePath: z.string().optional().describe('Path to the recorded video file'),
    mimeType: z.string().optional().describe('MIME type of the output file'),
    sessionId: z.string().optional().describe('Session ID for this capture'),
    audioFilePath: z.string().optional().describe('Path to the recorded system audio WAV (when includeSystemAudio is true)'),
    stoppedBy: z
      .enum(['stop_signal', 'max_duration', 'silence'])
      .optional()
      .describe('How the capture was stopped (only for until_stop mode)'),
    mode: z.string().optional(),
    status: z.string().optional(),
    hasAudio: z.boolean().optional().describe('Whether the recording includes system audio'),
  }),
  (ctx) => {
    const mode = String((ctx as any)?.mode || 'fixed');
    if (mode === 'until_stop') {
      // until_stop mode returns immediately after starting (non-blocking)
      return 60000; // 60s for setup
    }
    // fixed mode blocks for the entire duration
    const dur = Number((ctx as any)?.durationMs || 0);
    const validDur = isNaN(dur) || dur <= 0 ? 0 : dur;
    // 2 min cushion for long recordings (>5 min), 60s for shorter
    const cushion = validDur > 300000 ? 120000 : 60000;
    return Math.max(validDur + cushion, 60000);
  },
);

export const stop_screen_capture = makeLocalTool(
  'stop_screen_capture',
  'Stop an active screen capture session started with capture_screen in until_stop mode.',
  z.object({
    sessionId: z.string().describe('The session ID returned by capture_screen or provided when starting'),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string(),
    wasActive: z.boolean().describe('Whether the session was actively capturing when stopped'),
    filePath: z.string().optional().describe('Path to the recorded file'),
    audioFilePath: z.string().optional().describe('Path to the recorded system audio WAV (when includeSystemAudio was true)'),
  }),
);

export const describe_screen_capture_capabilities = makeLocalTool(
  'describe_screen_capture_capabilities',
  'List available monitors and windows for screen capture.',
  z.object({}),
  z.object({
    monitors: z.array(
      z.object({
        id: z.number().describe('Monitor index'),
        name: z.string().describe('Monitor name'),
        width: z.number().describe('Width in pixels'),
        height: z.number().describe('Height in pixels'),
        primary: z.boolean().describe('Whether this is the primary monitor'),
        left: z.number().optional().describe('Left position'),
        top: z.number().optional().describe('Top position'),
      }),
    ),
    windows: z.array(
      z.object({
        title: z.string().describe('Window title'),
        handle: z.number().optional().describe('Window handle (Windows only)'),
        pid: z.number().optional().describe('Process ID'),
      }),
    ),
  }),
);

export const capture_system_audio = makeLocalTool(
  'capture_system_audio',
  'Capture system audio output (what you hear from speakers/headphones). Uses loopback recording. On Windows, uses WASAPI loopback. On macOS, requires a virtual audio device like BlackHole.',
  z.object({
    mode: z
      .enum(['fixed', 'until_stop'])
      .default('fixed')
      .describe('fixed: capture for durationMs. until_stop: capture until stop_system_audio is called'),
    durationMs: z
      .number()
      .int()
      .optional()
      .describe('Duration in ms for fixed mode (required for fixed mode)'),
    device: z
      .string()
      .optional()
      .describe('Loopback device name/ID (uses default output if not specified)'),
    filePath: z
      .string()
      .optional()
      .describe('Output file path (auto-generated if not provided)'),
    sessionId: z
      .string()
      .optional()
      .describe('Session ID for until_stop mode (auto-generated if not provided). Use this ID with stop_system_audio.'),
    maxDurationMs: z
      .number()
      .int()
      .optional()
      .default(7200000)
      .describe('Safety limit for until_stop mode (default: 2 hours)'),
    format: z
      .enum(['wav', 'mp3'])
      .default('wav')
      .describe('Output format: wav (uncompressed) or mp3'),
  }),
  z.object({
    ok: z.boolean(),
    filePath: z.string().optional().describe('Path to the recorded audio file'),
    mimeType: z.string().optional().describe('MIME type of the output file'),
    sessionId: z.string().optional().describe('Session ID for this capture'),
    stoppedBy: z
      .enum(['stop_signal', 'max_duration'])
      .optional()
      .describe('How the capture was stopped (only for until_stop mode)'),
    mode: z.string().optional(),
    status: z.string().optional(),
    durationMs: z.number().optional().describe('Duration of the recording in ms'),
  }),
  (ctx) => {
    const mode = String((ctx as any)?.mode || 'fixed');
    if (mode === 'until_stop') {
      return 60000; // 60s for setup (non-blocking)
    }
    const dur = Number((ctx as any)?.durationMs || 0);
    const validDur = isNaN(dur) || dur <= 0 ? 0 : dur;
    const cushion = validDur > 300000 ? 120000 : 60000;
    return Math.max(validDur + cushion, 60000);
  },
);

export const stop_system_audio = makeLocalTool(
  'stop_system_audio',
  'Stop an active system audio capture session started with capture_system_audio in until_stop mode.',
  z.object({
    sessionId: z.string().describe('The session ID returned by capture_system_audio or provided when starting'),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string(),
    wasActive: z.boolean().describe('Whether the session was actively capturing when stopped'),
    filePath: z.string().optional().describe('Path to the recorded file'),
  }),
);

export const describe_system_audio_capabilities = makeLocalTool(
  'describe_system_audio_capabilities',
  'List available loopback/system audio devices and check platform support.',
  z.object({}),
  z.object({
    supported: z.boolean().describe('Whether system audio capture is supported on this platform'),
    platform: z.string().describe('Operating system platform'),
    devices: z.array(
      z.object({
        id: z.string().describe('Device ID'),
        name: z.string().describe('Device name'),
        isDefault: z.boolean().optional().describe('Whether this is the default device'),
        isLoopback: z.boolean().optional().describe('Whether this is a loopback device'),
      }),
    ),
    note: z.string().optional().describe('Platform-specific notes or requirements'),
  }),
);
