-- Feedback table for bug reports and feature requests
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')),
  labels TEXT[] DEFAULT '{}',
  screenshots JSONB DEFAULT '[]', -- Array of {url: string, caption?: string}
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'wont_fix')),
  metadata JSONB DEFAULT '{}', -- Additional context (app version, OS, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by user
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- Index for querying by type and status
CREATE INDEX IF NOT EXISTS idx_feedback_type_status ON feedback(type, status);

-- Index for querying by severity (for bugs)
CREATE INDEX IF NOT EXISTS idx_feedback_severity ON feedback(severity) WHERE type = 'bug';

-- RLS policies
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback" ON feedback
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert feedback
CREATE POLICY "Users can insert feedback" ON feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for admin dashboard)
CREATE POLICY "Service role full access" ON feedback
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();

-- Comments table for feedback threads
CREATE TABLE IF NOT EXISTS feedback_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id ON feedback_comments(feedback_id);

ALTER TABLE feedback_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments on their feedback" ON feedback_comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM feedback WHERE feedback.id = feedback_comments.feedback_id AND feedback.user_id = auth.uid())
  );

CREATE POLICY "Users can add comments to their feedback" ON feedback_comments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM feedback WHERE feedback.id = feedback_comments.feedback_id AND feedback.user_id = auth.uid())
    AND auth.uid() = user_id
  );

CREATE POLICY "Service role full access comments" ON feedback_comments
  FOR ALL USING (auth.role() = 'service_role');
