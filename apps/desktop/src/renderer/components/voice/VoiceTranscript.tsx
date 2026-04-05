import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X } from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

export type VoiceTranscriptRole = 'user' | 'assistant';

interface TranscriptLine {
  id: number;
  role: VoiceTranscriptRole;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

interface VoiceTranscriptProps {
  lines: TranscriptLine[];
  /** How long (ms) a final line stays visible before fading. Default 4000 */
  displayDuration?: number;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function VoiceTranscript({ lines, displayDuration = 4000 }: VoiceTranscriptProps) {
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());

  // Track which lines are visible and auto-expire final ones
  useEffect(() => {
    const newIds = new Set(lines.map(l => l.id));
    setVisibleIds(newIds);

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const line of lines) {
      if (line.isFinal) {
        const age = Date.now() - line.timestamp;
        const remaining = Math.max(0, displayDuration - age);
        timers.push(setTimeout(() => {
          setVisibleIds(prev => {
            const next = new Set(prev);
            next.delete(line.id);
            return next;
          });
        }, remaining));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [lines, displayDuration]);

  const visible = lines.filter(l => visibleIds.has(l.id));

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1.5 max-w-[320px]">
      <AnimatePresence mode="popLayout">
        {visible.map(line => (
          <motion.div
            key={line.id}
            layout
            initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="w-full text-center"
          >
            <p className={clsx(
              'text-[14px] leading-relaxed font-light',
              line.role === 'user' ? 'text-white/70' : 'text-white/55 italic',
              !line.isFinal && 'text-white/40',
            )}>
              {line.text}
              {!line.isFinal && (
                <span className="inline-block w-[2px] h-[0.9em] bg-white/40 ml-1 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
              )}
            </p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
