/**
 * useVoiceMode — Real-time voice conversation hook.
 *
 * Manages the full lifecycle: WebSocket to cloud-ai /voice endpoint,
 * microphone capture, audio playback, audio level metering, transcripts,
 * and voice state (idle → connecting → listening → thinking → speaking).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { describeTool } from '../components/voice/voiceLabels';

// ─── Types ─────────────────────────────────────────────────────────────────

export type VoiceModeState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

export interface TranscriptLine {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VoiceToolEvent {
  callId: string;
  name: string;
  args?: Record<string, any>;
  /** Friendly label for status surfaces. */
  label: string;
  /** When the call started (for elapsed-time display). */
  startedAt: number;
  /** Optional sub-label for delegation: e.g. "browser agent". */
  detail?: string;
}

export interface VoiceModeOptions {
  /** Override the voice WebSocket URL (defaults to auto-detect from __CLOUD_AI_HTTP__) */
  wsUrl?: string;
  /** ElevenLabs agent ID (sent in config) */
  agentId?: string;
  /** Provider to use (defaults to server default) */
  provider?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Initial message the agent speaks first */
  initialMessage?: string;
}

export interface VoiceModeReturn {
  /** Current voice state */
  state: VoiceModeState;
  /** Whether the mic is muted */
  muted: boolean;
  /** Audio level 0-1 (smoothed, for orb reactivity) */
  audioLevel: number;
  /** Live transcript lines */
  transcripts: TranscriptLine[];
  /** Current tool being called (if any) */
  activeTool: string | null;
  /** All currently in-flight tool calls (multiple may run in parallel via delegate). */
  activeTools: VoiceToolEvent[];
  /** Most recently completed tool, briefly held for "Just did X" UI. */
  lastTool: VoiceToolEvent | null;
  /** Start a voice session */
  start: () => Promise<void>;
  /** End the voice session */
  stop: () => void;
  /** Toggle mic mute */
  toggleMute: () => void;
  /** Send an interrupt (stop agent speaking) */
  interrupt: () => void;
  /** Error message if something went wrong */
  error: string | null;
}

// ─── Audio Utilities ───────────────────────────────────────────────────────

function resample(input: Float32Array, sourceSR: number, targetSR: number): Float32Array {
  if (sourceSR === targetSR) return input;
  const ratio = sourceSR / targetSR;
  const len = Math.round(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = idx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

function float32ToInt16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Compute RMS audio level from Float32 samples, returns 0-1 */
function computeRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Queued PCM16 24kHz audio player.
 * Schedules chunks sequentially so they don't overlap.
 */
class AudioChunkPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private gainNode: GainNode;
  private analyser: AnalyserNode;
  private _lastLevel = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gainNode.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  play(pcm16: ArrayBuffer) {
    const int16 = new Int16Array(pcm16);
    if (int16.length === 0) return;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }
    const buffer = this.ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
  }

  /** Get current output audio level (0-1) */
  getLevel(): number {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    this._lastLevel = Math.sqrt(sum / data.length);
    return this._lastLevel;
  }

  flush() {
    this.nextTime = 0;
  }
}

// ─── Resolve voice WS URL ──────────────────────────────────────────────────

