import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X, Loader2, Sparkles } from 'lucide-react';
import { VoiceOrb } from './VoiceOrb';
import type { VoiceModeState, TranscriptLine, VoiceToolEvent } from '../../hooks/useVoiceMode';
import { describeTool, friendlyVoiceState } from './voiceLabels';
import { VoiceMarkdownText } from './VoiceMarkdownText';

interface VoiceMorphPillProps {
  voiceActive: boolean;
  voiceState: VoiceModeState;
  voiceAudioLevel: number;
  voiceMuted: boolean;
  voiceTranscripts: TranscriptLine[];
  voiceActiveTools: VoiceToolEvent[];
  voiceLastTool: VoiceToolEvent | null;
  voiceActiveToolName?: string | null;
  onVoiceMuteToggle?: () => void;
  onToggleVoice?: () => void;
  children: React.ReactNode;
}

const STATE_TINT: Record<VoiceModeState, { halo: string; rim: string }> = {
  idle: {
    halo: 'rgba(99,102,241,0)',
    rim: 'rgba(0,0,0,0.06)',
  },
  connecting: {
    halo: 'rgba(99,102,241,0.18)',
    rim: 'rgba(99,102,241,0.25)',
  },
  listening: {
    halo: 'rgba(56,189,248,0.22)',
    rim: 'rgba(56,189,248,0.28)',
  },
  thinking: {
    halo: 'rgba(251,191,36,0.22)',
    rim: 'rgba(251,191,36,0.30)',
  },
  speaking: {
    halo: 'rgba(167,139,250,0.24)',
    rim: 'rgba(167,139,250,0.32)',
  },
};

function statusForVoice(
  state: VoiceModeState,
  activeTools: VoiceToolEvent[],
  activeToolName?: string | null,
  lastTool?: VoiceToolEvent | null,
): { label: string; detail?: string; isToolActivity: boolean } {
  if (activeTools.length > 0) {
    const top = activeTools[activeTools.length - 1];
    return { label: top.label, detail: top.detail, isToolActivity: true };
  }
  if (activeToolName) {
    const friendly = describeTool(activeToolName);
    return { label: friendly.label, detail: friendly.detail, isToolActivity: true };
  }
  if (lastTool && state !== 'speaking') {
    return { label: `Did ${lastTool.label.toLowerCase()}`, isToolActivity: true };
  }
  return { label: friendlyVoiceState(state), isToolActivity: false };
}

