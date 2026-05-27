import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

interface Workflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  spec: any;
  category: string;
  tags: string[];
  icon?: string;
  rating_avg: number;
  rating_count: number;
  download_count: number;
  publisher_name: string;
  created_at: string;
  published_at: string;
}

const CATEGORIES: Record<string, { name: string; icon: string }> = {
  productivity: { name: 'Productivity', icon: '📋' },
  automation: { name: 'Automation', icon: '⚙️' },
  data: { name: 'Data Processing', icon: '📊' },
  integration: { name: 'Integrations', icon: '🔗' },
  ai: { name: 'AI & ML', icon: '🤖' },
  media: { name: 'Media', icon: '🎬' },
  developer: { name: 'Developer', icon: '💻' },
  communication: { name: 'Communication', icon: '💬' },
  general: { name: 'General', icon: '📦' },
};

async function getWorkflow(slug: string): Promise<Workflow | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('marketplace_workflows')
      .select('id, slug, name, description, version, spec, category, tags, icon, rating_avg, rating_count, download_count, publisher_name, created_at, published_at')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (!error && data) {
      return data as Workflow;
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
  try {
    const res = await fetch(`${baseUrl}/v1/marketplace/workflow/${slug}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.workflow || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params;
  const workflow = await getWorkflow(slug);

  if (!workflow) {
    return {
      title: 'Workflow Not Found',
      description: 'This workflow could not be found in the Stuard AI Marketplace.',
    };
  }

  const categoryInfo = CATEGORIES[workflow.category] || CATEGORIES.general;
  const title = `Download ${workflow.name} - Free ${categoryInfo.name} Published Workflow | Stuard AI`;
  const description = `Download Stuard AI to install ${workflow.name}. A free published workflow for ${categoryInfo.name}. ` + (workflow.description.length > 100
    ? workflow.description.slice(0, 97) + '...'
    : workflow.description);

  return {
    title,
    description,
    keywords: [
      'published workflow',
      'download stuard ai',
      'marketplace',
      workflow.name,
      `${workflow.category} automation`,
      'workflow template',
      'Stuard AI workflow',
      'free automation',
      ...workflow.tags,
    ],
    openGraph: {
      title: `${workflow.name} | Stuard AI Marketplace`,
      description,
      type: 'article',
      url: `https://stuard.ai/marketplace/${workflow.slug}`,
      publishedTime: workflow.published_at,
      authors: [workflow.publisher_name],
      tags: workflow.tags,
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: `${workflow.name} on Stuard AI`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: workflow.name,
      description,
      images: ['/og-image.png'],
    },
    alternates: {
      canonical: `https://stuard.ai/marketplace/${workflow.slug}`,
    },
    other: {
      'article:author': workflow.publisher_name,
      'article:published_time': workflow.published_at,
    },
  };
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating - fullStars >= 0.5;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        {[...Array(5)].map((_, i) => (
          <span key={i} className={`text-lg ${i < fullStars ? 'text-yellow-400' : (i === fullStars && hasHalfStar) ? 'text-yellow-400' : 'text-gray-300'}`}>
            ★
          </span>
        ))}
      </div>
      <span className="text-sm text-gray-600">
        {rating.toFixed(1)} ({count} {count === 1 ? 'review' : 'reviews'})
      </span>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function WorkflowDetailPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params;
  const workflow = await getWorkflow(slug);

  if (!workflow) {
    notFound();
  }

  const categoryInfo = CATEGORIES[workflow.category] || CATEGORIES.general;

  // JSON-LD for SEO
  const workflowSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: workflow.name,
    description: workflow.description,
    applicationCategory: 'AutomationApplication',
    operatingSystem: 'Windows, macOS, Linux',
    softwareVersion: workflow.version,
    datePublished: workflow.published_at,
    author: {
      '@type': 'Person',
      name: workflow.publisher_name,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    aggregateRating: workflow.rating_count > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: workflow.rating_avg.toFixed(1),
      ratingCount: workflow.rating_count,
      bestRating: '5',
      worstRating: '1',
    } : undefined,
    downloadUrl: `https://stuard.ai/marketplace/${workflow.slug}`,
    keywords: workflow.tags.join(', '),
  };

  // Breadcrumb schema
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://stuard.ai',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Marketplace',
        item: 'https://stuard.ai/marketplace',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: categoryInfo.name,
        item: `https://stuard.ai/marketplace?category=${workflow.category}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: workflow.name,
        item: `https://stuard.ai/marketplace/${workflow.slug}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(workflowSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        {/* Breadcrumb */}
        <nav className="py-4 px-4 border-b border-gray-200 bg-white">
          <div className="max-w-4xl mx-auto">
            <ol className="flex items-center gap-2 text-sm text-gray-600">
              <li><Link href="/" className="hover:text-blue-600">Home</Link></li>
              <li>/</li>
              <li><Link href="/marketplace" className="hover:text-blue-600">Marketplace</Link></li>
              <li>/</li>
              <li>
                <Link href={`/marketplace?category=${workflow.category}`} className="hover:text-blue-600">
                  {categoryInfo.name}
                </Link>
              </li>
              <li>/</li>
              <li className="text-gray-900 font-medium truncate max-w-[200px]">{workflow.name}</li>
            </ol>
          </div>
        </nav>

        {/* Main Content */}
        <main className="py-12 px-4">
          <div className="max-w-4xl mx-auto">
            <article>
              {/* Header */}
              <header className="mb-8">
                <div className="flex items-start gap-6">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center text-4xl flex-shrink-0 shadow-sm">
                    {workflow.icon || categoryInfo.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                        {categoryInfo.icon} {categoryInfo.name}
                      </span>
                      <span className="text-gray-400 text-sm">v{workflow.version}</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
                      {workflow.name}
                    </h1>
                    <p className="text-lg text-gray-600 leading-relaxed">
                      {workflow.description}
                    </p>
                  </div>
                </div>
              </header>

              {/* Stats Bar */}
              <div className="flex flex-wrap items-center gap-6 py-4 border-y border-gray-200 mb-8">
                {workflow.rating_count > 0 && (
                  <StarRating rating={workflow.rating_avg} count={workflow.rating_count} />
                )}
                <div className="flex items-center gap-2 text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>{workflow.download_count} downloads</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>by {workflow.publisher_name}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Published {formatDate(workflow.published_at)}</span>
                </div>
              </div>

              {/* Tags */}
              {workflow.tags?.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">Tags</h2>
                  <div className="flex flex-wrap gap-2">
                    {workflow.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/marketplace?q=${encodeURIComponent(tag)}`}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-full transition-colors"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA Section */}
              <section className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white mb-12">
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-3">Get this workflow</h2>
                  <p className="text-blue-100 mb-6 max-w-md mx-auto">
                    Install Stuard AI on your desktop and add this workflow with one click.
                    It&apos;s free!
                  </p>
                  <div className="flex flex-wrap justify-center gap-4">
                    <Link
                      href="/download"
                      className="inline-flex items-center gap-2 px-8 py-4 bg-white text-blue-600 rounded-xl hover:bg-blue-50 transition-colors font-semibold text-lg"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download Stuard AI
                    </Link>
                  </div>
                  <p className="text-blue-200 text-sm mt-4">
                    Free for Windows, macOS, and Linux
                  </p>
                </div>
              </section>

              {/* How It Works */}
              <section className="mb-12">
                <h2 className="text-xl font-bold text-gray-900 mb-6">How to install this workflow</h2>
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold flex-shrink-0">
                      1
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Download Stuard AI</h3>
                      <p className="text-sm text-gray-600">
                        Install the free desktop app on Windows, macOS, or Linux.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold flex-shrink-0">
                      2
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Browse Marketplace</h3>
                      <p className="text-sm text-gray-600">
                        Open the Workflows tab and find this workflow in the marketplace.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold flex-shrink-0">
                      3
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">One-Click Install</h3>
                      <p className="text-sm text-gray-600">
                        Click &quot;Install&quot; and the workflow is ready to run locally.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Related Workflows */}
              <section className="border-t border-gray-200 pt-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">
                    More {categoryInfo.name} Workflows
                  </h2>
                  <Link
                    href={`/marketplace?category=${workflow.category}`}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    View all →
                  </Link>
                </div>
                <p className="text-gray-600">
                  Explore more workflows in the{' '}
                  <Link href={`/marketplace?category=${workflow.category}`} className="text-blue-600 hover:underline">
                    {categoryInfo.name} category
                  </Link>
                  {' '}or browse the{' '}
                  <Link href="/marketplace" className="text-blue-600 hover:underline">
                    full marketplace
                  </Link>.
                </p>
              </section>
            </article>
          </div>
        </main>
      </div>
    </>
  );
}
