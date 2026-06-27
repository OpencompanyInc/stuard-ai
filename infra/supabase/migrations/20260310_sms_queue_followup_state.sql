-- Follow-up fixes for SMS queue delivery and conversation resume UX.
-- 1) Add explicit WITH CHECK policies so REST inserts/upserts work reliably.
-- 2) Preserve a resumable SMS conversation separate from the active thread.

ALTER TABLE public.sms_user_state
  ADD COLUMN IF NOT EXISTS resume_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS sms_user_state_user_policy ON public.sms_user_state;
CREATE POLICY sms_user_state_user_policy ON public.sms_user_state
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sms_user_state_service_policy ON public.sms_user_state;
CREATE POLICY sms_user_state_service_policy ON public.sms_user_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS sms_inbox_queue_user_policy ON public.sms_inbox_queue;
CREATE POLICY sms_inbox_queue_user_policy ON public.sms_inbox_queue
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sms_inbox_queue_service_policy ON public.sms_inbox_queue;
CREATE POLICY sms_inbox_queue_service_policy ON public.sms_inbox_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
