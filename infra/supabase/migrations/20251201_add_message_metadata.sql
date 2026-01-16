-- Add metadata column to messages table for storing reasoning, tools, and stream chunks
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN public.messages.metadata IS 'Stores additional message data: reasoning, toolCalls, streamChunks for interleaved display';
