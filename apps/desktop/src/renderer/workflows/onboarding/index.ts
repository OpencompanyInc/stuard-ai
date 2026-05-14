export {
  useWorkflowOnboarding,
  AI_TRACK_STEPS,
  MANUAL_TRACK_STEPS,
} from "./useWorkflowOnboarding";
export type {
  OnboardingPhase,
  OnboardingTrack,
  OnboardingStepId,
  UseWorkflowOnboardingResult,
} from "./useWorkflowOnboarding";

export {
  getOnboardingStepConfig,
  ONBOARDING_TARGET_IDS,
} from "./onboardingSteps";
export type { OnboardingStepConfig } from "./onboardingSteps";

export { WorkflowWelcomeScreen } from "./WorkflowWelcomeScreen";
export { WorkflowCoach } from "./WorkflowCoach";
export { WorkflowSpotlight } from "./WorkflowSpotlight";

export {
  buildDemoWorkflow,
  buildManualOnboardingWorkflow,
  getManualOnboardingValidation,
  MANUAL_ONBOARDING_NOTIFICATION_STEP_ID,
  MANUAL_ONBOARDING_SET_VARIABLE_STEP_ID,
  MANUAL_ONBOARDING_TIMESTAMP_STEP_ID,
  MANUAL_ONBOARDING_TRIGGER_ID,
  normalizeManualOnboardingWorkflow,
  runAiDemoSequence,
} from "./aiDemo";
