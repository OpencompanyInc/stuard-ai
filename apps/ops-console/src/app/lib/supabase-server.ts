import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const OPS_TOKEN = process.env.OPS_ACCESS_TOKEN || '';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  return supabase;
}

/** Verify the bearer token matches the local OPS_ACCESS_TOKEN */
export function verifyOpsToken(req: Request): boolean {
  if (!OPS_TOKEN) return false;
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  return auth.slice(7) === OPS_TOKEN;
}
