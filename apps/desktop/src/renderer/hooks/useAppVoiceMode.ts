import { useCallback, useEffect, useRef, useState } from 'react';
import { startBrowserSignIn } from '../auth/browserSignIn';
import { useVoiceMode } from './useVoiceMode';

export function useAppVoiceMode({ signedIn, overlayVisible }: { signedIn: boolean; overlayVisible: boolean }) {
  const voice = useVoiceMode({});
  const [voiceActive, setVoiceActive] = useState(false);
  const lastVoiceErrorRef = useRef<string | null>(null);
  const holdActiveRef = useRef(false);
  const compactWasVisibleBeforeVoiceRef = useRef(false);
  const lastAudioLevelSendRef = useRef(0);

  const stopVoiceSession = useCallback(() => {
    try {
      voice.stop();
    } finally {
      setVoiceActive(false);
    }
  }, [voice]);

  useEffect(() => {
    const api: any = (window as any).desktopAPI;
    if (!api) return;
    if (voiceActive) {
      try { api.showVoiceBorder?.(); } catch { }
      try { compactWasVisibleBeforeVoiceRef.current = !!overlayVisible; } catch { compactWasVisibleBeforeVoiceRef.current = false; }
      try { api.hide?.(); } catch { }
    } else {
      try { api.hideVoiceBorder?.(); } catch { }
      if (compactWasVisibleBeforeVoiceRef.current) {
        try { api.show?.(); } catch { }
      }
      compactWasVisibleBeforeVoiceRef.current = false;
    }
  }, [voiceActive, overlayVisible]);

  useEffect(() => {
    if (!voiceActive) return;
    const api: any = (window as any).desktopAPI;
    if (!api?.updateVoiceBorder) return;
    const now = performance.now();
    if (now - lastAudioLevelSendRef.current < 33) return;
    lastAudioLevelSendRef.current = now;
    try { api.updateVoiceBorder({ audioLevel: voice.audioLevel }); } catch { }
  }, [voiceActive, voice.audioLevel]);

  useEffect(() => {
    if (!voiceActive) return;
    const api: any = (window as any).desktopAPI;
    if (!api?.updateVoiceBorder) return;
    const latest = voice.transcripts[voice.transcripts.length - 1];
    try {
      api.updateVoiceBorder({
        state: voice.state,
        muted: voice.muted,
        sharingScreen: voice.sharingScreen,
        activeTool: voice.activeTool,
        transcripts: latest ? [latest] : [],
      });
    } catch { }
  }, [voiceActive, voice.state, voice.muted, voice.sharingScreen, voice.activeTool, voice.transcripts]);

  useEffect(() => {
    const api: any = (window as any).desktopAPI;
    if (!api?.onVoiceBorderControl) return;
    const cleanup = api.onVoiceBorderControl((payload: { action?: 'mute' | 'close' | 'shareScreen' }) => {
      if (payload?.action === 'mute') {
        try { voice.toggleMute(); } catch { }
      } else if (payload?.action === 'close') {
        stopVoiceSession();
      } else if (payload?.action === 'shareScreen') {
        try { voice.toggleScreenShare(); } catch { }
      }
    });
    return () => { try { cleanup?.(); } catch { } };
  }, [voice, stopVoiceSession]);

  const startVoiceSession = useCallback(async () => {
    if (!signedIn) {
      try { await startBrowserSignIn(); } catch { }
      return;
    }
    setVoiceActive(true);
    try {
      await voice.start();
    } catch {
      if (!holdActiveRef.current) {
        setVoiceActive(false);
      }
    }
  }, [signedIn, voice]);

  const handleToggleVoice = useCallback(async () => {
    if (voiceActive) {
      stopVoiceSession();
      return;
    }
    await startVoiceSession();
  }, [voiceActive, startVoiceSession, stopVoiceSession]);

  useEffect(() => {
    if (voiceActive && voice.state === 'idle' && !holdActiveRef.current) {
      setVoiceActive(false);
    }
  }, [voiceActive, voice.state]);

  useEffect(() => {
    if (!voice.error || lastVoiceErrorRef.current === voice.error) return;
    lastVoiceErrorRef.current = voice.error;
    try {
      (window as any).desktopAPI?.notify?.('Voice mode error', voice.error);
    } catch { }
  }, [voice.error]);

  useEffect(() => {
    if (!voice.error) {
      lastVoiceErrorRef.current = null;
    }
  }, [voice.error]);

  const handleWakewordDetected = useCallback(async () => {
    try {
      if (!voiceActive) {
        await startVoiceSession();
      }
    } catch { }
  }, [voiceActive, startVoiceSession]);

  useEffect(() => {
    const cleanup = window.desktopAPI?.onWakewordDetected?.(() => {
      void handleWakewordDetected();
    });
    return () => { cleanup?.(); };
  }, [handleWakewordDetected]);

  useEffect(() => {
    const cleanup = (window as any).desktopAPI?.onVoiceSetActive?.(async (active: boolean) => {
      if (active) {
        if (voiceActive) {
          stopVoiceSession();
        } else {
          holdActiveRef.current = true;
          try {
            await startVoiceSession();
          } finally {
            holdActiveRef.current = false;
          }
        }
      } else {
        if (voiceActive) stopVoiceSession();
      }
    });
    return () => { cleanup?.(); };
  }, [voiceActive, startVoiceSession, stopVoiceSession]);

  return {
    voice,
    voiceActive,
    handleToggleVoice,
    handleWakewordDetected,
  };
}
