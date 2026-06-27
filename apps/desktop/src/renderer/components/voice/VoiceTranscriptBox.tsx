import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import type { TranscriptLine } from '../../hooks/useVoiceMode';
import { VoiceMarkdownText } from './VoiceMarkdownText';

interface VoiceTranscriptBoxProps {
  transcript?: TranscriptLine;
  /** Center-align caption text (voice border overlay). */
  centered?: boolean;
}

/**
 * Transcript card above the voice pill — uses the compact / launcher surface
 * palette so it reads as part of the same UI family as the input pill.
 */
export function VoiceTranscriptBox({ transcript, centered = false }: VoiceTranscriptBoxProps) {
  const hasText = !!transcript?.text;

  return (
    <AnimatePresence>
      {hasText && (
        <motion.div
          key={`b-${transcript!.id}`}
          initial={{ opacity: 0, y: 6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.985 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="voice-mode-transcript"
        >
          <div
            className={clsx(
              'voice-mode-transcript__text scrollbar-hidden',
              centered && 'text-center text-[15px] leading-relaxed',
              transcript!.role === 'user'
                ? 'voice-mode-transcript__text--user'
                : 'voice-mode-transcript__text--assistant',
              !transcript!.isFinal && 'voice-mode-transcript__text--partial',
            )}
          >
            {transcript!.role === 'assistant' ? (
              <VoiceMarkdownText text={transcript!.text} />
            ) : (
              transcript!.text
            )}
            {!transcript!.isFinal && (
              <span className="inline-block w-[1.5px] h-[0.85em] bg-pill-fg/50 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
