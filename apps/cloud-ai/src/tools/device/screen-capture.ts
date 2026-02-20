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
  'Record the screen (full screen, specific monitor, window, or region). Supports fixed duration, until_stop, or stream mode. Can optionally include system audio with silence detection to auto-stop when audio is silent.',
  z.object({
    mode: z
      .enum(['fixed', 'until_stop', 'stream'])
      .default('fixed')
      .describe('fixed: capture for duration. until_stop: capture until stop_screen_capture is called. stream: emit live frame/audio chunks until stop_screen_capture is called'),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, enables streaming mode and returns streamId (equivalent to mode="stream").'),
    duration: z
      .number()
      .optional()
      .describe('Duration in seconds for fixed mode (e.g. 5 = 5s). Required for fixed mode.'),
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
    maxDuration: z
      .number()
      .optional()
      .default(7200)
      .describe('Safety time limit in seconds (default: 7200 = 2 hours)'),
    silenceThreshold: z
      .number()
      .optional()
      .default(5)
      .describe('Volume percentage threshold for silence detection (0-100, default 5). Audio below this % is considered silence. Only applies when includeSystemAudio is true.'),
    silenceDuration: z
      .number()
      .optional()
      .default(2)
      .describe('Seconds of silence before stopping recording (default: 2). Only applies when includeSystemAudio is true.'),
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
    streamId: z.string().optional().describe('Stream ID when stream mode is enabled'),
    volumePercent: z.number().optional().describe('Current audio volume level (0-100%). Included in progress events when audio capture is active.'),
  }),
  (ctx) => {
    const mode = String((ctx as any)?.mode || 'fixed');
    const stream = Boolean((ctx as any)?.stream);
    if (mode === 'until_stop' || mode === 'stream' || stream) {
      // until_stop mode returns immediately after starting (non-blocking)
      return 60000; // 60s for setup
    }
    // fixed mode blocks for the entire duration
    const durSec = Number((ctx as any)?.duration || 0);
    const durMs = durSec > 0 ? durSec * 1000 : 0;
    const cushion = durMs > 300000 ? 120000 : 60000;
    return Math.max(durMs + cushion, 60000);
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
  'Capture system audio output (what you hear from speakers/headphones). Uses loopback recording. On Windows, uses WASAPI loopback. On macOS, requires a virtual audio device like BlackHole. Use mode="silence" to stop recording when silence is detected.',
  z.object({
    mode: z
      .enum(['fixed', 'until_stop', 'silence', 'stream'])
      .default('fixed')
      .describe('fixed: capture for duration seconds. until_stop: capture until stop_system_audio is called. silence: capture until silence detected. stream: emit live audio chunks until stop_system_audio is called'),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, enables streaming mode and returns streamId (equivalent to mode="stream").'),
    duration: z
      .number()
      .optional()
      .describe('Duration in seconds for fixed mode (e.g. 5 = 5s). Required for fixed mode.'),
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
    maxDuration: z
      .number()
      .optional()
      .default(7200)
      .describe('Safety time limit in seconds (default: 7200 = 2 hours)'),
    format: z
      .enum(['wav', 'mp3'])
      .default('wav')
      .describe('Output format: wav (uncompressed) or mp3'),
    silenceThreshold: z
      .number()
      .optional()
      .default(5)
      .describe('Volume percentage threshold for silence detection (0-100, default 5). Audio below this % is considered silence. Only applies in silence mode.'),
    silenceDuration: z
      .number()
      .optional()
      .default(2)
      .describe('Seconds of silence before stopping recording (default: 2). Only applies in silence mode.'),
  }),
  z.object({
    ok: z.boolean(),
    filePath: z.string().optional().describe('Path to the recorded audio file'),
    mimeType: z.string().optional().describe('MIME type of the output file'),
    sessionId: z.string().optional().describe('Session ID for this capture'),
    stoppedBy: z
      .enum(['stop_signal', 'max_duration', 'silence'])
      .optional()
      .describe('How the capture was stopped (only for until_stop/silence mode)'),
    mode: z.string().optional(),
    status: z.string().optional(),
    durationMs: z.number().optional().describe('Duration of the recording in ms'),
    streamId: z.string().optional().describe('Stream ID when stream mode is enabled'),
    volumePercent: z.number().optional().describe('Current audio volume level (0-100%). Included in progress events.'),
  }),
  (ctx) => {
    const mode = String((ctx as any)?.mode || 'fixed');
    const stream = Boolean((ctx as any)?.stream);
    if (mode === 'until_stop' || mode === 'stream' || stream) {
      return 60000; // 60s for setup (non-blocking)
    }
    const durSec = Number((ctx as any)?.duration || 0);
    const durMs = durSec > 0 ? durSec * 1000 : 0;
    const cushion = durMs > 300000 ? 120000 : 60000;
    return Math.max(durMs + cushion, 60000);
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