export function VoiceMorphPill({
  voiceActive,
  voiceState,
  voiceAudioLevel,
  voiceMuted,
  voiceTranscripts,
  voiceActiveTools,
  voiceLastTool,
  voiceActiveToolName,
  onVoiceMuteToggle,
  onToggleVoice,
  children,
}: VoiceMorphPillProps) {
  const tint = STATE_TINT[voiceActive ? voiceState : 'idle'];
  const lastLine = voiceTranscripts[voiceTranscripts.length - 1];
  const showLiveTranscript =
    voiceActive && lastLine && lastLine.text && (
      !lastLine.isFinal ||
      Date.now() - lastLine.timestamp < 3000
    );

  const status = statusForVoice(voiceState, voiceActiveTools, voiceActiveToolName, voiceLastTool);

  // Audio-driven halo strength (0-1, smoothed in the orb already)
  const haloIntensity = voiceActive ? Math.min(1, 0.4 + voiceAudioLevel * 0.8) : 0;

  return (
    <motion.div layout className="flex-1 min-w-0 relative">
      {/* Animated tinted halo — sits behind the pill, intensifies with audio. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[60px] -z-10"
        animate={{
          opacity: voiceActive ? 1 : 0,
          boxShadow: voiceActive
            ? `0 0 ${24 + haloIntensity * 28}px ${tint.halo}, 0 0 ${56 + haloIntensity * 42}px ${tint.halo}`
            : '0 0 0px rgba(0,0,0,0)',
        }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />

      {/* Main pill surface — single shared element so input ↔ voice morphs. */}
      <motion.div
        layout
        className={clsx(
          'relative w-full overflow-hidden',
          'rounded-[56px] backdrop-blur-xl',
          'transition-colors duration-300',
        )}
        animate={{
          minHeight: 42,
          backgroundColor: voiceActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,1)',
          borderColor: tint.rim,
        }}
        style={{ borderWidth: 1, borderStyle: 'solid' }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Inner state-tinted gradient sheen, only visible when voice is on. */}
        <AnimatePresence>
          {voiceActive && (
            <motion.div
              key={`sheen-${voiceState}`}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.55 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="pointer-events-none absolute inset-0"
              style={{
                background: `linear-gradient(120deg, ${tint.halo} 0%, transparent 55%, ${tint.halo} 100%)`,
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
          {voiceActive ? (
            <motion.div
              key="voice-row"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative flex items-center gap-2 pl-1 pr-1.5 py-1"
              style={{ minHeight: 42 }}
            >
              <motion.div
                layout
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="flex-shrink-0 flex items-center justify-center"
                style={{ width: 40, height: 40 }}
              >
                <VoiceOrb
                  state={(voiceState === 'connecting' ? 'thinking' : voiceState) as any}
                  audioLevel={voiceAudioLevel}
                  size={40}
                />
              </motion.div>

              <div className="flex-1 min-w-0 flex flex-col justify-center leading-tight">
                <AnimatePresence mode="wait">
                  {showLiveTranscript ? (
                    <motion.div
                      key={`t-${lastLine!.id}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.18 }}
                      className={clsx(
                        'text-[13px] leading-snug truncate',
                        lastLine!.role === 'user'
                          ? 'text-theme-fg font-medium'
                          : 'text-theme-fg/70 italic',
                        !lastLine!.isFinal && 'opacity-70',
                      )}
                    >
                      {lastLine!.role === 'assistant' ? (
                        <VoiceMarkdownText text={lastLine!.text} />
                      ) : (
                        lastLine!.text
                      )}
                      {!lastLine!.isFinal && (
                        <span className="inline-block w-[1.5px] h-[0.85em] bg-gray-400/80 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`s-${status.label}-${status.detail || ''}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.22 }}
                      className="flex items-center gap-1.5 min-w-0"
                    >
                      {status.isToolActivity && (
                        <Loader2 size={11} className="animate-spin text-theme-muted flex-shrink-0" />
                      )}
                      <span className="text-[12.5px] text-theme-fg/85 font-medium tracking-wide truncate">
                        {status.label}
                      </span>
                      {status.detail && (
                        <span className="text-[11.5px] text-theme-muted truncate">
                          {status.detail}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {onVoiceMuteToggle && (
                <button
                  type="button"
                  onClick={onVoiceMuteToggle}
                  title={voiceMuted ? 'Unmute' : 'Mute'}
                  className={clsx(
                    'no-drag h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all',
                    voiceMuted
                      ? 'bg-red-500/15 text-red-500'
                      : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60',
                  )}
                >
                  {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              )}
              {onToggleVoice && (
                <button
                  type="button"
                  onClick={onToggleVoice}
                  title="Exit voice mode"
                  className="no-drag h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="input-row"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative flex items-center px-1.5 py-0.5"
              style={{ minHeight: 42 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Tool-activity chip rail. Mounted under the pill while voice is active
          and at least one tool is in flight (or just finished). */}
      <AnimatePresence>
        {voiceActive && voiceActiveTools.length > 0 && (
          <motion.div
            key="tool-rail"
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 pt-1.5 px-1">
              {voiceActiveTools.map(t => (
                <motion.div
                  key={t.callId}
                  layout
                  initial={{ opacity: 0, scale: 0.9, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-theme/10 bg-white/70 backdrop-blur-md px-2.5 py-1 shadow-sm"
                >
                  {t.name === 'delegate' ? (
                    <Sparkles size={10} className="text-violet-500/80" />
                  ) : (
                    <Loader2 size={10} className="animate-spin text-theme-muted" />
                  )}
                  <span className="text-[11px] text-theme-fg/80 font-medium tracking-wide">
                    {t.label}
                  </span>
                  {t.detail && (
                    <span className="text-[10.5px] text-theme-muted truncate max-w-[160px]">
                      {t.detail}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
