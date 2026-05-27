-- Keep chat history ordered by latest message activity, not original creation.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS message_count integer NOT NULL DEFAULT 0;

UPDATE public.conversations c
SET updated_at = COALESCE(latest.latest_message_at, c.updated_at, c.created_at),
    message_count = COALESCE(latest.message_count, c.message_count, 0)
FROM (
  SELECT conversation_id, MAX(created_at) AS latest_message_at, COUNT(*)::integer AS message_count
  FROM public.messages
  GROUP BY conversation_id
) latest
WHERE c.id = latest.conversation_id;

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated_at_desc
  ON public.conversations(user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.touch_conversation_activity_from_message()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.conversations
    SET updated_at = GREATEST(COALESCE(updated_at, created_at), NEW.created_at),
        message_count = COALESCE(message_count, 0) + 1
    WHERE id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.conversations
    SET message_count = GREATEST(COALESCE(message_count, 1) - 1, 0)
    WHERE id = OLD.conversation_id;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_touch_conversation_activity_from_message ON public.messages;

CREATE TRIGGER trigger_touch_conversation_activity_from_message
AFTER INSERT OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_activity_from_message();
