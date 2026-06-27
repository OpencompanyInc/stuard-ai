import { createClient } from '@supabase/supabase-js';

const CATEGORIES = [
  'productivity', 'automation', 'data', 'integration',
  'ai', 'media', 'developer', 'communication', 'general'
];

// Sitemap protocol caps a single file at 50,000 URLs. Stay well under that
// to leave headroom for static + category URLs.
const SITEMAP_WORKFLOW_LIMIT = 45000;

interface WorkflowSummary {
  slug: string;
  updated_at?: string;
  created_at: string;
}

async function fetchMarketplaceWorkflows(): Promise<WorkflowSummary[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      const { data, error } = await supabase
        .from('marketplace_workflows')
        .select('slug, updated_at, created_at')
        .eq('status', 'published')
        .order('updated_at', { ascending: false })
        .limit(SITEMAP_WORKFLOW_LIMIT);
      if (!error && data) {
        return data as WorkflowSummary[];
      }
    } catch {
      // fall through to API fallback
    }
  }

  // Fallback: paginate the search API (server hard-caps limit at 50 per page).
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
  const PAGE_SIZE = 50;
  const collected: WorkflowSummary[] = [];
  try {
    for (let offset = 0; offset < SITEMAP_WORKFLOW_LIMIT; offset += PAGE_SIZE) {
      const res = await fetch(`${baseUrl}/v1/marketplace/search?limit=${PAGE_SIZE}&offset=${offset}`, {
        next: { revalidate: 3600 },
      });
      if (!res.ok) break;
      const data = await res.json();
      const page: WorkflowSummary[] = data.results || [];
      if (page.length === 0) break;
      collected.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch {
    // return whatever we managed to collect
  }
  return collected;
}

export async function GET() {
  const baseUrl = 'https://stuard.ai';
  const currentDate = new Date().toISOString();

  // Static pages
  const staticUrls = [
    {
      loc: baseUrl,
      lastmod: currentDate,
      changefreq: 'daily',
      priority: '1.0',
    },
    {
      loc: `${baseUrl}/pricing`,
      lastmod: currentDate,
      changefreq: 'weekly',
      priority: '0.9',
    },
    {
      loc: `${baseUrl}/features`,
      lastmod: currentDate,
      changefreq: 'weekly',
      priority: '0.8',
    },
    {
      loc: `${baseUrl}/download`,
      lastmod: currentDate,
      changefreq: 'weekly',
      priority: '0.7',
    },
    {
      loc: `${baseUrl}/marketplace`,
      lastmod: currentDate,
      changefreq: 'daily',
      priority: '0.85',
    },
    {
      loc: `${baseUrl}/blog`,
      lastmod: currentDate,
      changefreq: 'daily',
      priority: '0.6',
    },
    {
      loc: `${baseUrl}/terms`,
      lastmod: currentDate,
      changefreq: 'monthly',
      priority: '0.5',
    },
    {
      loc: `${baseUrl}/privacy`,
      lastmod: currentDate,
      changefreq: 'monthly',
      priority: '0.5',
    },
  ];

  // Marketplace category pages
  const categoryUrls = CATEGORIES.map(cat => ({
    loc: `${baseUrl}/marketplace?category=${cat}`,
    lastmod: currentDate,
    changefreq: 'daily',
    priority: '0.7',
  }));

  // Dynamic workflow pages from marketplace
  const workflows = await fetchMarketplaceWorkflows();
  const workflowUrls = workflows.map(w => ({
    loc: `${baseUrl}/marketplace/${w.slug}`,
    lastmod: w.updated_at || w.created_at || currentDate,
    changefreq: 'weekly',
    priority: '0.6',
  }));

  const allUrls = [...staticUrls, ...categoryUrls, ...workflowUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    allUrls.map((u) => (
      `  <url>\n` +
      `    <loc>${u.loc}</loc>\n` +
      `    <lastmod>${u.lastmod}</lastmod>\n` +
      `    <changefreq>${u.changefreq}</changefreq>\n` +
      `    <priority>${u.priority}</priority>\n` +
      `  </url>`
    )).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}


