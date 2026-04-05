import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Mic, MicOff, X } from 'lucide-react';
import { VoiceOrb, type VoiceState } from '../components/voice/VoiceOrb';
import { VoiceTranscript, type VoiceTranscriptRole } from '../components/voice/VoiceTranscript';
import { VoiceToolFeedback, type ToolStatus } from '../components/voice/VoiceToolFeedback';
import { VoicePill } from '../components/voice/VoicePill';

// =============================================================================
// SIMULATED AUDIO LEVEL
// =============================================================================

function useSimulatedAudioLevel(active: boolean) {
  const [level, setLevel] = useState(0);
  const raf = useRef(0);
  const smoothed = useRef(0);

  useEffect(() => {
    if (!active) { setLevel(0); smoothed.current = 0; return; }
    let t = 0;
    const tick = () => {
      t += 0.02;
      // Slow, gentle sine waves — like natural speech cadence
      const base = Math.sin(t * 0.8) * 0.2 + Math.sin(t * 1.7) * 0.12 + Math.sin(t * 0.3) * 0.08;
      const target = Math.max(0, Math.min(1, 0.25 + base));
      // Heavy smoothing so it never jumps
      smoothed.current += (target - smoothed.current) * 0.08;
      setLevel(smoothed.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active]);

  return level;
}

// =============================================================================
// DEMO SCENARIO
// =============================================================================

interface DemoStep {
  state: VoiceState;
  duration: number;
  transcript?: { role: VoiceTranscriptRole; text: string; isFinal: boolean };
  tool?: { name: string; status: 'running' | 'done' };
}

const DEMO_SCENARIO: DemoStep[] = [
  { state: 'idle', duration: 4000 },
  { state: 'listening', duration: 1200, transcript: { role: 'user', text: 'Hey Stuard, what', isFinal: false } },
  { state: 'listening', duration: 1000, transcript: { role: 'user', text: "Hey Stuard, what's on my", isFinal: false } },
  { state: 'listening', duration: 1200, transcript: { role: 'user', text: "Hey Stuard, what's on my calendar today?", isFinal: true } },
  { state: 'thinking', duration: 1200, tool: { name: 'list_calendar_events', status: 'running' } },
  { state: 'thinking', duration: 1800, tool: { name: 'list_calendar_events', status: 'done' } },
  { state: 'speaking', duration: 1200, transcript: { role: 'assistant', text: 'You have three', isFinal: false } },
  { state: 'speaking', duration: 1400, transcript: { role: 'assistant', text: 'You have three meetings today.', isFinal: false } },
  { state: 'speaking', duration: 2200, transcript: { role: 'assistant', text: 'You have three meetings today. The next one is a team standup in 20 minutes.', isFinal: true } },
  { state: 'idle', duration: 4500 },
  { state: 'listening', duration: 1100, transcript: { role: 'user', text: 'Search for', isFinal: false } },
  { state: 'listening', duration: 1200, transcript: { role: 'user', text: 'Search for React 19 release notes', isFinal: true } },
  { state: 'thinking', duration: 1000, tool: { name: 'web_search', status: 'running' } },
  { state: 'thinking', duration: 2200, tool: { name: 'web_search', status: 'done' } },
  { state: 'speaking', duration: 3000, transcript: { role: 'assistant', text: 'React 19 shipped with the new compiler, server actions, and use() hook. Want me to open the full notes?', isFinal: true } },
  { state: 'idle', duration: 4500 },
];

// =============================================================================
// VOICE MODE VIEW — Transparent overlay, no background
// =============================================================================

interface VoiceModeViewProps {
  demo?: boolean;
  onClose?: () => void;
}

export function VoiceModeView({ demo = true, onClose }: VoiceModeViewProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [muted, setMuted] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState<Array<{
    id: number; role: VoiceTranscriptRole; text: string; isFinal: boolean; timestamp: number;
  }>>([]);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const lineIdRef = useRef(0);
  const toolIdRef = useRef(0);

  const audioLevel = useSimulatedAudioLevel(
    (voiceState === 'listening' || voiceState === 'speaking') && !muted
  );

  // Demo auto-play
  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    const runDemo = async () => {
      while (!cancelled) {
        for (const step of DEMO_SCENARIO) {
          if (cancelled) return;
          setVoiceState(step.state);

          if (step.transcript) {
            const id = ++lineIdRef.current;
            setTranscriptLines(prev => {
              const filtered = prev.filter(l => l.isFinal || l.role !== step.transcript!.role);
              return [...filtered, {
                id, role: step.transcript!.role, text: step.transcript!.text,
                isFinal: step.transcript!.isFinal, timestamp: Date.now(),
              }];
            });
          }

          if (step.tool) {
            if (step.tool.status === 'running') {
              const id = `tool-${++toolIdRef.current}`;
              setTools(prev => [...prev, { id, name: step.tool!.name, status: 'running' }]);
            } else {
              setTools(prev => prev.map(t => ({ ...t, status: 'done' as const })));
              setTimeout(() => setTools([]), 400);
            }
          }

          await new Promise<void>(resolve => { timeout = setTimeout(resolve, step.duration); });
        }
        setTranscriptLines([]);
        setTools([]);
      }
    };

    void runDemo();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [demo]);

  // Manual state cycling
  const cycleState = useCallback(() => {
    if (demo) return;
    setVoiceState(prev => {
      const order: VoiceState[] = ['idle', 'listening', 'thinking', 'speaking'];
      return order[(order.indexOf(prev) + 1) % order.length];
    });
  }, [demo]);

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full select-none"
      style={{ background: 'transparent' }}>

      {/* Draggable title bar region */}
      <div className="absolute top-0 left-0 right-0 h-10 z-30"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Close button */}
      {onClose && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onClose}
          className="absolute top-3 right-3 z-40 p-1.5 rounded-full text-white/20 hover:text-white/50 hover:bg-white/[0.06] transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X size={14} />
        </motion.button>
      )}

      {/* State label */}
      <motion.div
        className="absolute z-10"
        style={{ top: '12%' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center gap-2">
          <div className={clsx(
            'w-1.5 h-1.5 rounded-full transition-colors duration-700',
            voiceState === 'idle' && 'bg-white/25',
            voiceState === 'listening' && 'bg-blue-400/60',
            voiceState === 'thinking' && 'bg-purple-400/60',
            voiceState === 'speaking' && 'bg-sky-400/60',
          )} />
          <span className={clsx(
            'text-[10px] tracking-[0.2em] uppercase font-light transition-colors duration-700',
            voiceState === 'idle' && 'text-white/20',
            voiceState === 'listening' && 'text-blue-300/40',
            voiceState === 'thinking' && 'text-purple-300/40',
            voiceState === 'speaking' && 'text-sky-300/40',
          )}>
            {voiceState}
          </span>
        </div>
      </motion.div>

      {/* The Three.js Orb */}
      <div className="relative z-10 cursor-pointer" onClick={cycleState}>
        <VoiceOrb state={voiceState} audioLevel={audioLevel} size={220} />
      </div>

      {/* Transcript */}
      <div className="relative z-10 mt-6 min-h-[60px] flex items-start justify-center">
        <VoiceTranscript lines={transcriptLines} displayDuration={4000} />
      </div>

      {/* Tool feedback */}
      <div className="relative z-10 mt-2 min-h-[28px]">
        <VoiceToolFeedback tools={tools} />
      </div>

      {/* Compact pill at the bottom */}
      <motion.div
        className="absolute bottom-6 z-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        <VoicePill
          state={voiceState}
          audioLevel={audioLevel}
          muted={muted}
          transcript={(() => {
            const latest = transcriptLines[transcriptLines.length - 1];
            return latest?.text;
          })()}
          transcriptRole={transcriptLines[transcriptLines.length - 1]?.role}
          isFinal={transcriptLines[transcriptLines.length - 1]?.isFinal}
          toolName={tools.find(t => t.status === 'running')?.name}
          onMuteToggle={() => setMuted(m => !m)}
          onClose={onClose}
        />
      </motion.div>
    </div>
  );
}
