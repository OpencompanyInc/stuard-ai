# Waitlist Setup Guide for Stuard AI

This guide will help you set up the waitlist functionality for your Stuard AI website.

## Prerequisites

- Supabase project already set up
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables configured

## Step 1: Create the Waitlist Table

Run this SQL in your Supabase SQL Editor:

```sql
-- Create waitlist table
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  company TEXT,
  use_case TEXT,
  referral_source TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notified BOOLEAN DEFAULT FALSE,
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON public.waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON public.waitlist(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_position ON public.waitlist(position);

-- Enable Row Level Security
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (join waitlist)
CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist
  FOR INSERT
  WITH CHECK (true);

-- Only allow users to read their own data
CREATE POLICY "Users can read own waitlist entry"
  ON public.waitlist
  FOR SELECT
  USING (auth.email() = email);

-- Add comment
COMMENT ON TABLE public.waitlist IS 'Waitlist signups for early access to Stuard AI';
```

## Step 2: Environment Variables

Make sure your `.env.local` file contains:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Step 3: Test the Waitlist

1. Start your development server: `npm run dev`
2. Navigate to `http://localhost:3000`
3. Try joining the waitlist with your email
4. Check your Supabase dashboard to verify the entry was created

## Step 4: Email Notifications (Optional)

To send confirmation emails to users who join the waitlist, you can:

1. Set up email templates in Supabase Auth
2. Use a service like SendGrid or Resend
3. Create a database trigger or use Supabase Edge Functions

Example with Supabase Edge Functions:

```typescript
// supabase/functions/waitlist-confirmation/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const { email, position } = await req.json()
  
  // Send email using your preferred service
  // Example: SendGrid, Resend, etc.
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

## Monitoring & Analytics

### View Waitlist Statistics

Run these queries in Supabase SQL Editor:

```sql
-- Total signups
SELECT COUNT(*) as total_signups FROM public.waitlist;

-- Signups by day
SELECT 
  DATE(created_at) as signup_date,
  COUNT(*) as signups
FROM public.waitlist
GROUP BY DATE(created_at)
ORDER BY signup_date DESC;

-- Top use cases
SELECT 
  use_case,
  COUNT(*) as count
FROM public.waitlist
WHERE use_case IS NOT NULL
GROUP BY use_case
ORDER BY count DESC;
```

## Exporting Waitlist Data

```sql
-- Export all waitlist data
SELECT 
  email,
  name,
  company,
  use_case,
  position,
  created_at
FROM public.waitlist
ORDER BY position;
```

## Security Best Practices

1. **Never expose your service role key** - Keep it in `.env.local` and never commit it
2. **Use Row Level Security** - The policies above ensure users can only read their own data
3. **Validate emails server-side** - The API route includes validation
4. **Rate limiting** - Consider adding rate limiting to prevent abuse

## Troubleshooting

### "Unauthorized" Error

- Check that your environment variables are set correctly
- Verify your service role key has the correct permissions

### Duplicate Email Error

- This is expected behavior - users can only join once
- The error is handled gracefully in the UI

### Position Not Incrementing

- Check that the position is being set correctly in the API route
- Verify the count query is working properly

## Next Steps

1. ✅ Set up the database table
2. ✅ Test the waitlist functionality
3. 📧 Set up email confirmations (optional)
4. 📊 Monitor signups and analytics
5. 🚀 Launch and promote your waitlist!

## Support

If you need help, check:
- [Supabase Documentation](https://supabase.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- Email: support@stuard.ai

