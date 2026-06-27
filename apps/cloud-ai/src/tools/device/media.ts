import { z } from 'zod';
import { makeLocalTool } from './shared';

export const capture_media = makeLocalTool(
  'capture_media',
  'Capture photos, videos, audio, or combined audiovideo from webcam/microphone. Use mode="until_stop" to capture indefinitely until stop_capture is called. Audio/video/audiovideo captures automatically share the same device between workflows. Use mode="silence" to stop recording when silence is detected for a specified duration. Enable stream=true (or mode="stream") to emit live chunks via a streamId.',
  z.object({
    kind: z.enum(['photo', 'video', 'audio', 'audiovideo']),
    duration: z
      .number()
      .optional()
      .describe('Duration in seconds for fixed mode (e.g. 5 = 5s). Required for video/audio/audiovideo in fixed mode.'),
    device: z.string().optional().describe('Device ID/index for video (optional)'),
    audioDevice: z.string().optional().describe('Audio device ID/index for audiovideo mode (optional)'),
    filePath: z.string().optional().describe('Output file path (auto-generated if not provided)'),
    mode: z
      .enum(['fixed', 'until_stop', 'silence', 'stream'])
      .default('fixed')
      .describe('fixed: capture for duration seconds. until_stop: capture until stop_capture is called. silence: capture until silence detected. stream: emit live chunks until stop_capture is called'),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, enables streaming mode and returns streamId (equivalent to mode="stream").'),
    sessionId: z
      .string()
      .optional()
      .describe('Session ID for until_stop/silence mode (auto-generated if not provided). Use this ID with stop_capture.'),
    maxDuration: z
      .number()
      .optional()
      .default(7200)
      .describe('Safety time limit in seconds (default: 7200 = 2 hours). Increase for longer recordings.'),
    silenceThreshold: z
      .number()
      .optional()
      .default(5)
      .describe('Volume percentage threshold for silence detection (0-100, default 5). Audio below this % is considered silence.'),
    silenceDuration: z
      .number()
      .optional()
      .default(2)
      .describe('Seconds of silence required to stop recording in silence mode. Default: 2'),
    mirror: z
      .boolean()
      .optional()
      .default(false)
      .describe('Horizontally flip (mirror) video frames. Useful for selfie-cam / webcam display.'),
  }),
  z.object({
    ok: z.boolean().optional(),
    filePath: z.string().optional(),
    mimeType: z.string().optional(),
    sessionId: z.string().optional().describe('Session ID for this capture'),
    stoppedBy: z
      .enum(['stop_signal', 'max_duration', 'silence'])
      .optional()
      .describe('How the capture was stopped (only for until_stop/silence mode)'),
    busId: z.string().optional().describe('Bus ID when sharing device'),
    isNewBus: z.boolean().optional().describe('Whether this capture started a new shared bus'),
    subscriberCount: z.number().optional().describe('Number of workflows sharing the device'),
    videoWidth: z.number().optional().describe('Video width for audiovideo mode'),
    videoHeight: z.number().optional().describe('Video height for audiovideo mode'),
    videoFps: z.number().optional().describe('Video FPS for audiovideo mode'),
    audioSamplerate: z.number().optional().describe('Audio sample rate for audiovideo mode'),
    volumePercent: z.number().optional().describe('Current audio volume level (0-100%). Included in progress events.'),
  }),
  (ctx) => {
    const mode = String((ctx as any)?.mode || 'fixed');
    const stream = Boolean((ctx as any)?.stream);
    const kind = String((ctx as any)?.kind || 'photo');
    if (mode === 'until_stop' || mode === 'stream' || stream || kind === 'audiovideo') {
      // until_stop mode and audiovideo return immediately after starting (non-blocking)
      return 60000; // 60s for setup
    }
    // fixed mode blocks for the entire duration
    const durSec = Number((ctx as any)?.duration || 0);
    const durMs = durSec > 0 ? durSec * 1000 : 0;
    const cushion = durMs > 300000 ? 120000 : 60000;
    return Math.max(durMs + cushion, 60000);
  },
);

export const stop_capture = makeLocalTool(
  'stop_capture',
  'Stop an active capture session started with capture_media in until_stop mode. Call this when you want to end recording.',
  z.object({
    sessionId: z.string().describe('The session ID returned by capture_media or provided when starting'),
  }),
  z.object({
    ok: z.boolean(),
    sessionId: z.string(),
    wasActive: z.boolean().describe('Whether the session was actively capturing when stopped'),
    filePath: z.string().optional().describe('Path to the recorded file'),
    busInfo: z
      .object({
        busStopped: z.boolean(),
        remainingSubscribers: z.number(),
      })
      .optional()
      .describe('Bus info if this was a bus-based capture'),
  }),
);

export const list_active_captures = makeLocalTool(
  'list_active_captures',
  'List all currently active capture sessions and media buses.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    sessions: z.array(z.string()).describe('Array of active session IDs'),
    sessionDetails: z
      .array(
        z.object({
          sessionId: z.string(),
          kind: z.string().optional(),
          busMode: z.boolean(),
          busId: z.string().optional(),
          filePath: z.string().optional(),
        }),
      )
      .optional(),
    buses: z
      .array(
        z.object({
          busId: z.string(),
          kind: z.string(),
          device: z.number().nullable(),
          running: z.boolean(),
          subscriberCount: z.number(),
          totalFrames: z.number(),
        }),
      )
      .optional(),
  }),
);

export const describe_media_capture_capabilities = makeLocalTool(
  'describe_media_capture_capabilities',
  'Get media capture tool specs',
  z.object({}),
  z.object({
    devices: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string().optional() })),
  }),
);

