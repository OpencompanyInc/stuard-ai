-- Add proactive_message column so SMS replies to proactive check-ins have context.
ALTER TABLE public.sms_user_state
  ADD COLUMN IF NOT EXISTS proactive_message TEXT;
