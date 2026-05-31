import React from 'react';
import { motion } from 'framer-motion';
import type { VoiceState } from './VoiceOrb';

interface VoiceScreenFrameProps {
  audioLevel?: number;
  state?: VoiceState;
}

/**
 * Edge-only voice frame around the monitor. Center stays fully
 * transparent; only the perimeter gets a soft, warm-red ambient halo with
 * a gentle live pulse. No hard outline ring â€” the warmth fades in from
 * the edge so it reads as ambient light rather than a border decal.
 *
 * Palette (no purple): 131210, 010101, 17161F, 1E1D1C, FD0516, FF0416, FF1727.
 */
export function VoiceScreenFrame({ audioLevel = 0, state = 'idle' }: VoiceScreenFrameProps) {
  const intensity = Math.min(1, Math.max(0, audioLevel));
  const active = state === 'speaking' || state === 'listening';

  // Lighter base opacities â€” the previous values were too saturated and made
  // the frame feel oppressive. Keep idle very subtle, lift only when active.
  const base =
    state === 'speaking' ? 0.26 :
    state === 'listening' ? 0.22 :
    state === 'thinking' ? 0.18 :
    0.14;

  // Slow breath cycle, ~4.2s.
  const breathLow = base * 0.78;
  const breathHigh = base + 0.04 + intensity * 0.07;

  return (
    <>
      {/* Soft warm halo on each edge â€” pulses slowly to feel alive.
          Lower alphas + slightly thinner falloff so the screen feels open. */}
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        animate={{ opacity: [breathLow, breathHigh, breathLow] }}
        transition={{ duration: 4.2, ease: 'easeInOut', repeat: Infinity }}
        style={{
          background: `
            linear-gradient(to bottom, rgba(255, 56, 60, 0.18) 0%, rgba(255, 56, 60, 0) 10vh),
            linear-gradient(to top,    rgba(255, 56, 60, 0.20) 0%, rgba(255, 56, 60, 0) 11vh),
            linear-gradient(to right,  rgba(255, 56, 60, 0.14) 0%, rgba(255, 56, 60, 0) 7vw),
            linear-gradient(to left,   rgba(255, 56, 60, 0.14) 0%, rgba(255, 56, 60, 0) 7vw)
          `,
        }}
      />

      {/* Warm corner blooms â€” offset breath so the frame undulates instead
          of pulsing as one block. */}
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        animate={{ opacity: [0.14, 0.22, 0.14] }}
        transition={{ duration: 6.0, ease: 'easeInOut', repeat: Infinity, delay: 0.8 }}
        style={{
          background: `
            radial-gradient(28% 22% at 0% 100%, rgba(255, 56, 60, 0.28) 0%, rgba(255, 56, 60, 0) 70%),
            radial-gradient(28% 22% at 100% 100%, rgba(255, 56, 60, 0.24) 0%, rgba(255, 56, 60, 0) 70%),
            radial-gradient(26% 20% at 0% 0%, rgba(255, 56, 60, 0.16) 0%, rgba(255, 56, 60, 0) 70%),
            radial-gradient(26% 20% at 100% 0%, rgba(255, 56, 60, 0.16) 0%, rgba(255, 56, 60, 0) 70%)
          `,
        }}
      />

      {/* Audio-reactive bloom near the bottom-center, where the pill sits.
          Subtle â€” lifts only with real audio. */}
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        animate={{ opacity: 0.05 + intensity * 0.22 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{
          background: `radial-gradient(36% 16% at 50% 100%, rgba(255, 56, 60, 0.24) 0%, rgba(255, 56, 60, 0) 75%)`,
        }}
      />

      {/* Subtle "wave" while speaking/listening â€” a soft horizontal sheen
          that drifts left â†’ right across the bottom edge, then resets.
          Implemented as a wide radial bloom whose center coordinate animates,
          which the GPU can move cheaply without any layout work. */}
      {active && (
        <motion.div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          animate={{ backgroundPositionX: ['-30%', '130%'] }}
          transition={{
            duration: state === 'speaking' ? 5.5 : 7.0,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
          style={{
            background:
              'radial-gradient(36% 18% at 50% 100%, rgba(255, 56, 60, 0.18) 0%, rgba(255, 56, 60, 0) 70%)',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '60% 100%',
            opacity: 0.55,
          }}
        />
      )}

      {/* Soft inner glow at the edge â€” no hard ring. The light feathers
          in from the perimeter so the screen feels held, not framed. */}
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        animate={{
          boxShadow: [
            'inset 0 0 12px rgba(255, 56, 60, 0.12), inset 0 0 50px rgba(255, 56, 60, 0.05)',
            'inset 0 0 18px rgba(255, 56, 60, 0.18), inset 0 0 75px rgba(255, 56, 60, 0.08)',
            'inset 0 0 12px rgba(255, 56, 60, 0.12), inset 0 0 50px rgba(255, 56, 60, 0.05)',
          ],
        }}
        transition={{ duration: 4.2, ease: 'easeInOut', repeat: Infinity }}
      />
    </>
  );
}
