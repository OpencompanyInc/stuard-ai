import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import type { TranscriptLine } from '../../hooks/useVoiceMode';
import { VoiceMarkdownText } from './VoiceMarkdownText';

interface VoiceTranscriptBoxProps {
  transcript?: TranscriptLine;
}

/**
 * Translucent text rectangle that sits above the compact pill and shows
 * the latest transcript line. Glass-on-dark to read well against the
 * red ambient frame.
 */
export function VoiceTranscriptBox({ transcript }: VoiceTranscriptBoxProps) {
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
          className="px-5 py-3.5 rounded-2xl backdrop-blur-xl"
          style={{
            background: 'rgba(19, 18, 16, 0.55)',
            border: '1px solid rgba(255, 23, 39, 0.22)',
            boxShadow:
              '0 12px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 4, 22, 0.06) inset',
          }}
        >
          <div
            className={clsx(
              'text-[14px] leading-snug max-h-[34vh] overflow-y-auto scrollbar-hidden',
              transcript!.role === 'user'
                ? 'text-white font-medium'
                : 'text-white/85 italic',
              !transcript!.isFinal && 'opacity-85',
            )}
          >
            {transcript!.role === 'assistant' ? (
              <VoiceMarkdownText text={transcript!.text} />
            ) : (
              transcript!.text
            )}
            {!transcript!.isFinal && (
              <span className="inline-block w-[1.5px] h-[0.85em] bg-white/70 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
