import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X, Loader2, Sparkles } from 'lucide-react';
import { VoiceOrb } from './VoiceOrb';
import type { VoiceModeState, TranscriptLine, VoiceToolEvent } from '../../hooks/useVoiceMode';
import { describeTool, friendlyVoiceState, voiceStateHaloShadow } from './voiceLabels';
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
  const lastLine = voiceTranscripts[voiceTranscripts.length - 1];
  const showLiveTranscript =
    voiceActive && lastLine && lastLine.text && (
      !lastLine.isFinal ||
      Date.now() - lastLine.timestamp < 3000
    );

  const status = statusForVoice(voiceState, voiceActiveTools, voiceActiveToolName, voiceLastTool);
  const showThinkingGlow = voiceActive && (voiceState === 'thinking' || voiceState === 'connecting');
  const orbState = (voiceState === 'connecting' ? 'thinking' : voiceState) as 'idle' | 'listening' | 'thinking' | 'speaking';

  return (
    <motion.div layout className="flex-1 min-w-0 relative voice-mode-pill-wrap">
      {/* Brand-red audio halo behind the pill */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[26px] -z-10"
        animate={{
          opacity: voiceActive ? 1 : 0,
          boxShadow: voiceActive
            ? voiceStateHaloShadow(voiceState, voiceAudioLevel)
            : '0 0 0px rgba(0,0,0,0)',
        }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />

      {/* Main pill — morphs between input row and voice row */}
      <motion.div
        layout
        className={clsx(
          'relative w-full overflow-hidden',
          voiceActive && showThinkingGlow && 'compact-thinking-glow',
        )}
      >
        <motion.div
          layout
          className={clsx(
            'relative w-full overflow-hidden transition-colors duration-300',
            voiceActive && showThinkingGlow && 'compact-thinking-glow__inner',
            voiceActive && !showThinkingGlow && 'voice-mode-pill !min-h-[42px] !py-1 !px-1.5 !block !w-full',
          )}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
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
                    state={orbState}
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
                            ? 'text-pill-fg font-medium'
                            : 'text-pill-fg/70 italic',
                          !lastLine!.isFinal && 'opacity-70',
                        )}
                      >
                        {lastLine!.role === 'assistant' ? (
                          <VoiceMarkdownText text={lastLine!.text} />
                        ) : (
                          lastLine!.text
                        )}
                        {!lastLine!.isFinal && (
                          <span className="inline-block w-[1.5px] h-[0.85em] bg-pill-muted/80 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
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
                          <Loader2 size={11} className="animate-spin text-pill-muted flex-shrink-0" />
                        )}
                        <span className="text-[12.5px] text-pill-fg/85 font-medium tracking-wide truncate">
                          {status.label}
                        </span>
                        {status.detail && (
                          <span className="text-[11.5px] text-pill-muted truncate">
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
                      'no-drag voice-mode-pill__btn !h-7 !w-7 !rounded-lg',
                      voiceMuted && 'voice-mode-pill__btn--danger',
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
                    className="no-drag voice-mode-pill__btn !h-7 !w-7 !rounded-lg"
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
      </motion.div>

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
                  className="voice-mode-tool-chip"
                >
                  {t.name === 'delegate' ? (
                    <Sparkles size={10} className="text-violet-500/80" />
                  ) : (
                    <Loader2 size={10} className="animate-spin text-pill-muted" />
                  )}
                  <span>{t.label}</span>
                  {t.detail && (
                    <span className="text-pill-muted truncate max-w-[160px] text-[10.5px]">
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
