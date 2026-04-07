import React, { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { VoicePill } from '../components/voice/VoicePill';
import { useVoiceMode, type VoiceModeState, type VoiceModeOptions } from '../hooks/useVoiceMode';
import type { VoiceState } from '../components/voice/VoiceOrb';

function toOrbState(s: VoiceModeState): VoiceState {
  if (s === 'connecting') return 'thinking';
  return s as VoiceState;
}

interface VoiceModeViewProps {
  voiceOptions?: VoiceModeOptions;
  onClose?: () => void;
}

export function VoiceModeView({ voiceOptions, onClose }: VoiceModeViewProps) {
  const voice = useVoiceMode(voiceOptions || {});

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    voice.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    voice.stop();
    onClose?.();
  }, [voice, onClose]);

  const voiceState = toOrbState(voice.state);
  const activeTool = voice.activeTool || undefined;
  const latestTranscript = voice.transcripts[voice.transcripts.length - 1];

  return (
    <motion.div
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[9999]"
      initial={{ opacity: 0, scale: 0.8, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 30, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <VoicePill
        state={voiceState}
        audioLevel={voice.audioLevel}
        muted={voice.muted}
        transcript={latestTranscript?.text}
        transcriptRole={latestTranscript?.role}
        isFinal={latestTranscript?.isFinal}
        toolName={activeTool}
        onMuteToggle={voice.toggleMute}
        onClose={handleClose}
      />
    </motion.div>
  );
}
