import React, { useRef, useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import TextareaAutosize from 'react-textarea-autosize';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Image, File, X, Plus, Mic, Square, Upload, Phone, PhoneOff, CornerDownRight } from 'lucide-react';
import QueuePanel from '../QueuePanel';
import { CheckpointManager } from '../CheckpointManager';
import { ModelSelector } from '../ModelSelector';
import { FileNavRef } from '../FileNavigator';
import { FolderPermissionsPopover } from './FolderPermissionsPopover';
import type { ReasoningLevel } from '../../hooks/usePreferences';
import type { ContextUsageMetrics } from '../../utils/contextUsage';
import { ContextUsageIndicator } from '../ContextUsageIndicator';
import { supabase } from '../../lib/supabaseClient';

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
  onStop?: () => void;
  isStreaming?: boolean;
  isRecording?: boolean;
  onMicClick?: () => void;
  attachments?: Array<{ type: 'image' | 'file'; name: string }>;
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
  displayModelName: string;
  contextMetrics?: ContextUsageMetrics | null;
  translucentMode?: boolean;
  showFileNav: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  selectedModelId: string;
  onChatModeChange?: (mode: any) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
  fileNavRef?: React.RefObject<FileNavRef>;
  /** Current tab ID — passed to FolderPermissionsPopover for session scoping. */
  activeTabId?: string;
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  query,
  setQuery,
  onSend,
  onSteer,
  onStop,
  isStreaming = false,
  isRecording,
  onMicClick,
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
  displayModelName,
  contextMetrics,
  translucentMode = false,
  showFileNav,
  textareaRef,
  selectedModelId,
  onChatModeChange,
  reasoningLevel,
  onReasoningLevelChange,
  fileNavRef,
  activeTabId,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

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

  return (
    <div
      className={clsx(
        "rounded-[28px] p-1 flex flex-col gap-1 shrink-0 relative transition-all duration-300",
        translucentMode
          ? "bg-theme-bg backdrop-blur-xl"
          : "bg-theme-card",
        isDragOver && "ring-2 ring-primary/50 ring-offset-1"
      )}
      onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { } }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDropWrapped}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 rounded-[28px] bg-primary/10 border-2 border-dashed border-primary/40 flex items-center justify-center pointer-events-none animate-in fade-in duration-150">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <Upload className="w-5 h-5" />
            <span>Drop files, images, or PDFs here</span>
          </div>
        </div>
      )}
      {(queueDepth > 0 || queuedMessages.length > 0) && (
        <QueuePanel messages={queuedMessages as any} queueDepth={queueDepth} onCancelMessage={onCancelQueuedMessage} />
      )}

      {attachments.length > 0 && (
        <div className="px-2 pt-2 pb-1 flex flex-wrap gap-2">
          {attachments.map((att, idx) => (
            <div
              key={`att-${idx}`}
              className="group flex items-center gap-1.5 px-2.5 py-1.5 bg-theme-active/50 hover:bg-theme-active rounded-xl text-[12px] text-theme-fg border border-theme/10"
            >
              {att.type === 'image' ? (
                <Image className="w-3.5 h-3.5 text-primary" />
              ) : (
                <File className="w-3.5 h-3.5 text-emerald-500" />
              )}
              <span className="max-w-[160px] truncate font-semibold">{att.name}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(idx)}
                  className="ml-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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

      {/* Status Row */}
      <div className="flex items-center justify-between px-3 py-1">
        <div className="flex items-center gap-2">
          <div className={clsx(
            "w-2.5 h-2.5 rounded-full",
            connectionStatus === 'connected' ? 'bg-emerald-500' :
              connectionStatus === 'connecting' ? 'bg-amber-500' :
                connectionStatus === 'error' ? 'bg-red-500' :
                  'bg-theme-muted/50'
          )} />
          {connectionStatus === 'connecting' ? (
            <div className="w-3.5 h-3.5 border-2 border-theme-muted/70 border-t-transparent rounded-full animate-spin" />
          ) : null}
          <span className={clsx(
            "text-[11px] font-bold uppercase tracking-widest",
            connectionStatus === 'connected' ? 'text-theme-muted' :
              connectionStatus === 'connecting' ? 'text-amber-700 dark:text-amber-500' :
                connectionStatus === 'error' ? 'text-red-600' :
                  'text-theme-muted'
          )}>
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ContextUsageIndicator metrics={contextMetrics} compact />
          <CheckpointManager />
          <span className="text-[11px] font-bold uppercase tracking-widest text-theme-muted truncate max-w-[240px]">{displayModelName}</span>
        </div>
      </div>

      {/* Input Row */}
      <div className="flex items-center gap-2 bg-theme-hover/50 rounded-[24px] p-1.5 pr-2 focus-within:ring-2 focus-within:ring-primary/10 transition-all relative z-50">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-theme-card transition-colors text-theme-muted hover:text-theme-fg"
              title="Attach"
            >
              <Plus className="w-5 h-5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="DropdownContent z-[10005] min-w-[180px] bg-theme-card rounded-xl border border-theme p-1 shadow-xl" sideOffset={8} align="start" collisionPadding={10}>
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

        <div className={clsx(
          "flex-1 relative rounded-xl transition-all flex items-center",
          showFileNav && "ring-2 ring-primary/40 bg-primary/5"
        )}>
          <TextareaAutosize
            ref={textareaRef}
            data-onboarding="chat-input"
            className={clsx(
              "w-full bg-transparent outline-none text-[15px] text-theme-fg placeholder:text-theme-muted font-semibold min-w-0 resize-none leading-5 py-0 overflow-y-auto custom-scrollbar px-2",
              showFileNav && "text-primary placeholder:text-primary/40"
            )}
            placeholder={showFileNav ? "Type to filter context..." : "Just ask Stuard"}
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
                  // Optional: Close on Escape handled by parent usually, but we can prevent default
                  // The parent (ChatView) handles onClose via other means or we might need a prop to close it explicitly here if desired.
                  // For now let's just let it bubble or preventDefault if we had an onClose prop.
                }
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            minRows={1}
            maxRows={3}
            autoFocus
          />
        </div>

        <ModelSelector
          selectedModelId={selectedModelId}
          onSelectModel={(id) => {
            try { onChatModeChange?.(id as any); } catch { }
          }}
          reasoningLevel={reasoningLevel}
          onReasoningLevelChange={onReasoningLevelChange}
          side="top"
          align="end"
        />

        <FolderPermissionsPopover sessionId={activeTabId} />

        {isStreaming ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={onSteer}
              disabled={!query.trim()}
              className="h-10 px-3 rounded-[18px] flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 bg-primary text-primary-fg hover:opacity-90 disabled:opacity-40 disabled:hover:scale-100"
              title="Send as steering note for the next step"
            >
              <CornerDownRight className="w-4 h-4" />
              <span className="text-[12px] font-black uppercase tracking-wider">Steer</span>
            </button>
            <button
              onClick={onStop}
              className="h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 bg-red-500 text-white hover:bg-red-600"
              title="Stop generation"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          </div>
        ) : (
          <button
            onClick={onMicClick}
            className={clsx(
              "h-10 w-10 rounded-[18px] flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0",
              isRecording ? "bg-red-500 text-white animate-pulse" : "bg-primary text-primary-fg hover:opacity-90"
            )}
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
