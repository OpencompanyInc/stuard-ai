import React, { useRef, useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'framer-motion';
import { Image, File, X, Plus, Mic, MicOff, Square, Upload, Phone, PhoneOff, ArrowUp, CornerDownRight, Folder, Bot, Workflow, AtSign, Loader2, ListPlus } from 'lucide-react';
import QueuePanel from '../../../../QueuePanel';
import { ModelSelector } from '../../../../ModelSelector';
import { ContextItem, FileNavRef } from '../../../../FileNavigator';
import type { ModelSourcePreference, ReasoningLevel } from '../../../../../hooks/usePreferences';
import type { ContextUsageMetrics } from '../../../../../utils/contextUsage';
import { ContextUsageIndicator } from '../../../../ContextUsageIndicator';
import { supabase } from '../../../../../lib/supabaseClient';
import { VoiceOrb, type VoiceState } from '../../../../voice/VoiceOrb';
import { describeTool, friendlyVoiceState } from '../../../../voice/voiceLabels';
import type { TranscriptLine, VoiceModeState, VoiceToolEvent } from '../../../../../hooks/useVoiceMode';
import { CreditsLimitNotice } from '../../../shared/CreditsLimitNotice';
import { ToolRunningIndicator } from '../../../shared/input/ToolRunningIndicator';
import { AttachmentPreviewOverlay, attachmentOverlayInset } from '../../../../AttachmentPreview';
import type { ChatAttachment } from '../../../../../utils/attachments';
import { hasInFlightToolCalls, type ToolCallLike } from '../../../../../utils/toolBrand';

// Brand / agent tint helpers — opacity modifiers on the manual --primary class
// are dead no-ops, so mix the channel explicitly.
const brandSoft = (pct: number) => `color-mix(in srgb, var(--primary) ${pct}%, transparent)`;
const agentSoft = (pct: number) => `color-mix(in srgb, var(--agent-accent) ${pct}%, transparent)`;

// ── Realtime Voice Conversation Test Helpers ──

const VOICE_WS_URL = (() => {
  const httpUrl = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || '';
  if (httpUrl) {
    return httpUrl.replace(/^https?:\/\//, (m: string) => m.startsWith('https') ? 'wss://' : 'ws://') + '/voice';
  }
  return 'ws://127.0.0.1:8082/voice';
})();

type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'error';

interface VoiceProvider { id: string; name: string }

interface TranscriptEntry { role: 'user' | 'assistant'; text: string; isFinal: boolean }

/** Resample Float32 from sourceSR to targetSR */
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

/** Convert Float32 [-1,1] to Int16 PCM buffer */
function float32ToInt16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/**
 * Queued PCM16 24kHz audio player.
 * Schedules chunks sequentially so they don't overlap.
 */
class AudioChunkPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private gainNode: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.connect(ctx.destination);
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
    // Schedule after the last chunk, or now if we've fallen behind
    const startAt = Math.max(now, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
  }

  /** Flush queued audio (on interruption) */
  flush() {
    this.nextTime = 0;
  }
}

// ── Component ──

interface ChatInputAreaProps {
  query: string;
  setQuery: (q: string) => void;
  onSend: () => void;
  onSteer?: () => void;
  // Steer target dropdown — list of running delegated subagents in the
  // current tab plus the selected target. 'orchestrator' is the implicit
  // default. Send always queues; the steer button nudges the selected target.
  activeSubagents?: Array<{ id: string; kind: string }>;
  steerTarget?: string;
  onSteerTargetChange?: (target: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  attachments?: ChatAttachment[];
  onRemoveAttachment?: (index: number) => void;
  onAttachFiles?: () => void;
  onAttachImages?: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  queueDepth?: number;
  queuedMessages?: any[];
  onCancelQueuedMessage?: (id: string) => void;
  statusText?: string;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  contextMetrics?: ContextUsageMetrics | null;
  translucentMode?: boolean;
  showFileNav: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  selectedModelId: string;
  onChatModeChange?: (mode: any) => void;
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
  fileNavRef?: React.RefObject<FileNavRef>;
  activeTabId?: string;
  /** Attached context items (files, folders, spaces, bots) — rendered as pills above the textarea. */
  contextPaths?: ContextItem[];
  onRemoveContext?: (index: number) => void;
  /** Open the @ file navigator (used by the "+" attach menu). */
  onOpenFileNav?: () => void;
  /** Close the @ file navigator and strip leftover @&lt;filter&gt; from the textarea. */
  onCloseFileNav?: () => void;
  // Voice mode
  voiceActive?: boolean;
  onToggleVoice?: () => void;
  voiceState?: VoiceModeState;
  voiceAudioLevel?: number;
  voiceMuted?: boolean;
  onVoiceMuteToggle?: () => void;
  voiceTranscripts?: TranscriptLine[];
  voiceActiveTools?: VoiceToolEvent[];
  showCreditsLimitNotice?: boolean;
  onDismissCreditsLimitNotice?: () => void;
  onAddCredits?: () => void;
  /** Match window/sidebar launcher shell — input card on gray surface */
  launcherSkin?: boolean;
  currentToolCalls?: readonly ToolCallLike[];
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  query,
  setQuery,
  onSend,
  onSteer,
  activeSubagents = [],
  steerTarget = 'orchestrator',
  onSteerTargetChange,
  onStop,
  isStreaming = false,
  attachments = [],
  onRemoveAttachment,
  onAttachFiles,
  onAttachImages,
  onPaste,
  onDrop,
  queueDepth = 0,
  queuedMessages = [],
  onCancelQueuedMessage,
  statusText = 'Online',
  connectionStatus = 'connected',
  contextMetrics,
  translucentMode = false,
  showFileNav,
  textareaRef,
  selectedModelId,
  onChatModeChange,
  modelSource = 'stuard',
  onModelSourceChange,
  reasoningLevel,
  onReasoningLevelChange,
  fileNavRef,
  activeTabId,
  contextPaths = [],
  onRemoveContext,
  onOpenFileNav,
  onCloseFileNav,
  voiceActive = false,
  onToggleVoice,
  voiceState = 'idle',
  voiceAudioLevel = 0,
  voiceMuted = false,
  onVoiceMuteToggle,
  voiceTranscripts = [],
  voiceActiveTools = [],
  showCreditsLimitNotice = false,
  onDismissCreditsLimitNotice,
  onAddCredits,
  launcherSkin = false,
  currentToolCalls = [],
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const attachmentInset = attachmentOverlayInset(attachments.length);

  const canSteer = Boolean(isStreaming && onSteer);
  const targetingSubagent = steerTarget !== 'orchestrator'
    && activeSubagents.some((s) => s.id === steerTarget);

  // Resolve the human-readable label for the current steer target. Falls back
  // to the bare id (or 'Subagent') when the running list hasn't reported a
  // kind yet — better than rendering an empty chip.
  const humanizeSubagentKind = (kind: string) =>
    String(kind || 'subagent')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const steerTargetLabel = (() => {
    if (steerTarget === 'orchestrator') return 'Orchestrator';
    const match = activeSubagents.find((s) => s.id === steerTarget);
    if (match) return `${humanizeSubagentKind(match.kind)} agent`;
    return 'Subagent';
  })();
  // Target selector visible while streaming so the user can pick a subagent
  // before clicking steer. Hidden when no delegated subagents are running.
  const showSteerTargetSelector = canSteer && activeSubagents.length > 0;

  // ── Realtime Voice Conversation Test State ──
  const [rtOpen, setRtOpen] = useState(false);
  const [rtLogs, setRtLogs] = useState<string[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [providers, setProviders] = useState<VoiceProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<AudioChunkPlayer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

  const rtLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setRtLogs((prev) => [...prev.slice(-99), `[${ts}] ${msg}`]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [rtLogs]);

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

  const disconnect = useCallback(() => {
    stopMic();
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    playerRef.current = null;
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    setVoiceStatus('idle');
    rtLog('Disconnected.');
  }, [stopMic, rtLog]);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setVoiceStatus('connecting');
    setTranscripts([]);
    rtLog(`Connecting to ${VOICE_WS_URL}...`);

    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) {
      rtLog('ERROR: No auth token. Sign in first.');
      setVoiceStatus('error');
      return;
    }

    const ws = new WebSocket(VOICE_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      rtLog('WebSocket connected, authenticating...');
      ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
    };

    ws.onmessage = (ev) => {
      // Binary = audio from provider — queue for sequential playback
      if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((buf) => {
          if (playerRef.current) {
            playerRef.current.play(buf);
          }
        });
        return;
      }

      try {
        const msg = JSON.parse(ev.data);

        if (msg.type === 'providers') {
          setProviders(msg.providers || []);
          if (!selectedProvider && msg.default) setSelectedProvider(msg.default);
          rtLog(`Providers: ${(msg.providers || []).map((p: any) => p.name).join(', ')}`);
        }

        if (msg.type === 'authenticated') {
          rtLog('Authenticated. Sending config...');
          ws.send(JSON.stringify({
            type: 'config',
            provider: selectedProvider || undefined,
          }));
        }

        if (msg.type === 'ready') {
          rtLog(`Session ready! Provider: ${msg.provider}, ID: ${msg.sessionId}`);
          setVoiceStatus('ready');
          // Auto-start mic
          startMic();
        }

        if (msg.type === 'transcript') {
          const entry: TranscriptEntry = { role: msg.role, text: msg.text, isFinal: msg.isFinal };
          setTranscripts(prev => {
            // Replace last non-final from same role, or append
            if (!msg.isFinal && prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.role === msg.role && !last.isFinal) {
                return [...prev.slice(0, -1), entry];
              }
            }
            return [...prev, entry];
          });
          if (msg.isFinal) {
            rtLog(`[${msg.role}] ${msg.text}`);
          }
        }

        if (msg.type === 'interruption') {
          rtLog('Interruption detected (you started speaking)');
          playerRef.current?.flush();
        }

        if (msg.type === 'session_ended') {
          rtLog(`Session ended: ${msg.reason}`);
          disconnect();
        }

        if (msg.type === 'error') {
          rtLog(`ERROR: ${msg.message}`);
          setVoiceStatus('error');
        }
      } catch {}
    };

    ws.onerror = () => {
      rtLog('WebSocket error');
      setVoiceStatus('error');
    };

    ws.onclose = () => {
      rtLog('WebSocket closed');
      wsRef.current = null;
      stopMic();
      setVoiceStatus('idle');
    };
  }, [selectedProvider, rtLog, disconnect, stopMic]);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 48000 });
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      audioCtxRef.current = audioCtx;
      playerRef.current = new AudioChunkPlayer(audioCtx);

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Use ScriptProcessorNode to capture audio chunks
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        // Resample from 48kHz to 24kHz for OpenAI Realtime
        const resampled = resample(input, audioCtx.sampleRate, 24000);
        const pcm16 = float32ToInt16(resampled);
        wsRef.current.send(pcm16);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setVoiceStatus('listening');
      rtLog('Mic active - speak now!');
    } catch (err: any) {
      rtLog(`Mic error: ${err?.message || 'unknown'}`);
      setVoiceStatus('error');
    }
  }, [rtLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) try { wsRef.current.close(); } catch {}
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (processorRef.current) processorRef.current.disconnect();
      if (audioCtxRef.current) try { audioCtxRef.current.close(); } catch {}
    };
  }, []);

  // ── Drag/Drop handlers ──
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragOver(false); }
  }, []);
  const handleDropWrapped = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    dragCounter.current = 0;
    setIsDragOver(false);
    onDrop?.(e);
  }, [onDrop]);

  const statusLabelText = statusText?.trim() || '';
  const showStatusLabel =
    hasInFlightToolCalls(currentToolCalls)
    || connectionStatus !== 'connected'
    || statusLabelText.length > 0;

  return (
    <div className="flex flex-col shrink-0 gap-2">
      <div className="input-status-float">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {hasInFlightToolCalls(currentToolCalls) ? (
            <ToolRunningIndicator toolCalls={currentToolCalls} className="min-w-0" />
          ) : showStatusLabel ? (
            <>
              {connectionStatus !== 'connected' && (
                <div className={clsx(
                  "w-2.5 h-2.5 rounded-full shrink-0",
                  connectionStatus === 'connecting' ? 'bg-amber-500' :
                    connectionStatus === 'error' ? 'bg-red-500' :
                      'bg-theme-muted/50'
                )} />
              )}
              {connectionStatus === 'connecting' ? (
                <div className="w-3.5 h-3.5 border-2 border-theme-muted/70 border-t-transparent rounded-full animate-spin shrink-0" />
              ) : null}
              {statusLabelText ? (
                <span className={clsx(
                  "truncate text-[11px] font-bold uppercase tracking-widest",
                  connectionStatus === 'connected' ? 'text-theme-muted' :
                    connectionStatus === 'connecting' ? 'text-amber-700 dark:text-amber-500' :
                      connectionStatus === 'error' ? 'text-red-600' :
                        'text-theme-muted'
                )}>
                  {statusLabelText}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ContextUsageIndicator metrics={contextMetrics} compact />
        </div>
      </div>

      <div
      className={clsx(
        "flex flex-col shrink-0 relative transition-all duration-300",
        launcherSkin
          ? clsx(
              "launcher-input-surface rounded-[16px] p-2.5 gap-1.5 border border-theme/20",
              translucentMode
                ? "bg-theme-bg/80 backdrop-blur-xl"
                : "bg-theme-input",
              isDragOver && "ring-2 ring-offset-1 ring-offset-transparent",
            )
          : clsx(
              "rounded-[28px] p-1 gap-1",
              translucentMode
                ? "bg-theme-bg backdrop-blur-xl"
                : "bg-theme-card",
              isDragOver && "ring-2 ring-offset-1",
            ),
      )}
      style={isDragOver ? { ['--tw-ring-color' as any]: brandSoft(50) } : undefined}
      onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDropWrapped}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div
          className={clsx(
            "absolute inset-0 z-50 border-2 border-dashed flex items-center justify-center pointer-events-none animate-in fade-in duration-150",
            launcherSkin ? "rounded-[16px]" : "rounded-[28px]",
          )}
          style={{ background: brandSoft(10), borderColor: brandSoft(45) }}
        >
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <Upload className="w-5 h-5" />
            <span>Drop files, images, or PDFs here</span>
          </div>
        </div>
      )}
      <CreditsLimitNotice
        open={showCreditsLimitNotice}
        onDismiss={onDismissCreditsLimitNotice || (() => {})}
        onAddCredits={onAddCredits || (() => {})}
      />

      <AnimatePresence initial={false}>
        {(queueDepth > 0 || queuedMessages.length > 0) && (
          <QueuePanel
            key="queue-panel"
            messages={queuedMessages as any}
            queueDepth={queueDepth}
            onCancelMessage={onCancelQueuedMessage}
          />
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {contextPaths.length > 0 && (
          <motion.div
            key="context-pills"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-2 pt-2 pb-1 flex flex-wrap gap-1.5">
              {contextPaths.map((ctx, idx) => {
                const Icon =
                  ctx.type === 'bot' ? Bot
                  : ctx.isDirectory ? Folder
                  : File;
                return (
                  <motion.div
                    key={`ctx-${idx}-${ctx.path}`}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.14 }}
                    className="group flex items-center gap-1.5 pl-2 pr-1 py-1 bg-theme-hover hover:bg-theme-active rounded-lg text-[12px] text-theme-fg border border-theme/10 max-w-[260px]"
                    title={ctx.path}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0 text-theme-muted" strokeWidth={2} />
                    <span className="truncate font-semibold leading-none">{ctx.name}</span>
                    {onRemoveContext && (
                      <button
                        type="button"
                        onClick={() => onRemoveContext(idx)}
                        className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-card rounded-md p-0.5 transition-colors opacity-60 group-hover:opacity-100"
                        title={`Remove ${ctx.name}`}
                      >
                        <X className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Realtime Voice Conversation Test Panel */}
      {rtOpen && (
        <div className="mx-2 mt-1 p-3 rounded-2xl bg-theme-hover/70 border border-theme/10 text-[12px] space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="font-bold text-theme-fg uppercase tracking-wider text-[11px]">Realtime Voice Test</span>
            <div className="flex items-center gap-1.5">
              <div className={clsx(
                "w-2 h-2 rounded-full",
                voiceStatus === 'listening' ? 'bg-emerald-500 animate-pulse' :
                voiceStatus === 'ready' ? 'bg-emerald-500' :
                voiceStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                voiceStatus === 'error' ? 'bg-red-500' : 'bg-theme-muted/40'
              )} />
              <span className="text-theme-muted font-semibold text-[10px]">{voiceStatus}</span>
            </div>
          </div>

          {/* Provider selector + controls */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              disabled={voiceStatus !== 'idle' && voiceStatus !== 'error'}
              className="flex-1 bg-black/20 text-theme-fg text-[11px] font-semibold rounded-lg px-2 py-1.5 border border-theme/10 outline-none disabled:opacity-40"
            >
              {providers.length === 0 && <option value="">Connect to see providers...</option>}
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {voiceStatus === 'idle' || voiceStatus === 'error' ? (
              <button onClick={connect} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1">
                <Phone className="w-3 h-3" />
                Call
              </button>
            ) : (
              <button onClick={disconnect} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[11px] font-bold hover:bg-red-600 transition-colors flex items-center gap-1">
                <PhoneOff className="w-3 h-3" />
                End
              </button>
            )}
            <button onClick={() => { setRtLogs([]); setTranscripts([]); }} className="px-2 py-1.5 rounded-lg bg-theme-active text-theme-fg text-[11px] font-bold hover:bg-theme-hover transition-colors">
              Clear
            </button>
          </div>

          {/* Live transcript */}
          {transcripts.length > 0 && (
            <div className="max-h-[100px] overflow-y-auto bg-black/10 rounded-lg p-2 space-y-1 custom-scrollbar">
              {transcripts.filter(t => t.text.trim()).map((t, i) => (
                <div key={i} className={clsx(
                  "text-[11px] font-semibold",
                  t.role === 'user' ? 'text-blue-400' : 'text-emerald-400',
                  !t.isFinal && 'opacity-50'
                )}>
                  <span className="uppercase text-[9px] font-bold opacity-60 mr-1">{t.role}:</span>
                  {t.text}
                </div>
              ))}
            </div>
          )}

          {/* Log output */}
          <div
            ref={logPanelRef}
            className="max-h-[80px] overflow-y-auto bg-black/20 rounded-lg p-2 font-mono text-[10px] text-theme-muted leading-4 custom-scrollbar"
          >
            {rtLogs.length === 0 ? (
              <span className="opacity-50">Hit Call to start a realtime voice conversation.</span>
            ) : (
              rtLogs.map((log, i) => <div key={i}>{log}</div>)
            )}
          </div>
        </div>
      )}

      {/* Input Row — voice strip or text input */}
      {voiceActive ? (
        <motion.div layout className="flex flex-col gap-1.5 relative">
          <motion.div
            layout
            className={clsx(
              "flex items-center gap-2 backdrop-blur-xl border border-theme/10",
              launcherSkin
                ? "bg-theme-hover/55 rounded-[14px] p-1.5 pr-2"
                : "bg-theme-hover/55 rounded-[24px] p-1.5 pr-2",
            )}
          >
            <motion.div
              layout
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: 40, height: 40 }}
            >
              <VoiceOrb
                state={(voiceState === 'connecting' ? 'thinking' : voiceState) as VoiceState}
                audioLevel={voiceAudioLevel}
                size={40}
              />
            </motion.div>
            <div className="flex-1 min-w-0 px-1 flex flex-col justify-center">
              <AnimatePresence mode="wait">
                {voiceTranscripts[voiceTranscripts.length - 1]?.text ? (
                  <motion.p
                    key={`t-${voiceTranscripts[voiceTranscripts.length - 1].id}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18 }}
                    className={clsx(
                      'text-[13px] leading-snug truncate',
                      voiceTranscripts[voiceTranscripts.length - 1].role === 'user'
                        ? 'text-theme-fg font-medium'
                        : 'text-theme-fg/70 italic',
                      !voiceTranscripts[voiceTranscripts.length - 1].isFinal && 'opacity-70',
                    )}
                  >
                    {voiceTranscripts[voiceTranscripts.length - 1].text}
                  </motion.p>
                ) : (
                  <motion.div
                    key={`s-${voiceState}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.22 }}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    {voiceActiveTools.length > 0 && (
                      <Loader2 size={11} className="animate-spin text-theme-muted flex-shrink-0" />
                    )}
                    <span className="text-[13px] text-theme-fg/85 font-medium tracking-wide truncate">
                      {friendlyVoiceState(voiceState as any)}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={onVoiceMuteToggle}
              title={voiceMuted ? 'Unmute' : 'Mute'}
              className={clsx(
                'h-9 w-9 rounded-[16px] flex items-center justify-center transition-all flex-shrink-0',
                voiceMuted
                  ? 'bg-red-500/15 text-red-500'
                  : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60',
              )}
            >
              {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onToggleVoice}
              title="Exit voice mode"
              className="h-9 w-9 rounded-[16px] flex items-center justify-center text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-all flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>

          <AnimatePresence>
            {voiceActiveTools.length > 0 && (
              <motion.div
                key="cv-tool-rail"
                initial={{ opacity: 0, y: -4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -4, height: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 px-1">
                  {voiceActiveTools.map((t) => (
                    <motion.div
                      key={t.callId}
                      layout
                      initial={{ opacity: 0, scale: 0.9, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-theme/15 bg-theme-hover/60 backdrop-blur-md px-2.5 py-1 shadow-sm"
                    >
                      {t.name === 'delegate' ? (
                        <Workflow size={10} style={{ color: 'var(--agent-accent)' }} />
                      ) : (
                        <Loader2 size={10} className="animate-spin text-theme-muted" />
                      )}
                      <span className="text-[11px] text-theme-fg/85 font-medium tracking-wide">{t.label}</span>
                      {t.detail && (
                        <span className="text-[10.5px] text-theme-muted truncate max-w-[160px]">{t.detail}</span>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className={clsx(
          "flex flex-col transition-all relative z-[1]",
          launcherSkin
            ? "gap-1.5 px-0.5"
            : "gap-1 bg-theme-hover/50 rounded-[24px] p-1.5 focus-within:ring-2",
        )}
        style={launcherSkin ? undefined : { ['--tw-ring-color' as any]: brandSoft(12) }}
        >
          <div
            className="min-w-0 w-full px-1 relative"
            style={attachmentInset > 0 ? { paddingLeft: attachmentInset } : undefined}
          >
            {attachments.length > 0 && (
              <AttachmentPreviewOverlay
                attachments={attachments}
                onRemove={onRemoveAttachment}
              />
            )}
            <TextareaAutosize
              ref={textareaRef}
              data-onboarding="chat-input"
              className={clsx(
                "w-full bg-transparent outline-none text-theme-fg placeholder:text-theme-muted min-w-0 resize-none leading-5 py-1 overflow-y-auto custom-scrollbar px-1",
                launcherSkin
                  ? "text-[14px] font-normal placeholder:text-theme-muted/80"
                  : "text-[15px] font-semibold",
              )}
              placeholder={
                isStreaming
                  ? 'Queue after this turn…'
                  : 'Just ask Stuard'
              }
              value={query}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if ((e.nativeEvent as any)?.isComposing) return;

                if (showFileNav && fileNavRef?.current) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    fileNavRef.current.moveSelection(1);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    fileNavRef.current.moveSelection(-1);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    fileNavRef.current.selectCurrent();
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCloseFileNav?.();
                    return;
                  }
                  if (e.key === ' ') {
                    const added = fileNavRef.current.addCurrent();
                    if (added) e.preventDefault();
                    return;
                  }
                }

                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSteer && (e.metaKey || e.ctrlKey) && query.trim()) {
                    onSteer?.();
                  } else {
                    onSend();
                  }
                }
              }}
              minRows={1}
              maxRows={3}
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2 w-full min-w-0">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={clsx(
                  "flex items-center justify-center transition-colors shrink-0",
                  launcherSkin
                    ? "w-9 h-9 rounded-[12px] hover:bg-pill-fg/10 text-pill-fg/80 hover:text-pill-fg"
                    : "w-10 h-10 rounded-full hover:bg-theme-card text-theme-muted hover:text-theme-fg",
                )}
                title="Attach"
              >
                <Plus className="w-5 h-5" strokeWidth={launcherSkin ? 1.75 : 2} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className={clsx(
                  "DropdownContent z-[10005] min-w-[200px] rounded-xl border p-1 shadow-xl",
                  launcherSkin
                    ? "bg-pill-bg border-pill-fg/10 shadow-[var(--compact-pill-shadow)]"
                    : "bg-theme-card border-theme",
                )}
                sideOffset={8}
                align="start"
                collisionPadding={10}
              >
                {onOpenFileNav && (
                  <DropdownMenu.Item
                    onSelect={() => onOpenFileNav()}
                    className="group text-[13px] text-theme-fg font-semibold flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors hover:bg-theme-hover cursor-pointer"
                  >
                    <AtSign className="w-4 h-4 text-primary group-hover:opacity-100 opacity-70" strokeWidth={2.2} />
                    <span className="flex-1">Add context</span>
                    <span className="text-[10px] font-mono text-theme-muted bg-theme-hover px-1.5 py-0.5 rounded">@</span>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  onSelect={() => onAttachFiles?.()}
                  className={clsx(
                    "group text-[13px] text-theme-fg font-semibold flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                    onAttachFiles ? "hover:bg-theme-hover cursor-pointer" : "opacity-40 cursor-not-allowed"
                  )}
                >
                  <File className="w-4 h-4 text-primary group-hover:opacity-100 opacity-70" />
                  <span>Attach files</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onAttachImages?.()}
                  className={clsx(
                    "group text-[13px] text-theme-fg font-bold flex items-center gap-2 px-3 py-2.5 rounded-lg outline-none transition-colors",
                    onAttachImages ? "hover:bg-theme-hover cursor-pointer" : "opacity-40 cursor-not-allowed"
                  )}
                >
                  <Image className="w-4 h-4 text-primary group-hover:opacity-100 opacity-70" />
                  <span>Attach images</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className="ml-auto flex items-center gap-2 shrink-0">
          <ModelSelector
            selectedModelId={selectedModelId}
            onSelectModel={(id) => {
              try { onChatModeChange?.(id as any); } catch { }
            }}
            modelSource={modelSource}
            onModelSourceChange={onModelSourceChange}
            reasoningLevel={reasoningLevel}
            onReasoningLevelChange={onReasoningLevelChange}
            side="top"
            align="end"
          />

          {showSteerTargetSelector && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={clsx(
                    "h-9 px-2 rounded-[14px] text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-1 border shrink-0",
                    !targetingSubagent && "bg-theme-hover/60 border-theme/10 text-theme-muted hover:text-theme-fg",
                  )}
                  style={targetingSubagent ? {
                    background: agentSoft(12),
                    borderColor: agentSoft(28),
                    color: 'var(--agent-accent)',
                  } : undefined}
                  title="Pick which agent to steer"
                >
                  {targetingSubagent ? (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                  ) : (
                    <Workflow className="w-3 h-3" strokeWidth={2.5} />
                  )}
                  <span className="normal-case tracking-normal text-[10.5px] font-bold truncate max-w-[100px]">
                    {steerTargetLabel}
                  </span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="DropdownContent z-[10005] min-w-[220px] bg-theme-card rounded-xl border border-theme p-1 shadow-xl"
                  sideOffset={6}
                  align="end"
                  collisionPadding={10}
                >
                  <div className="px-2 pt-1.5 pb-1 text-[9px] font-black uppercase tracking-widest text-theme-muted/70">
                    Steer target
                  </div>
                  <DropdownMenu.Item
                    onSelect={() => onSteerTargetChange?.('orchestrator')}
                    className={clsx(
                      "group text-[12px] flex items-center gap-2 px-2.5 py-2 rounded-lg outline-none transition-colors cursor-pointer",
                      steerTarget === 'orchestrator'
                        ? "text-primary"
                        : "text-theme-fg hover:bg-theme-hover"
                    )}
                    style={steerTarget === 'orchestrator' ? { background: brandSoft(10) } : undefined}
                  >
                    <CornerDownRight className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2.4} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">Orchestrator</div>
                      <div className="text-[10px] text-theme-muted truncate">Main conversation</div>
                    </div>
                    {steerTarget === 'orchestrator' && <span className="text-[9px] uppercase tracking-wider font-black text-primary">Active</span>}
                  </DropdownMenu.Item>
                  {activeSubagents.length > 0 && (
                    <>
                      <div className="px-2 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-theme-muted/70">
                        Running subagents
                      </div>
                      {activeSubagents.map((sa) => (
                        <DropdownMenu.Item
                          key={sa.id}
                          onSelect={() => onSteerTargetChange?.(sa.id)}
                          className={clsx(
                            "group text-[12px] flex items-center gap-2 px-2.5 py-2 rounded-lg outline-none transition-colors cursor-pointer",
                            steerTarget !== sa.id && "text-theme-fg hover:bg-theme-hover",
                          )}
                          style={steerTarget === sa.id ? { background: agentSoft(12), color: 'var(--agent-accent)' } : undefined}
                        >
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">{humanizeSubagentKind(sa.kind)} agent</div>
                            <div className="text-[10px] text-theme-muted truncate">Mid-task nudge</div>
                          </div>
                          {steerTarget === sa.id && <span className="text-[9px] uppercase tracking-wider font-black" style={{ color: 'var(--agent-accent)' }}>Active</span>}
                        </DropdownMenu.Item>
                      ))}
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}

          {isStreaming && !query.trim() ? (
            <button
              onClick={onStop}
              className="h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 bg-red-500 text-white hover:bg-red-600 flex-shrink-0"
              title="Stop generation"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : query.trim() ? (
            <>
              {/* While a turn is running, Enter / the filled button QUEUE the
                  message — the calm default. Steer is the deliberate opt-in: a
                  quiet up-arrow (⌘↵) that injects it into the live step now. */}
              {canSteer && (
                <button
                  type="button"
                  onClick={onSteer}
                  className="h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0 bg-theme-hover/60 hover:bg-theme-hover"
                  style={{ color: targetingSubagent ? 'var(--agent-accent)' : 'var(--primary)' }}
                  title={
                    targetingSubagent
                      ? `Steer ${steerTargetLabel} now — interrupt the current step (⌘↵)`
                      : "Steer now — interrupt the current step (⌘↵)"
                  }
                >
                  <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
                </button>
              )}
              <button
                onClick={onSend}
                className="h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 hover:opacity-90 flex-shrink-0 bg-primary text-primary-fg"
                title={canSteer ? "Queue — sends after this turn (↵)" : "Send message"}
              >
                {canSteer ? <ListPlus className="w-5 h-5" strokeWidth={2.2} /> : <ArrowUp className="w-5 h-5" strokeWidth={2.5} />}
              </button>
            </>
          ) : null}
          </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};
