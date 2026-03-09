'use client';

import type { OnboardingGoal, OnboardingPath, OnboardingProfile, OnboardingRole, OnboardingTechnicalComfort } from '../../../../../shared/onboardingProfile';
import {
  ONBOARDING_GOAL_OPTIONS,
  ONBOARDING_PATH_OPTIONS,
  ONBOARDING_ROLE_OPTIONS,
  ONBOARDING_TECHNICAL_COMFORT_OPTIONS,
} from '../../../../../shared/onboardingProfile';

interface SignupOnboardingQuizProps {
  value: OnboardingProfile;
  onChange: (nextValue: OnboardingProfile) => void;
}

export function SignupOnboardingQuiz({ value, onChange }: SignupOnboardingQuizProps) {
  const updateField = <K extends keyof OnboardingProfile>(field: K, nextValue: OnboardingProfile[K]) => {
    onChange({
      ...value,
      [field]: nextValue,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/90 p-4 sm:p-5 space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">Shape your first experience</p>
        <h3 className="text-lg font-semibold text-gray-900 mt-1">Pick how Stuard should start helping</h3>
        <p className="text-sm text-gray-600 mt-1">This only personalizes your first suggestions. You’ll still have access to everything.</p>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-medium text-gray-900">Starting path</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {ONBOARDING_PATH_OPTIONS.map((option) => {
            const active = value.path === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateField('path', option.id as OnboardingPath)}
                className={`rounded-2xl border p-3 text-left transition-all ${active
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-gray-900'}`}>{option.label}</p>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{option.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-medium text-gray-900">What best describes you?</p>
        <div className="flex flex-wrap gap-2">
          {ONBOARDING_ROLE_OPTIONS.map((option) => {
            const active = value.role === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateField('role', option.id as OnboardingRole)}
                className={`rounded-full px-3 py-2 text-sm transition-colors ${active
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-medium text-gray-900">How technical are you?</p>
        <div className="flex flex-wrap gap-2">
          {ONBOARDING_TECHNICAL_COMFORT_OPTIONS.map((option) => {
            const active = value.technicalComfort === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateField('technicalComfort', option.id as OnboardingTechnicalComfort)}
                className={`rounded-full px-3 py-2 text-sm transition-colors ${active
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-medium text-gray-900">What do you want first?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ONBOARDING_GOAL_OPTIONS.map((option) => {
            const active = value.primaryGoal === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateField('primaryGoal', option.id as OnboardingGoal)}
                className={`rounded-xl px-3 py-2.5 text-sm text-left transition-colors ${active
                  ? 'bg-blue-50 border border-blue-200 text-blue-900'
                  : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
