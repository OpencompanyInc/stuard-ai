// Onboarding System Exports
export { OnboardingProvider, useOnboarding, useOnboardingArea } from './OnboardingContext';
export type { OnboardingPhase, FeatureArea, OnboardingStep, UserProgress } from './OnboardingContext';
export { DEFAULT_STEPS } from './OnboardingContext';

export { SmartTooltip, OnboardingTooltipContainer } from './SmartTooltip';
export { WelcomeFlow } from './WelcomeFlow';
export { 
  FeatureHighlight, 
  DiscoveryCard, 
  OnboardingComplete,
  TipBanner,
  OnboardingSettings
} from './FeatureComponents';

// Re-export for convenience
export { default as LegacyOnboardingFlow } from './OnboardingFlow';
