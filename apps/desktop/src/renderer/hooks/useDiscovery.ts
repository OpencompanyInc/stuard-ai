import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getDiscoveryEngine,
  type DiscoveryEngine,
  type DiscoveryTip,
  type DiscoveryState,
  type SuggestedPrompt,
  type OnboardingPath,
  type FeatureCategory,
} from '../components/onboarding/DiscoveryEngine';

/**
 * React hook wrapping the DiscoveryEngine singleton.
 * Provides reactive access to tips, prompts, and feature tracking.
 */
export function useDiscovery() {
  const engine = useMemo(() => getDiscoveryEngine(), []);

  // Subscribe to engine state changes for reactivity
  const state = useSyncExternalStore(
    useCallback((cb: () => void) => engine.subscribe(cb), [engine]),
    useCallback(() => engine.getState(), [engine]),
  );

  // --- Tips ---

  const getNextTip = useCallback(
    (context?: { currentArea?: string; isThinking?: boolean; isIdle?: boolean; isEmptyState?: boolean }) =>
      engine.getNextTip(context),
    [engine],
  );

  const getTipsForCarousel = useCallback(
    (count?: number, context?: { currentArea?: string }) =>
      engine.getTipsForCarousel(count, context),
    [engine],
  );

  const markTipSeen = useCallback(
    (tipId: string) => engine.markTipSeen(tipId),
    [engine],
  );

  const dismissTip = useCallback(
    (tipId: string) => engine.dismissTip(tipId),
    [engine],
  );

  // --- Prompts ---

  const getSuggestedPrompts = useCallback(
    (count?: number) => engine.getSuggestedPrompts(count),
    [engine],
  );

  const markPromptUsed = useCallback(
    (promptId: string) => engine.markPromptUsed(promptId),
    [engine],
  );

  // --- Features ---

  const markFeatureExperienced = useCallback(
    (feature: string) => engine.markFeatureExperienced(feature),
    [engine],
  );

  const isFeatureExperienced = useCallback(
    (feature: string) => engine.isFeatureExperienced(feature),
    [engine],
  );

  const getUnexploredFeatures = useCallback(
    () => engine.getUnexploredFeatures(),
    [engine],
  );

  // --- Path ---

  const setPath = useCallback(
    (path: OnboardingPath) => engine.setPath(path),
    [engine],
  );

  // --- Session milestones ---

  const getSessionMilestone = useCallback(
    () => engine.getSessionMilestone(),
    [engine],
  );

  const sessionCount = state.sessionCount;
  const selectedPath = state.selectedPath;
  const featuresExperienced = state.featuresExperienced;

  return {
    // State
    sessionCount,
    selectedPath,
    featuresExperienced,

    // Tips
    getNextTip,
    getTipsForCarousel,
    markTipSeen,
    dismissTip,

    // Prompts
    getSuggestedPrompts,
    markPromptUsed,

    // Features
    markFeatureExperienced,
    isFeatureExperienced,
    getUnexploredFeatures,

    // Path
    setPath,

    // Milestones
    getSessionMilestone,

    // Engine (for advanced use)
    engine,
  };
}
