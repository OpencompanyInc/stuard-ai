import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Shield, Brain, HardDrive, Eye } from 'lucide-react';
import { TipBanner } from './FeatureComponents';

// =============================================================================
// TRUST COACHING
// =============================================================================
// Surfaces trust & control principles contextually, replacing the old
// essay-style "Trust & Control" onboarding step.
// Each principle appears once, at the moment it becomes relevant.

const STORAGE_KEY = 'stuard_trust_coaching';

interface TrustCoachingState {
  shownTips: string[];
}

function loadTrustState(): TrustCoachingState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { shownTips: [] };
}

function saveTrustState(state: TrustCoachingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export type TrustEvent =
  | 'tool_execution'   // First time Stuard uses a tool
  | 'memory_save'      // First time a memory is saved
  | 'file_action'      // First time Stuard accesses a file
  | 'activity_log';    // First time user views history

const TRUST_TIPS: Record<TrustEvent, {
  message: string;
  actionLabel?: string;
  actionRoute?: string;
}> = {
  tool_execution: {
    message: 'Stuard asks before taking important actions. You can review and approve each one.',
  },
  memory_save: {
    message: 'You can always view, edit, or delete what Stuard remembers about you.',
    actionLabel: 'View memories',
    actionRoute: 'memories',
  },
  file_action: {
    message: 'All your data stays on your machine. Cloud features are always opt-in.',
  },
  activity_log: {
    message: 'Everything Stuard does is logged here. Full transparency, always.',
  },
};

interface TrustCoachingProps {
  /** Callback to navigate to a route (e.g., 'memories') */
  onNavigate?: (route: string) => void;
}

/**
 * Trust coaching manager. Render this once in the app root.
 * Call `triggerTrustTip()` from the returned ref when trust-relevant events occur.
 */
export function useTrustCoaching({ onNavigate }: TrustCoachingProps = {}) {
  const [activeTip, setActiveTip] = useState<TrustEvent | null>(null);
  const stateRef = useRef(loadTrustState());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerTrustTip = useCallback((event: TrustEvent) => {
    const state = stateRef.current;
    // Only show each trust tip once
    if (state.shownTips.includes(event)) return;

    state.shownTips.push(event);
    saveTrustState(state);
    stateRef.current = state;

    setActiveTip(event);

    // Auto-dismiss after 8 seconds
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setActiveTip(null);
    }, 8000);
  }, []);

  const dismissTip = useCallback(() => {
    setActiveTip(null);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const handleAction = useCallback(() => {
    if (activeTip) {
      const tip = TRUST_TIPS[activeTip];
      if (tip.actionRoute && onNavigate) {
        onNavigate(tip.actionRoute);
      }
    }
    dismissTip();
  }, [activeTip, onNavigate, dismissTip]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const tipData = activeTip ? TRUST_TIPS[activeTip] : null;

  return {
    triggerTrustTip,
    activeTip,
    tipData,
    dismissTip,
    handleAction,
  };
}

/**
 * Renders the trust coaching tip banner.
 * Use alongside useTrustCoaching().
 */
export function TrustCoachingBanner({
  activeTip,
  tipData,
  onDismiss,
  onAction,
}: {
  activeTip: string | null;
  tipData: { message: string; actionLabel?: string; actionRoute?: string } | null;
  onDismiss: () => void;
  onAction: () => void;
}) {
  return (
    <AnimatePresence>
      {activeTip && tipData && (
        <TipBanner
          message={tipData.message}
          action={tipData.actionLabel ? { label: tipData.actionLabel, onClick: onAction } : undefined}
          onDismiss={onDismiss}
        />
      )}
    </AnimatePresence>
  );
}
