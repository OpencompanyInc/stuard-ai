// Onboarding System Exports
export { OnboardingProvider, useOnboarding, useOnboardingArea } from './OnboardingContext';
export type { OnboardingPhase, FeatureArea, OnboardingStep, UserProgress } from './OnboardingContext';
export { DEFAULT_STEPS } from './OnboardingContext';

export { SmartTooltip, OnboardingTooltipContainer } from './SmartTooltip';
export { WelcomeFlow } from './WelcomeFlow';
export { InteractiveWelcome } from './InteractiveWelcome';
export {
  FeatureHighlight,
  DiscoveryCard,
  OnboardingComplete,
  TipBanner,
  OnboardingSettings
} from './FeatureComponents';

// Discovery Engine
export { DiscoveryEngine, getDiscoveryEngine } from './DiscoveryEngine';
export type { DiscoveryTip, SuggestedPrompt as SuggestedPromptType, DiscoveryState, FeatureCategory, OnboardingPath } from './DiscoveryEngine';

// Discovery UI Components
export { SuggestedPrompts } from './SuggestedPrompts';
export { useTrustCoaching, TrustCoachingBanner } from './TrustCoaching';
export type { TrustEvent } from './TrustCoaching';

// First Session Coach (Layer 2)
export { FirstSessionCoach } from './FirstSessionCoach';
export { ChallengeCard } from './ChallengeCard';
export type { ChallengeStep } from './ChallengeCard';
export { CapabilityCards, CAPABILITIES } from './CapabilityCards';
export type { CapabilityItem } from './CapabilityCards';

// Contextual Coach (Layer 3)
export { ContextualCoach, triggerTrustEvent } from './ContextualCoach';

// Re-export for convenience
export { default as LegacyOnboardingFlow } from './OnboardingFlow';
