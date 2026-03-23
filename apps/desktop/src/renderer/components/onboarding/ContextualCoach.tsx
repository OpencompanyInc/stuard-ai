import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, X, ArrowRight } from 'lucide-react';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useTrustCoaching, TrustCoachingBanner, type TrustEvent } from './TrustCoaching';

// =============================================================================
// CONTEXTUAL COACH
// =============================================================================
// Thin wrapper that listens for feature events and surfaces the right coaching:
//   1. Session milestones (from DiscoveryEngine)
//   2. Trust coaching tips (from TrustCoaching)
//   3. Feature-first-visit coaching (from OnboardingContext via enterArea)
//
// Render once at the app root level. All coaching is non-blocking — a single
// dismissible banner at the top of the viewport.

interface ContextualCoachProps {
  /** Callback to navigate to a feature area (e.g., 'workflows', 'settings:proactive') */
  onNavigate?: (route: string) => void;
}

export function ContextualCoach({ onNavigate }: ContextualCoachProps) {
  const { getSessionMilestone, dismissTip, sessionCount } = useDiscovery();
  const { triggerTrustTip, activeTip, tipData, dismissTip: dismissTrust, handleAction: handleTrustAction } = useTrustCoaching({ onNavigate });

  // Session milestone state
  const [milestone, setMilestone] = useState<{
    id: string;
    message: string;
    actionLabel: string;
    actionRoute: string;
  } | null>(null);
  const checkedSession = useRef(false);

  // Check for session milestones on mount (once per session)
  useEffect(() => {
    if (checkedSession.current) return;
    checkedSession.current = true;

    // Small delay so the app renders first
    const timer = setTimeout(() => {
      const m = getSessionMilestone();
      if (m) setMilestone(m);
    }, 3000);

    return () => clearTimeout(timer);
  }, [getSessionMilestone]);

  const handleMilestoneAction = useCallback(() => {
    if (milestone?.actionRoute && onNavigate) {
      onNavigate(milestone.actionRoute);
    }
    if (milestone) {
      dismissTip(milestone.id);
      setMilestone(null);
    }
  }, [milestone, onNavigate, dismissTip]);

  const handleMilestoneDismiss = useCallback(() => {
    if (milestone) {
      dismissTip(milestone.id);
      setMilestone(null);
    }
  }, [milestone, dismissTip]);

  // Expose triggerTrustTip globally so other components can fire trust events
  useEffect(() => {
    (window as any).__stuardTrustCoach = triggerTrustTip;
    return () => { delete (window as any).__stuardTrustCoach; };
  }, [triggerTrustTip]);

  return (
    <>
      {/* Trust coaching banner — shows contextual trust tips */}
      <TrustCoachingBanner
        activeTip={activeTip}
        tipData={tipData}
        onDismiss={dismissTrust}
        onAction={handleTrustAction}
      />

      {/* Session milestone banner — shows once per session */}
      <AnimatePresence>
        {milestone && !activeTip && (
          <motion.div
            key={milestone.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] max-w-lg w-[90vw]"
          >
            <div className="bg-[#09090b] border border-white/10 rounded-xl p-3 shadow-2xl flex items-center gap-3 text-white">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4 text-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs">{milestone.message}</p>
              </div>
              {milestone.actionLabel && (
                <button
                  onClick={handleMilestoneAction}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 transition-colors"
                >
                  {milestone.actionLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={handleMilestoneDismiss}
                className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white/40" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Helper to trigger a trust coaching event from anywhere in the app.
 * Works whether or not the ContextualCoach is mounted.
 */
export function triggerTrustEvent(event: TrustEvent) {
  const fn = (window as any).__stuardTrustCoach;
  if (typeof fn === 'function') fn(event);
}
