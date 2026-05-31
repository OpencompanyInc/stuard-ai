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
  const showThinkingGlow = state === 'thinking';

  return (
    <motion.div
      layout
      className={clsx(
        'voice-mode-pill-wrap inline-flex',
        showThinkingGlow && 'compact-thinking-glow',
        className,
      )}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className={clsx(
          'voice-mode-pill inline-flex items-center gap-1 relative',
          showThinkingGlow && 'compact-thinking-glow__inner',
        )}
      >
        {/* Orb */}
        <div className="flex-shrink-0 relative" style={{ width: 44, height: 44 }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <VoiceOrb state={state} audioLevel={audioLevel} size={40} />
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
              {isToolActive && (
                <Loader2 size={11} className="animate-spin text-pill-muted flex-shrink-0" />
              )}
              <span className="voice-mode-pill__status">{statusText}</span>
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
                'voice-mode-pill__btn',
                muted && 'voice-mode-pill__btn--danger',
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
                'voice-mode-pill__btn',
                sharingScreen && 'voice-mode-pill__btn--active',
              )}
              title={sharingScreen ? 'Stop sharing screen' : 'Share screen'}
            >
              {sharingScreen ? <ScreenShareOff size={14} /> : <ScreenShare size={14} />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="voice-mode-pill__btn"
              title="Exit voice mode"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
