export const ONBOARDING_PROFILE_STORAGE_KEY = 'stuard_pending_onboarding_profile';

export const ONBOARDING_PATH_OPTIONS = [
  {
    id: 'assistant',
    label: 'Assistant-first',
    description: 'Start with chat, memory, and everyday help around your device.',
  },
  {
    id: 'automation',
    label: 'Automation-first',
    description: 'Focus on workflows, mini apps, and repeated tasks you can delegate.',
  },
  {
    id: 'workspace',
    label: 'Workspace-first',
    description: 'Use spaces, notes, reminders, and planning surfaces to stay organized.',
  },
  {
    id: 'operator',
    label: 'Operator-first',
    description: 'Lean into proactive tasks, remote reach, and power-user control surfaces.',
  },
] as const;

export const ONBOARDING_ROLE_OPTIONS = [
  { id: 'founder', label: 'Founder' },
  { id: 'operator', label: 'Ops / Business' },
  { id: 'creator', label: 'Creator' },
  { id: 'developer', label: 'Developer' },
  { id: 'student', label: 'Student / Learner' },
] as const;

export const ONBOARDING_TECHNICAL_COMFORT_OPTIONS = [
  { id: 'non_technical', label: 'Non-technical' },
  { id: 'somewhat_technical', label: 'Somewhat technical' },
  { id: 'technical', label: 'Technical' },
] as const;

export const ONBOARDING_GOAL_OPTIONS = [
  { id: 'get_daily_help', label: 'Get everyday help' },
  { id: 'automate_repeated_work', label: 'Automate repeated work' },
  { id: 'organize_my_work', label: 'Organize notes, tasks, and research' },
  { id: 'build_tools', label: 'Build tools and workflows' },
] as const;

export type OnboardingPath = typeof ONBOARDING_PATH_OPTIONS[number]['id'];
export type OnboardingRole = typeof ONBOARDING_ROLE_OPTIONS[number]['id'];
export type OnboardingTechnicalComfort = typeof ONBOARDING_TECHNICAL_COMFORT_OPTIONS[number]['id'];
export type OnboardingGoal = typeof ONBOARDING_GOAL_OPTIONS[number]['id'];
export type OnboardingSource = 'website_signup' | 'website_google' | 'desktop';

export interface OnboardingProfile {
  path: OnboardingPath;
  role: OnboardingRole;
  technicalComfort: OnboardingTechnicalComfort;
  primaryGoal: OnboardingGoal;
  source?: OnboardingSource;
  updatedAt?: string;
}

export const DEFAULT_ONBOARDING_PROFILE: OnboardingProfile = {
  path: 'assistant',
  role: 'operator',
  technicalComfort: 'somewhat_technical',
  primaryGoal: 'get_daily_help',
  source: 'website_signup',
};

export function isOnboardingPath(value: unknown): value is OnboardingPath {
  return ONBOARDING_PATH_OPTIONS.some((option) => option.id === value);
}

export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return ONBOARDING_ROLE_OPTIONS.some((option) => option.id === value);
}

export function isOnboardingTechnicalComfort(value: unknown): value is OnboardingTechnicalComfort {
  return ONBOARDING_TECHNICAL_COMFORT_OPTIONS.some((option) => option.id === value);
}

export function isOnboardingGoal(value: unknown): value is OnboardingGoal {
  return ONBOARDING_GOAL_OPTIONS.some((option) => option.id === value);
}

export function normalizeOnboardingProfile(value: unknown): OnboardingProfile | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  if (!isOnboardingPath(candidate.path)) return null;
  if (!isOnboardingRole(candidate.role)) return null;
  if (!isOnboardingTechnicalComfort(candidate.technicalComfort)) return null;
  if (!isOnboardingGoal(candidate.primaryGoal)) return null;

  return {
    path: candidate.path,
    role: candidate.role,
    technicalComfort: candidate.technicalComfort,
    primaryGoal: candidate.primaryGoal,
    source: candidate.source === 'website_signup' || candidate.source === 'website_google' || candidate.source === 'desktop'
      ? candidate.source
      : undefined,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
  };
}

export function toOnboardingProfileRow(profile: OnboardingProfile) {
  const normalized = normalizeOnboardingProfile(profile);
  if (!normalized) return null;

  const timestamp = normalized.updatedAt || new Date().toISOString();

  return {
    onboarding_path: normalized.path,
    onboarding_profile: {
      ...normalized,
      updatedAt: timestamp,
    },
    onboarding_completed_at: timestamp,
  };
}
