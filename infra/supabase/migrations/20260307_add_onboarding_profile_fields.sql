ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_path TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_profile JSONB,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE POLICY IF NOT EXISTS profiles_owner_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
