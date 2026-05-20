import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X, Loader2, ScreenShare, ScreenShareOff } from 'lucide-react';
import { VoiceOrb, type VoiceState } from './VoiceOrb';

interface VoicePillProps {
  state: VoiceState;
  audioLevel?: number;
  muted?: boolean;
  toolName?: string;
  sharingScreen?: boolean;
  onMuteToggle?: () => void;
  onShareScreen?: () => void;
  onClose?: () => void;
  className?: string;
}

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
};

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
  toolName,
  sharingScreen = false,
  onMuteToggle,
  onShareScreen,
  onClose,
  className,
}: VoicePillProps) {
  const statusText = toolName ? friendlyTool(toolName) : STATE_LABEL[state];
  const isToolActive = !!toolName;

  return (
    <motion.div
      layout
      className={clsx(
        'inline-flex items-center gap-1 backdrop-blur-2xl',
        className,
      )}
      style={{
        height: 58,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: 22,
        background:
          'linear-gradient(180deg, rgba(30,29,28,0.45) 0%, rgba(19,18,16,0.55) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          '0 18px 60px rgba(0, 0, 0, 0.40), 0 0 36px rgba(253, 5, 22, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.04) inset',
      }}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Orb */}
      <div className="flex-shrink-0 relative" style={{ width: 46, height: 46 }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <VoiceOrb state={state} audioLevel={audioLevel} size={44} />
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5 pl-1 pr-2 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={`s-${statusText}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.22 }}
            className="flex items-center gap-1.5"
          >
            {isToolActive && <Loader2 size={11} className="animate-spin text-white/55" />}
            <span className="text-[12.5px] text-white/85 font-medium tracking-wide whitespace-nowrap">
              {statusText}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {onMuteToggle && (
          <button
            type="button"
            onClick={onMuteToggle}
            className={clsx(
              'h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95',
              muted
                ? 'text-red-300 bg-red-500/20 hover:bg-red-500/30'
                : 'text-white/60 hover:text-white hover:bg-white/10',
            )}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
        {onShareScreen && (
          <button
            type="button"
            onClick={onShareScreen}
            className={clsx(
              'h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95',
              sharingScreen
                ? 'text-rose-300 bg-rose-500/20 hover:bg-rose-500/30'
                : 'text-white/60 hover:text-white hover:bg-white/10',
            )}
            title={sharingScreen ? 'Stop sharing screen' : 'Share screen'}
          >
            {/* Active = the red crossed-out icon, click to stop sharing.
                Inactive = the standard share affordance. */}
            {sharingScreen ? <ScreenShareOff size={14} /> : <ScreenShare size={14} />}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-xl flex items-center justify-center text-white/60 hover:text-rose-200 hover:bg-rose-500/15 transition-all duration-200 active:scale-95"
            title="Exit voice mode"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