function getVoiceWsUrl(): string {
  const httpUrl = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || '';
  if (httpUrl) {
    return httpUrl.replace(/^https?:\/\//, (m: string) => m.startsWith('https') ? 'wss://' : 'ws://') + '/voice';
  }
  return 'ws://127.0.0.1:8082/voice';
}

// ─── Hook ──────────────────────────────────────────────────────────────────

let lineIdCounter = 0;

export function useVoiceMode(options: VoiceModeOptions = {}): VoiceModeReturn {
  const [state, setState] = useState<VoiceModeState>('idle');
  const [muted, setMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptLine[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<VoiceToolEvent[]>([]);
  const [lastTool, setLastTool] = useState<VoiceToolEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastToolTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for mutable session state
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<AudioChunkPlayer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedRef = useRef(false);
  const stateRef = useRef<VoiceModeState>('idle');
  const levelRafRef = useRef(0);
  const smoothedInputLevel = useRef(0);
  const smoothedOutputLevel = useRef(0);

  // Keep refs in sync
  mutedRef.current = muted;
  stateRef.current = state;

  // ─── Cleanup helpers ───────────────────────────────────────────────────

  const stopMic = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = 0;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopMic();
    stopLevelMeter();
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    playerRef.current = null;
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    setState('idle');
    setAudioLevel(0);
    setActiveTool(null);
    setActiveTools([]);
    setLastTool(null);
    if (lastToolTimeoutRef.current) {
      clearTimeout(lastToolTimeoutRef.current);
      lastToolTimeoutRef.current = null;
    }
    smoothedInputLevel.current = 0;
    smoothedOutputLevel.current = 0;
  }, [stopMic, stopLevelMeter]);

  // ─── Audio level metering loop ─────────────────────────────────────────

  const startLevelMeter = useCallback(() => {
    const tick = () => {
      const s = stateRef.current;
      let level = 0;

      if (s === 'listening') {
        // Use smoothed input level from mic processor
        level = smoothedInputLevel.current;
      } else if (s === 'speaking' && playerRef.current) {
        // Use output analyser level
        const raw = playerRef.current.getLevel();
        smoothedOutputLevel.current += (raw - smoothedOutputLevel.current) * 0.15;
        level = Math.min(1, smoothedOutputLevel.current * 3); // amplify for visual effect
      }

      setAudioLevel(level);
      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ─── Start mic capture ─────────────────────────────────────────────────

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 48000 });
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      audioCtxRef.current = audioCtx;
      playerRef.current = new AudioChunkPlayer(audioCtx);

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);

        // Compute input audio level for metering
        const rms = computeRMS(input);
        smoothedInputLevel.current += (Math.min(1, rms * 5) - smoothedInputLevel.current) * 0.2;

        // Don't send audio if muted or not connected
        if (mutedRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        // Resample 48kHz → 24kHz and send as PCM16
        const resampled = resample(input, audioCtx.sampleRate, 24000);
        const pcm16 = float32ToInt16(resampled);
        wsRef.current.send(pcm16);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setState('listening');
      startLevelMeter();
    } catch (err: any) {
      setError(`Microphone error: ${err?.message || 'Could not access microphone'}`);
      setState('idle');
    }
  }, [startLevelMeter]);

  // ─── Start voice session ───────────────────────────────────────────────

  const start = useCallback(async () => {
    if (wsRef.current) return;

    setError(null);
    setTranscripts([]);
    setActiveTool(null);
    setState('connecting');

    // Get auth token
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) {
      setError('Not signed in. Please sign in first.');
      setState('idle');
      return;
    }

    // The desktop's persistent /ws?client=desktop connection is the cloud's
    // tool/context bridge for both text and voice — no per-session handshake
    // needed here.
    const url = options.wsUrl || getVoiceWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
    };

    ws.onmessage = (ev) => {
      // Binary = audio from provider
      if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((buf) => {
          if (playerRef.current) {
            playerRef.current.play(buf);
          }
        });
        // When we receive audio, we're in speaking state
        if (stateRef.current !== 'speaking') {
          setState('speaking');
        }
        return;
      }

      try {
        const msg = JSON.parse(ev.data);

        if (msg.type === 'authenticated') {
          ws.send(JSON.stringify({
            type: 'config',
            provider: options.provider || undefined,
            agentId: options.agentId || undefined,
            systemPrompt: options.systemPrompt || undefined,
            initialMessage: options.initialMessage || undefined,
          }));
        }

        if (msg.type === 'ready') {
          // Session is ready — start capturing mic
          startMic();
        }

        if (msg.type === 'transcript') {
          const id = ++lineIdCounter;
          const line: TranscriptLine = {
            id,
            role: msg.role,
            text: msg.text,
            isFinal: msg.isFinal,
            timestamp: Date.now(),
          };

          setTranscripts(prev => {
            // Replace last non-final from same role, or append
            if (!msg.isFinal && prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.role === msg.role && !last.isFinal) {
                return [...prev.slice(0, -1), line];
              }
            }
            return [...prev, line];
          });

          // Update state based on who is speaking
          if (msg.role === 'user') {
            setState('listening');
          } else if (msg.role === 'assistant' && !msg.isFinal) {
            setState('speaking');
          }
        }

        if (msg.type === 'interruption') {
          // User interrupted the agent
          playerRef.current?.flush();
          setState('listening');
        }

        if (msg.type === 'tool_call') {
          const name = String(msg.name || msg.tool || '');
          if (name) {
            const callId = String(msg.callId || `${name}-${Date.now()}`);
            const args = (msg.args && typeof msg.args === 'object') ? msg.args : undefined;
            const { label, detail } = describeTool(name, args);
            const event: VoiceToolEvent = {
              callId,
              name,
              args,
              label,
              detail,
              startedAt: Date.now(),
            };
            setActiveTool(name);
            setActiveTools(prev => {
              const next = prev.filter(t => t.callId !== callId);
              next.push(event);
              return next;
            });
            setState('thinking');
          }
        }

        if (msg.type === 'tool_result') {
          const callId = String(msg.callId || '');
          let resolved: VoiceToolEvent | undefined;
          setActiveTools(prev => {
            const match = prev.find(t => t.callId === callId);
            if (match) resolved = match;
            return prev.filter(t => t.callId !== callId);
          });
          if (resolved) {
            setLastTool(resolved);
            if (lastToolTimeoutRef.current) clearTimeout(lastToolTimeoutRef.current);
            lastToolTimeoutRef.current = setTimeout(() => setLastTool(null), 2400);
          }
          // Only clear the active label if no other tools are running.
          setActiveTools(curr => {
            if (curr.length === 0) setActiveTool(null);
            else setActiveTool(curr[curr.length - 1].name);
            return curr;
          });
        }

        if (msg.type === 'session_ended') {
          cleanup();
        }

        if (msg.type === 'error') {
          setError(msg.message || 'Voice session error');
          cleanup();
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      setError('WebSocket connection error');
      cleanup();
    };

    ws.onclose = () => {
      if (stateRef.current !== 'idle') {
        cleanup();
      }
    };
  }, [options.wsUrl, options.provider, options.agentId, options.systemPrompt, options.initialMessage, startMic, cleanup]);

  // ─── Stop voice session ────────────────────────────────────────────────

  const stop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'close' })); } catch {}
    }
    cleanup();
  }, [cleanup]);

  // ─── Toggle mute ──────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setMuted(m => !m);
  }, []);

  // ─── Interrupt ─────────────────────────────────────────────────────────

  const interrupt = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    playerRef.current?.flush();
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopMic();
      stopLevelMeter();
      if (wsRef.current) try { wsRef.current.close(); } catch {}
      if (audioCtxRef.current) try { audioCtxRef.current.close(); } catch {}
    };
  }, [stopMic, stopLevelMeter]);

  return {
    state,
    muted,
    audioLevel,
    transcripts,
    activeTool,
    activeTools,
    lastTool,
    start,
    stop,
    toggleMute,
    interrupt,
    error,
  };
}
