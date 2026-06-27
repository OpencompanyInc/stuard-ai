-- Add agent_target column to sms_user_state for SMS routing control.
-- Allows users to choose whether SMS messages route to desktop, VM, or auto.
ALTER TABLE public.sms_user_state
  ADD COLUMN IF NOT EXISTS agent_target TEXT NOT NULL DEFAULT 'auto';

-- Add CHECK constraint (separate ALTER so IF NOT EXISTS on column works)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'sms_user_state_agent_target_check'
  ) THEN
    ALTER TABLE public.sms_user_state
      ADD CONSTRAINT sms_user_state_agent_target_check
      CHECK (agent_target IN ('desktop', 'vm', 'auto'));
  END IF;
END $$;
