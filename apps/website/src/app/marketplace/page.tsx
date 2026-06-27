import { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, createElement } from 'react';
import {
  ListChecks,
  Workflow as WorkflowIcon,
  BarChart3,
  Plug,
  Bot,
  Clapperboard,
  Code2,
  MessageSquare,
  SquareFunction,
  GraduationCap,
  Boxes,
  Package,
  Star,
  Download,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { getWorkflows, type Workflow } from '@/lib/marketplace';

export const metadata: Metadata = {
  title: 'Workflow Marketplace - Download Stuard AI & Published Workflows',
  description: 'Download Stuard AI and discover free published workflows, automation templates, and AI tools built by the community. One-click install to your desktop.',
  keywords: [
    'published workflow',
    'download stuard ai',
    'workflow marketplace',
    'automation templates',
    'AI workflows',
    'free automation',
    'workflow templates',
    'n8n templates',
    'Zapier alternatives',
    'automation library',
    'AI tools',
    'productivity workflows',
    'desktop automation',
    'no-code automation',
  ],
  openGraph: {
    title: 'Download Stuard AI - Workflow Marketplace & Published Workflows',
    description: 'Download Stuard AI to access free published workflow automations and AI tools built by the community. One-click install.',
    type: 'website',
    url: 'https://stuard.ai/marketplace',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Stuard AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Download Stuard AI Workflow Marketplace',
    description: 'Download Stuard AI to access free published workflow automations and AI tools built by the community.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://stuard.ai/marketplace',
  },
};

const CATEGORIES: { id: string; name: string; Icon: LucideIcon }[] = [
  { id: 'productivity', name: 'Productivity', Icon: ListChecks },
  { id: 'automation', name: 'Automation', Icon: WorkflowIcon },
  { id: 'data', name: 'Data', Icon: BarChart3 },
  { id: 'integration', name: 'Integrations', Icon: Plug },
  { id: 'ai', name: 'AI & ML', Icon: Bot },
  { id: 'media', name: 'Media', Icon: Clapperboard },
  { id: 'skills', name: 'Skills', Icon: GraduationCap },
  { id: 'functions', name: 'Functions', Icon: SquareFunction },
  { id: 'developer', name: 'Developer', Icon: Code2 },
  { id: 'communication', name: 'Communication', Icon: MessageSquare },
];

function iconFor(category: string): LucideIcon {
  return CATEGORIES.find((c) => c.id === category)?.Icon ?? Boxes;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const icon = iconFor(workflow.category) ?? Package;

  return (
    <Link
      href={`/marketplace/${workflow.slug}`}
      className="group flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#111111] p-5 transition-colors duration-200 hover:border-[#FF383C]/40"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#FF383C]/20 bg-[#FF383C]/10 text-[#FF6B6E]">
          {createElement(icon, { className: 'h-5 w-5', strokeWidth: 1.75 })}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium text-white transition-colors group-hover:text-[#FF6B6E]">
            {workflow.name}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-[#737373]">by {workflow.publisher_name}</p>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[36px] text-[13px] leading-[18px] text-[#A3A3A3]">
        {workflow.description}
      </p>

      <div className="mt-auto flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px] text-[#A3A3A3]">
          <span className="inline-flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            {formatCount(workflow.download_count)}
          </span>
          {workflow.rating_count > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 fill-[#FFB020] text-[#FFB020]" strokeWidth={0} />
              {workflow.rating_avg.toFixed(1)}
              <span className="text-[#737373]">({workflow.rating_count})</span>
            </span>
          ) : (
            <span className="text-[#737373]">New</span>
          )}
        </div>

        {workflow.tags?.length > 0 && (
          <span className="truncate rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-[#A3A3A3]">
            {workflow.tags[0]}
          </span>
        )}
      </div>
    </Link>
  );
}

function WorkflowGrid({ workflows }: { workflows: Workflow[] }) {
  if (workflows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#111111] py-16 text-center">
        <div className="mb-4 text-5xl">📭</div>
        <h3 className="mb-2 text-xl font-semibold text-white">No workflows yet</h3>
        <p className="mb-6 text-[#A3A3A3]">Be the first to publish a workflow to the marketplace!</p>
        <Link
          href="/download"
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-[#080808] transition-colors hover:bg-white/90"
        >
          Download Stuard AI
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {workflows.map((workflow) => (
        <WorkflowCard key={workflow.id} workflow={workflow} />
      ))}
    </div>
  );
}

async function WorkflowList({ category, query }: { category?: string; query?: string }) {
  const workflows = await getWorkflows(category, query);
  return <WorkflowGrid workflows={workflows} />;
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const params = await searchParams;
  const selectedCategory = params.category;
  const searchQuery = params.q;

  // JSON-LD for marketplace
  const marketplaceSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Stuard AI Workflow Marketplace',
    description: 'Discover free workflow automations and AI tools built by the Stuard AI community.',
    url: 'https://stuard.ai/marketplace',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Stuard AI',
      url: 'https://stuard.ai',
    },
    about: {
      '@type': 'SoftwareApplication',
      name: 'Stuard AI',
      applicationCategory: 'ProductivityApplication',
    },
  };

  // FAQ Schema for SEO
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is the Stuard AI Workflow Marketplace?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The Stuard AI Workflow Marketplace is a community-driven platform where users can discover, share, and download automation workflows. These workflows can automate tasks on your desktop, integrate with apps, and leverage AI capabilities.',
        },
      },
      {
        '@type': 'Question',
        name: 'Are the workflows free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes! All workflows in the marketplace are free to download and use. Simply install Stuard AI on your desktop and import any workflow with one click.',
        },
      },
      {
        '@type': 'Question',
        name: 'How do I install a workflow from the marketplace?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Download Stuard AI for your desktop, then browse the marketplace either in the app or on the website. Click "Install" on any workflow to add it to your automation library.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I publish my own workflows?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Absolutely! Create workflows in Stuard AI using the visual builder or AI assistant, then publish them to the marketplace to share with the community.',
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(marketplaceSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <div className="min-h-screen bg-[#0A0A0B] text-white">
        {/* Hero Section */}
        <section className="px-4 pb-8 pt-32">
          <div className="mx-auto max-w-6xl text-center">
            <p className="mb-4 text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
              MARKETPLACE
            </p>
            <h1 className="mb-4 text-4xl font-medium text-white md:text-5xl">
              Workflow Marketplace
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-xl text-[#A3A3A3]">
              Discover free automation workflows built by the community.
              One-click install to your desktop.
            </p>

            {/* Search Bar */}
            <form action="/marketplace" method="GET" className="mx-auto mb-8 max-w-xl">
              <div className="relative">
                <input
                  type="search"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search workflows… (e.g., 'email automation', 'screenshot tool')"
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-5 py-4 pr-12 text-lg text-white placeholder:text-[#737373] shadow-sm focus:border-[#FF383C]/60 focus:outline-none focus:ring-2 focus:ring-[#FF383C]/30"
                />
                <button
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[#737373] transition-colors hover:text-[#FF6B6E]"
                  aria-label="Search"
                >
                  <Search className="h-6 w-6" strokeWidth={2} />
                </button>
              </div>
              {selectedCategory && (
                <input type="hidden" name="category" value={selectedCategory} />
              )}
            </form>

            {/* CTA */}
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/download"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-[#080808] transition-colors hover:bg-white/90"
              >
                <Download className="h-5 w-5" strokeWidth={2} />
                Download Stuard AI
              </Link>
              <span className="text-[#737373]">to install workflows</span>
            </div>
          </div>
        </section>

        {/* Categories */}
        <section className="border-b border-white/10 px-4 py-8">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                href="/marketplace"
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  !selectedCategory
                    ? 'bg-white text-[#080808]'
                    : 'border border-white/10 bg-white/5 text-[#A3A3A3] hover:bg-white/10 hover:text-white'
                }`}
              >
                All
              </Link>
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/marketplace?category=${cat.id}`}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-white text-[#080808]'
                      : 'border border-white/10 bg-white/5 text-[#A3A3A3] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <cat.Icon className="h-4 w-4" strokeWidth={1.75} />
                  <span>{cat.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow Grid */}
        <section className="px-4 py-12">
          <div className="mx-auto max-w-6xl">
            {searchQuery && (
              <p className="mb-6 text-[#A3A3A3]">
                Showing results for &quot;{searchQuery}&quot;
                {selectedCategory && ` in ${CATEGORIES.find((c) => c.id === selectedCategory)?.name}`}
              </p>
            )}

            <Suspense fallback={
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse rounded-2xl border border-white/10 bg-[#111111] p-5">
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 rounded-xl bg-white/5" />
                      <div className="flex-1">
                        <div className="mb-2 h-4 w-3/4 rounded bg-white/5" />
                        <div className="h-3 w-1/3 rounded bg-white/5" />
                      </div>
                    </div>
                    <div className="mt-4 h-9 rounded bg-white/5" />
                  </div>
                ))}
              </div>
            }>
              <WorkflowList category={selectedCategory} query={searchQuery} />
            </Suspense>
          </div>
        </section>

        {/* SEO Content Section */}
        <section className="border-t border-white/10 bg-[#0C0C0D] px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-6 text-center text-2xl font-semibold text-white">
              Why Use Stuard AI Workflow Marketplace?
            </h2>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mb-3 text-4xl">🚀</div>
                <h3 className="mb-2 font-semibold text-white">One-Click Install</h3>
                <p className="text-sm text-[#A3A3A3]">
                  No coding required. Import any workflow directly into Stuard AI and start automating immediately.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-3 text-4xl">🔒</div>
                <h3 className="mb-2 font-semibold text-white">Runs Locally</h3>
                <p className="text-sm text-[#A3A3A3]">
                  All workflows run on your desktop. Your data never leaves your machine unless you want it to.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-3 text-4xl">🤝</div>
                <h3 className="mb-2 font-semibold text-white">Community Built</h3>
                <p className="text-sm text-[#A3A3A3]">
                  Built and shared by users like you. Contribute your own workflows or customize existing ones.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section for SEO */}
        <section className="px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-center text-2xl font-semibold text-white">
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              {[
                {
                  q: 'What is the Stuard AI Workflow Marketplace?',
                  a: 'The Stuard AI Workflow Marketplace is a community-driven platform where users can discover, share, and download automation workflows. These workflows can automate tasks on your desktop, integrate with apps, and leverage AI capabilities.',
                },
                {
                  q: 'Are the workflows free to use?',
                  a: 'Yes! All workflows in the marketplace are free to download and use. Simply install Stuard AI on your desktop and import any workflow with one click.',
                },
                {
                  q: 'How is this different from n8n or Zapier?',
                  a: 'Unlike cloud-based automation tools, Stuard AI runs entirely on your desktop. This means faster execution, better privacy, and the ability to automate local apps and files. Plus, it has an AI assistant that can build workflows for you through natural conversation.',
                },
                {
                  q: 'Can I publish my own workflows?',
                  a: 'Absolutely! Create workflows in Stuard AI using the visual builder or AI assistant, then publish them to the marketplace to share with the community.',
                },
              ].map((item) => (
                <details key={item.q} className="group rounded-2xl border border-white/10 bg-[#111111] p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-white">
                    {item.q}
                    <span className="text-[#737373] transition-transform group-open:rotate-180">▼</span>
                  </summary>
                  <p className="mt-3 text-[#A3A3A3]">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
