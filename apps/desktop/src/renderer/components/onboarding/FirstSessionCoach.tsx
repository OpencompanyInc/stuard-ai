import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AtSign, MessageCircle, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { ChallengeCard, type ChallengeStep } from './ChallengeCard';
import { CapabilityCards } from './CapabilityCards';
import { SuggestedPrompts } from './SuggestedPrompts';
import { useOnboarding } from './OnboardingContext';

// ---------- Types ----------

type ChallengeId = 'ask' | 'mention' | 'explore' | 'path';

interface FirstSessionCoachProps {
  /** Number of user messages sent this session */
  messageCount: number;
  /** Callback to insert text into the input area */
  onInsertPrompt?: (text: string) => void;
  /** Callback when user finishes all challenges */
  onComplete: () => void;
}

// ---------- Challenge definitions ----------

const CHALLENGES: Record<ChallengeId, ChallengeStep> = {
  ask: {
    id: 'ask',
    title: 'Ask me something',
    subtitle: 'Pick a prompt or type your own — I\'ll show you what I can do.',
    icon: MessageCircle,
    color: 'blue',
    cta: 'Choose a prompt below',
  },
  mention: {
    id: 'mention',
    title: 'Add context with @',
    subtitle: 'Type @ in the chat to mention a file or folder for more targeted help.',
    icon: AtSign,
    color: 'purple',
    cta: 'Try typing @',
  },
  explore: {
    id: 'explore',
    title: 'See what Stuard can do',
    subtitle: 'Workflows, proactive agent, planner, integrations, and more.',
    icon: Sparkles,
    color: 'amber',
    cta: 'Explore capabilities',
  },
  path: {
    id: 'path',
    title: 'Pick your path',
    subtitle: 'Choose how you\'d like to use Stuard — this shapes your experience.',
    icon: Sparkles,
    color: 'cyan',
    cta: 'Choose a path',
  },
};

const CHALLENGE_ORDER: ChallengeId[] = ['ask', 'mention', 'explore'];

const PATH_OPTIONS = [
  { id: 'assistant', label: 'Assistant', desc: 'Chat, search, write — your everyday helper' },
  { id: 'automation', label: 'Automation', desc: 'Build workflows and let Stuard handle the rest' },
  { id: 'workspace', label: 'Workspace', desc: 'Organize tasks, calendars, and projects' },
  { id: 'operator', label: 'Operator', desc: 'Full agent — monitors, acts, and operates autonomously' },
];

// ---------- Component ----------

