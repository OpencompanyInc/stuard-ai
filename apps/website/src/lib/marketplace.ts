import { createClient } from '@supabase/supabase-js';

export interface Workflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon?: string | null;
  rating_avg: number;
  rating_count: number;
  download_count: number;
  publisher_name: string;
  created_at: string;
}

const SELECT_COLS =
  'id, slug, name, description, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at';

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !anon) return null;
  return createClient(url, anon, { auth: { persistSession: false } });
}

/**
 * Search/browse listing used by the /marketplace page. Supabase first, with the
 * cloud API as a fallback. Ordered by most-downloaded.
 */
export async function getWorkflows(category?: string, query?: string): Promise<Workflow[]> {
  const supabase = client();
  if (supabase) {
    let qb = supabase
      .from('marketplace_workflows')
      .select(SELECT_COLS)
      .eq('status', 'published')
      .order('download_count', { ascending: false })
      .limit(50);

    if (category) qb = qb.eq('category', category);
    if (query) {
      const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
      qb = qb.or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data, error } = await qb;
    if (!error && data) return data as Workflow[];
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (query) params.set('q', query);
  params.set('limit', '50');
  try {
    const res = await fetch(`${baseUrl}/v1/marketplace/search?${params.toString()}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

/**
 * Top published mini-apps by real traction — most downloaded first, then best
 * rated. Used by the landing page's marketplace showcase.
 */
export async function getTopWorkflows(limit = 6): Promise<Workflow[]> {
  const supabase = client();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('marketplace_workflows')
    .select(SELECT_COLS)
    .eq('status', 'published')
    .order('download_count', { ascending: false })
    .order('rating_avg', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as Workflow[];
}
