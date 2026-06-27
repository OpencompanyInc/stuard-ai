export const ONBOARDING_PATH_OPTIONS = [
  'assistant',
  'automation',
  'workspace',
  'operator',
] as const;

export type OnboardingPath = typeof ONBOARDING_PATH_OPTIONS[number];

export function isOnboardingPath(value: unknown): value is OnboardingPath {
  return typeof value === 'string' && ONBOARDING_PATH_OPTIONS.includes(value as OnboardingPath);
}
