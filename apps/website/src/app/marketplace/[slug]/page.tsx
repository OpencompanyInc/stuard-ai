import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import {
  ListChecks,
  Workflow as WorkflowIcon,
  BarChart3,
  Plug,
  Bot,
  Clapperboard,
  Code2,
  MessageSquare,
  Boxes,
  Download,
  User,
  Calendar,
  type LucideIcon,
} from 'lucide-react';

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

const CATEGORIES: Record<string, { name: string; icon: string; Icon: LucideIcon }> = {
  productivity: { name: 'Productivity', icon: '📋', Icon: ListChecks },
  automation: { name: 'Automation', icon: '⚙️', Icon: WorkflowIcon },
  data: { name: 'Data Processing', icon: '📊', Icon: BarChart3 },
  integration: { name: 'Integrations', icon: '🔗', Icon: Plug },
  ai: { name: 'AI & ML', icon: '🤖', Icon: Bot },
  media: { name: 'Media', icon: '🎬', Icon: Clapperboard },
  developer: { name: 'Developer', icon: '💻', Icon: Code2 },
  communication: { name: 'Communication', icon: '💬', Icon: MessageSquare },
  general: { name: 'General', icon: '📦', Icon: Boxes },
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
          <span
            key={i}
            className={`text-lg ${
              i < fullStars || (i === fullStars && hasHalfStar) ? 'text-[#FFB020]' : 'text-[#3A3A3A]'
            }`}
          >
            ★
          </span>
        ))}
      </div>
      <span className="text-sm text-[#A3A3A3]">
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
  const CategoryIcon = categoryInfo.Icon;

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

      <div className="min-h-screen bg-[#0A0A0B] text-white">
        {/* Breadcrumb */}
        <nav className="border-b border-white/10 px-4 pb-4 pt-28">
          <div className="mx-auto max-w-4xl">
            <ol className="flex items-center gap-2 text-sm text-[#A3A3A3]">
              <li><Link href="/" className="hover:text-[#FF6B6E]">Home</Link></li>
              <li className="text-[#525252]">/</li>
              <li><Link href="/marketplace" className="hover:text-[#FF6B6E]">Marketplace</Link></li>
              <li className="text-[#525252]">/</li>
              <li>
                <Link href={`/marketplace?category=${workflow.category}`} className="hover:text-[#FF6B6E]">
                  {categoryInfo.name}
                </Link>
              </li>
              <li className="text-[#525252]">/</li>
              <li className="max-w-[200px] truncate font-medium text-white">{workflow.name}</li>
            </ol>
          </div>
        </nav>

        {/* Main Content */}
        <main className="px-4 py-12">
          <div className="mx-auto max-w-4xl">
            <article>
              {/* Header */}
              <header className="mb-8">
                <div className="flex items-start gap-6">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-[#FF383C]/20 bg-[#FF383C]/10 text-[#FF6B6E]">
                    <CategoryIcon className="h-9 w-9" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FF383C]/20 bg-[#FF383C]/10 px-2.5 py-1 text-xs font-medium text-[#FF6B6E]">
                        <CategoryIcon className="h-3.5 w-3.5" strokeWidth={2} /> {categoryInfo.name}
                      </span>
                      <span className="text-sm text-[#737373]">v{workflow.version}</span>
                    </div>
                    <h1 className="mb-3 text-3xl font-medium text-white md:text-4xl">
                      {workflow.name}
                    </h1>
                    <p className="text-lg leading-relaxed text-[#A3A3A3]">
                      {workflow.description}
                    </p>
                  </div>
                </div>
              </header>

              {/* Stats Bar */}
              <div className="mb-8 flex flex-wrap items-center gap-6 border-y border-white/10 py-4">
                {workflow.rating_count > 0 && (
                  <StarRating rating={workflow.rating_avg} count={workflow.rating_count} />
                )}
                <div className="flex items-center gap-2 text-[#A3A3A3]">
                  <Download className="h-5 w-5" strokeWidth={2} />
                  <span>{workflow.download_count} downloads</span>
                </div>
                <div className="flex items-center gap-2 text-[#A3A3A3]">
                  <User className="h-5 w-5" strokeWidth={2} />
                  <span>by {workflow.publisher_name}</span>
                </div>
                <div className="flex items-center gap-2 text-[#A3A3A3]">
                  <Calendar className="h-5 w-5" strokeWidth={2} />
                  <span>Published {formatDate(workflow.published_at)}</span>
                </div>
              </div>

              {/* Tags */}
              {workflow.tags?.length > 0 && (
                <div className="mb-8">
                  <h2 className="mb-3 text-sm font-semibold text-[#D4D4D4]">Tags</h2>
                  <div className="flex flex-wrap gap-2">
                    {workflow.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/marketplace?q=${encodeURIComponent(tag)}`}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-[#D4D4D4] transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA Section */}
              <section className="mb-12 rounded-2xl bg-gradient-to-r from-[#FF383C] to-[#D31519] p-8 text-white">
                <div className="text-center">
                  <h2 className="mb-3 text-2xl font-bold">Get this workflow</h2>
                  <p className="mx-auto mb-6 max-w-md text-white/85">
                    Install Stuard AI on your desktop and add this workflow with one click.
                    It&apos;s free!
                  </p>
                  <div className="flex flex-wrap justify-center gap-4">
                    <Link
                      href="/download"
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-[#0A0A0B] transition-colors hover:bg-white/90"
                    >
                      <Download className="h-6 w-6" strokeWidth={2} />
                      Download Stuard AI
                    </Link>
                  </div>
                  <p className="mt-4 text-sm text-white/75">
                    Free for Windows, macOS, and Linux
                  </p>
                </div>
              </section>

              {/* How It Works */}
              <section className="mb-12">
                <h2 className="mb-6 text-xl font-semibold text-white">How to install this workflow</h2>
                <div className="grid gap-6 md:grid-cols-3">
                  {[
                    { n: 1, title: 'Download Stuard AI', desc: 'Install the free desktop app on Windows, macOS, or Linux.' },
                    { n: 2, title: 'Browse Marketplace', desc: 'Open the Workflows tab and find this workflow in the marketplace.' },
                    { n: 3, title: 'One-Click Install', desc: 'Click "Install" and the workflow is ready to run locally.' },
                  ].map((step) => (
                    <div key={step.n} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#FF383C]/20 bg-[#FF383C]/10 font-bold text-[#FF6B6E]">
                        {step.n}
                      </div>
                      <div>
                        <h3 className="mb-1 font-semibold text-white">{step.title}</h3>
                        <p className="text-sm text-[#A3A3A3]">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Related Workflows */}
              <section className="border-t border-white/10 pt-8">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-white">
                    More {categoryInfo.name} Workflows
                  </h2>
                  <Link
                    href={`/marketplace?category=${workflow.category}`}
                    className="text-sm font-medium text-[#FF6B6E] hover:text-[#FF383C]"
                  >
                    View all →
                  </Link>
                </div>
                <p className="text-[#A3A3A3]">
                  Explore more workflows in the{' '}
                  <Link href={`/marketplace?category=${workflow.category}`} className="text-[#FF6B6E] hover:underline">
                    {categoryInfo.name} category
                  </Link>
                  {' '}or browse the{' '}
                  <Link href="/marketplace" className="text-[#FF6B6E] hover:underline">
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
