-- Add title column to conversations table for display in history
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS title text;

-- Add index for faster title searches
CREATE INDEX IF NOT EXISTS conversations_title_idx ON public.conversations (title);
