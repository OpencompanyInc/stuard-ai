-- Allow 'cloud' as a valid agent_target value for SMS routing.
-- Drop old constraint and recreate with 'cloud' included.
ALTER TABLE public.sms_user_state
  DROP CONSTRAINT IF EXISTS sms_user_state_agent_target_check;

ALTER TABLE public.sms_user_state
  ADD CONSTRAINT sms_user_state_agent_target_check
  CHECK (agent_target IN ('desktop', 'vm', 'auto', 'cloud'));