export function FirstSessionCoach({
  messageCount,
  onInsertPrompt,
  onComplete,
}: FirstSessionCoachProps) {
  const { progress, markFeatureExperienced, setFirstSessionComplete } = useOnboarding();
  const [completed, setCompleted] = useState<Set<ChallengeId>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [celebratingId, setCelebratingId] = useState<ChallengeId | null>(null);

  // Derive current challenge index from completion state + message count
  const currentIndex = useMemo(() => {
    // Challenge 0 (ask): complete after first user message
    if (!completed.has('ask') && messageCount < 1) return 0;
    // Challenge 1 (mention): complete after second exchange or when user types @
    if (!completed.has('mention') && messageCount < 2) return 1;
    // Challenge 2 (explore): capability cards
    if (!completed.has('explore')) return 2;
    return CHALLENGE_ORDER.length; // all done
  }, [completed, messageCount]);

  // Auto-complete "ask" after first message
  useEffect(() => {
    if (messageCount >= 1 && !completed.has('ask')) {
      completeChallenge('ask');
    }
  }, [messageCount]);

  // Auto-complete "mention" after second message (even if they didn't use @)
  useEffect(() => {
    if (messageCount >= 2 && !completed.has('mention')) {
      completeChallenge('mention');
    }
  }, [messageCount]);

  const completeChallenge = useCallback((id: ChallengeId) => {
    setCelebratingId(id);
    setTimeout(() => {
      setCompleted(prev => new Set([...prev, id]));
      setCelebratingId(null);
    }, 1200);
  }, []);

  const handleCapabilitySelect = useCallback((capId: string) => {
    markFeatureExperienced(capId);
    // After exploring at least one capability, mark explore as done
    if (!completed.has('explore')) {
      completeChallenge('explore');
    }
  }, [completed, markFeatureExperienced, completeChallenge]);

  const handlePathSelect = useCallback((pathId: string) => {
    setSelectedPath(pathId);
    try { localStorage.setItem('stuard.pref.onboarding_path', pathId); } catch {}
    // Mark session complete
    setTimeout(() => {
      setFirstSessionComplete(true);
      onComplete();
    }, 600);
  }, [setFirstSessionComplete, onComplete]);

  const handlePromptSelect = useCallback((prompt: string) => {
    onInsertPrompt?.(prompt);
    if (!completed.has('ask')) {
      // Don't auto-complete yet — wait for the actual message send
    }
  }, [onInsertPrompt, completed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setFirstSessionComplete(true);
    onComplete();
  }, [setFirstSessionComplete, onComplete]);

  // After all challenges done, show path selection or auto-complete
  const allChallengesDone = currentIndex >= CHALLENGE_ORDER.length;

  if (dismissed) return null;

  // Determine what to render based on current challenge
  const currentChallengeId = CHALLENGE_ORDER[currentIndex] as ChallengeId | undefined;
  const isWelcomeMode = messageCount === 0; // Show full card in empty chat

  return (
    <AnimatePresence mode="wait">
      {/* Celebration overlay for just-completed challenge */}
      {celebratingId && (
        <motion.div
          key={`celebrate-${celebratingId}`}
          className="w-full max-w-lg mx-auto"
        >
          <ChallengeCard
            step={{ ...CHALLENGES[celebratingId], completed: true }}
            mode="celebration"
          />
        </motion.div>
      )}

      {/* Path selection — shown after all challenges */}
      {!celebratingId && allChallengesDone && (
        <motion.div
          key="path"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-lg mx-auto flex flex-col items-center gap-5 px-4"
        >
          <p className="text-sm font-light text-white/60 text-center">
            How would you like to use Stuard?
          </p>
          <div className="grid grid-cols-2 gap-3 w-full">
            {PATH_OPTIONS.map((opt) => (
              <motion.button
                key={opt.id}
                whileTap={{ scale: 0.97 }}
                onClick={() => handlePathSelect(opt.id)}
                className={clsx(
                  'group rounded-xl border px-4 py-3.5 text-left backdrop-blur-xl transition-all',
                  'hover:ring-1 active:scale-[0.98]',
                  selectedPath === opt.id
                    ? 'border-white/20 bg-white/[0.08] ring-1 ring-white/15'
                    : 'border-white/[0.06] bg-white/[0.03] hover:ring-white/10',
                )}
              >
                <p className="text-sm font-medium text-white/80">{opt.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">{opt.desc}</p>
              </motion.button>
            ))}
          </div>
          <button
            onClick={handleDismiss}
            className="text-xs text-white/30 hover:text-white/50 transition-colors mt-2"
          >
            Skip for now
          </button>
        </motion.div>
      )}

      {/* Active challenge */}
      {!celebratingId && !allChallengesDone && currentChallengeId && (
        <motion.div
          key={currentChallengeId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-lg mx-auto flex flex-col gap-4 px-4"
        >
          <ChallengeCard
            step={CHALLENGES[currentChallengeId]}
            mode={isWelcomeMode ? 'welcome' : 'nudge'}
            onDismiss={handleDismiss}
          />

          {/* Extra content based on challenge type */}
          {currentChallengeId === 'ask' && (
            <SuggestedPrompts
              onSelect={handlePromptSelect}
              maxVisible={6}
            />
          )}

          {currentChallengeId === 'explore' && (
            <CapabilityCards
              onSelect={handleCapabilitySelect}
              experienced={progress.featureExperienced}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