export const subscribe_media_bus = makeLocalTool(
  'subscribe_media_bus',
  'Subscribe to a shared media bus. First subscriber starts the capture, others tap into the same stream. Use for multi-workflow scenarios.',
  z.object({
    kind: z.enum(['audio', 'video', 'audiovideo']).describe('Type of media to capture'),
    device: z.union([z.string(), z.number()]).optional().describe('Device ID (string) or index (number) for video'),
    audioDevice: z.union([z.string(), z.number()]).optional().describe('Audio device ID or index for audiovideo mode'),
    subscriberId: z.string().optional().describe('Unique subscriber ID (auto-generated if not provided)'),
    startRecording: z.boolean().optional().default(false).describe('Start recording to file immediately'),
    filePath: z.string().optional().describe('Output file path for recording'),
    silenceThreshold: z.number().optional().describe('Volume percentage threshold for silence detection (0-100). Audio below this % is considered silence.'),
    silenceDurationMs: z.number().optional().describe('Silence duration in ms for audio/audiovideo mode'),
  }),
  z.object({
    ok: z.boolean(),
    busId: z.string().describe('ID of the media bus'),
    subscriberId: z.string(),
    kind: z.string(),
    device: z.number().nullable(),
    isNewBus: z.boolean().describe('Whether this subscription started a new bus'),
    subscriberCount: z.number(),
    filePath: z.string().optional(),
    recording: z.boolean().optional(),
    samplerate: z.number().optional(),
    channels: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    fps: z.number().optional(),
  }),
);

export const unsubscribe_media_bus = makeLocalTool(
  'unsubscribe_media_bus',
  'Unsubscribe from a media bus. Bus auto-stops when last subscriber leaves.',
  z.object({
    kind: z.enum(['audio', 'video', 'audiovideo']),
    device: z.union([z.string(), z.number()]).optional().describe('Device ID or index'),
    subscriberId: z.string().describe('ID of the subscriber to remove'),
    saveRecording: z.boolean().optional().default(true).describe('Save accumulated recording to file'),
  }),
  z.object({
    ok: z.boolean(),
    subscriberId: z.string(),
    busStopped: z.boolean().describe('Whether the bus was stopped (no more subscribers)'),
    remainingSubscribers: z.number(),
    filePath: z.string().optional(),
    wasSubscribed: z.boolean().optional(),
  }),
);

export const get_bus_status = makeLocalTool(
  'get_bus_status',
  'Get status of a specific media bus or all buses.',
  z.object({
    kind: z.enum(['audio', 'video']).optional().describe('Filter by kind (omit for all buses)'),
    device: z.union([z.string(), z.number()]).optional().describe('Device ID or index'),
  }),
  z.object({
    ok: z.boolean(),
    bus: z
      .object({
        busId: z.string(),
        kind: z.string(),
        device: z.number().nullable(),
        running: z.boolean(),
        startedAt: z.number().nullable(),
        totalFrames: z.number(),
        subscriberCount: z.number(),
        subscribers: z.array(z.string()),
        bufferSize: z.number(),
        errors: z.array(z.string()),
      })
      .nullable()
      .optional(),
    buses: z.array(z.any()).optional(),
    running: z.boolean().optional(),
  }),
);

export const list_media_buses = makeLocalTool(
  'list_media_buses',
  'List all active media buses.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    buses: z.array(
      z.object({
        busId: z.string(),
        kind: z.string(),
        device: z.number().nullable(),
        running: z.boolean(),
        startedAt: z.number().nullable(),
        subscriberCount: z.number(),
        subscribers: z.array(z.string()),
        totalFrames: z.number(),
      }),
    ),
  }),
);

export const start_bus_recording = makeLocalTool(
  'start_bus_recording',
  'Start recording for an existing bus subscriber.',
  z.object({
    kind: z.enum(['audio', 'video']),
    device: z.union([z.string(), z.number()]).optional().describe('Device ID or index'),
    subscriberId: z.string().describe('ID of the subscriber'),
    filePath: z.string().optional().describe('Output file path'),
  }),
  z.object({
    ok: z.boolean(),
    subscriberId: z.string(),
    filePath: z.string().optional(),
    recording: z.boolean(),
    alreadyRecording: z.boolean().optional(),
  }),
);

export const stop_bus_recording = makeLocalTool(
  'stop_bus_recording',
  'Stop recording for a bus subscriber and save the file.',
  z.object({
    kind: z.enum(['audio', 'video']),
    device: z.union([z.string(), z.number()]).optional().describe('Device ID or index'),
    subscriberId: z.string().describe('ID of the subscriber'),
    saveRecording: z.boolean().optional().default(true),
  }),
  z.object({
    ok: z.boolean(),
    subscriberId: z.string(),
    filePath: z.string().nullable(),
    chunks: z.number(),
    saved: z.boolean(),
  }),
);

export const stream_speech = makeLocalTool(
  'stream_speech',
  'Stream microphone audio to the cloud speech proxy and emit transcript events.',
  z.object({
    accessToken: z.string(),
    device: z.string().optional(),
    busId: z.string().optional(),
    durationMs: z.number().int().optional(),
    sampleRate: z.number().int().optional(),
  }),
  z.object({ ok: z.boolean().optional(), sessionId: z.string().optional() }),
  (ctx) => {
    const dur = Number((ctx as any)?.durationMs || 0);
    const base = (isNaN(dur) ? 0 : dur) + 60000; // duration + cushion
    return Math.max(base, 60000);
  },
);

export const stop_stream_speech = makeLocalTool(
  'stop_stream_speech',
  'Request stopping an active stream_speech session by logical busId.',
  z.object({ busId: z.string().optional() }),
);
