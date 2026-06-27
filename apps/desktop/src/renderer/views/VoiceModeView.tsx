import React, { useCallback, useEffect, useRef } from 'react';
import { VoiceModeOverlay } from './VoiceModeOverlay';
import { useVoiceMode, type VoiceModeOptions } from '../hooks/useVoiceMode';

interface VoiceModeViewProps {
  voiceOptions?: VoiceModeOptions;
  onClose?: () => void;
}

/**
 * Standalone voice mode page (used by the voice test window).
 * Owns its own voice session and renders the shared VoiceModeOverlay.
 */
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

  return (
    <VoiceModeOverlay
      state={voice.state}
      audioLevel={voice.audioLevel}
      muted={voice.muted}
      transcripts={voice.transcripts}
      activeTool={voice.activeTool}
      sharingScreen={voice.sharingScreen}
      onMuteToggle={voice.toggleMute}
      onShareScreen={voice.toggleScreenShare}
      onClose={handleClose}
    />
  );
}
