const CATEGORIES = [
  'productivity', 'automation', 'data', 'integration', 
  'ai', 'media', 'developer', 'communication', 'general'
];

interface WorkflowSummary {
  slug: string;
  updated_at?: string;
  created_at: string;
}

async function fetchMarketplaceWorkflows(): Promise<WorkflowSummary[]> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
  try {
    const res = await fetch(`${baseUrl}/v1/marketplace/search?limit=100`, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
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


