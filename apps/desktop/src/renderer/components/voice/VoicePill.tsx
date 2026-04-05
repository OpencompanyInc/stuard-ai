import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X, Loader2 } from 'lucide-react';
import { VoiceOrb, type VoiceState } from './VoiceOrb';

interface VoicePillProps {
  state: VoiceState;
  audioLevel?: number;
  muted?: boolean;
  transcript?: string;
  transcriptRole?: 'user' | 'assistant';
  isFinal?: boolean;
  toolName?: string;
  onMuteToggle?: () => void;
  onClose?: () => void;
  className?: string;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching…',
  google_search: 'Searching…',
  list_calendar_events: 'Checking calendar…',
  send_email: 'Sending email…',
  read_email: 'Reading email…',
  create_calendar_event: 'Creating event…',
  execute_command: 'Running command…',
  memory_store: 'Remembering…',
  memory_search: 'Searching memory…',
};

function friendlyTool(name: string) {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + '…';
}

export function VoicePill({
  state,
  audioLevel = 0,
  muted = false,
  transcript,
  transcriptRole,
  isFinal = true,
  toolName,
  onMuteToggle,
  onClose,
  className,
}: VoicePillProps) {
  const isActive = state !== 'idle';

  const statusText =
    toolName ? friendlyTool(toolName) :
    state === 'thinking' ? 'Thinking…' :
    state === 'idle' ? 'Ready' :
    undefined;

  const showTranscript = transcript && transcript.length > 0;

  return (
    <motion.div
      layout
      className={clsx(
        'inline-flex items-center gap-0 rounded-full backdrop-blur-2xl transition-all duration-500',
        isActive
          ? 'bg-gray-100/90 border border-gray-300/60 shadow-md shadow-black/[0.06]'
          : 'bg-gray-100/80 border border-gray-200 shadow-sm',
        className,
      )}
      style={{ height: 48, paddingRight: 6, paddingLeft: 0 }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {/* Mini orb */}
      <div className="flex-shrink-0 relative" style={{ width: 48, height: 48 }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <VoiceOrb state={state} audioLevel={audioLevel} size={44} />
        </div>
      </div>

      {/* Content area */}
      <div className="flex items-center gap-2 min-w-0 pr-1" style={{ maxWidth: 320 }}>
        <AnimatePresence mode="wait">
          {showTranscript ? (
            <motion.p
              key={`t-${transcript}`}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.2 }}
              className={clsx(
                'text-[13px] leading-snug truncate',
                transcriptRole === 'user' ? 'text-gray-800' : 'text-gray-500 italic',
                !isFinal && 'text-gray-400',
              )}
            >
              {transcript}
              {!isFinal && (
                <span className="inline-block w-[1.5px] h-[0.85em] bg-gray-400 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
              )}
            </motion.p>
          ) : statusText ? (
            <motion.div
              key={`s-${statusText}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-1.5"
            >
              {toolName && <Loader2 size={10} className="animate-spin text-gray-400" />}
              <span className="text-[12px] text-gray-500 tracking-wide">{statusText}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
        {onMuteToggle && (
          <button
            onClick={onMuteToggle}
            className={clsx(
              'p-1.5 rounded-full transition-all duration-200',
              muted
                ? 'text-rose-500/70 hover:bg-rose-100/60'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200/50',
            )}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200/50 transition-colors duration-200"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
