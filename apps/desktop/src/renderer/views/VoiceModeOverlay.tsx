import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { VoicePill } from '../components/voice/VoicePill';
import { VoiceTranscriptBox } from '../components/voice/VoiceTranscriptBox';
import type { VoiceModeState, TranscriptLine } from '../hooks/useVoiceMode';
import type { VoiceState } from '../components/voice/VoiceOrb';

function toOrbState(s: VoiceModeState): VoiceState {
  if (s === 'connecting') return 'thinking';
  return s as VoiceState;
}

export interface VoiceModeOverlayProps {
  state: VoiceModeState;
  audioLevel: number;
  muted: boolean;
  transcripts: TranscriptLine[];
  activeTool?: string | null;
  sharingScreen?: boolean;
  onMuteToggle: () => void;
  onShareScreen?: () => void;
  onClose: () => void;
  /** When false, the overlay is unmounted with an exit animation. */
  visible?: boolean;
}

/**
 * Presentational overlay for voice mode. Owns no voice session itself —
 * App.tsx mounts this on top of the existing UI when `voiceActive` is true
 * and passes through the live voice hook state.
 */
export function VoiceModeOverlay({
  state,
  audioLevel,
  muted,
  transcripts,
  activeTool,
  sharingScreen,
  onMuteToggle,
  onShareScreen,
  onClose,
  visible = true,
}: VoiceModeOverlayProps) {
  const voiceState = toOrbState(state);
  const latestTranscript = transcripts[transcripts.length - 1];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="voice-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* Translucent transcript rectangle — sits just above the pill */}
          <motion.div
            className="fixed left-1/2 -translate-x-1/2 z-[9998] w-[92%] max-w-[640px] pointer-events-none"
            style={{ bottom: 96 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="pointer-events-auto">
              <VoiceTranscriptBox transcript={latestTranscript} />
            </div>
          </motion.div>

          {/* Compact pill at bottom center */}
          <motion.div
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999]"
            initial={{ opacity: 0, scale: 0.85, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 24, transition: { duration: 0.2 } }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <VoicePill
              state={voiceState}
              audioLevel={audioLevel}
              muted={muted}
              toolName={activeTool || undefined}
              sharingScreen={sharingScreen}
              onMuteToggle={onMuteToggle}
              onShareScreen={onShareScreen}
              onClose={onClose}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
