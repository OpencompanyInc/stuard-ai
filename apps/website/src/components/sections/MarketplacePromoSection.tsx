import Link from 'next/link';
import {
  ListChecks,
  Workflow,
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
  type LucideIcon,
} from 'lucide-react';
import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';
import { getTopWorkflows, type Workflow as MarketWorkflow } from '@/lib/marketplace';

const MARKETPLACE_IMAGE_SRC = process.env.NEXT_PUBLIC_MARKETPLACE_SCREENSHOT_SRC;

const CATEGORY_ICON: Record<string, LucideIcon> = {
  productivity: ListChecks,
  automation: Workflow,
  data: BarChart3,
  integration: Plug,
  ai: Bot,
  media: Clapperboard,
  developer: Code2,
  communication: MessageSquare,
  functions: SquareFunction,
  skills: GraduationCap,
  general: Boxes,
};

function iconFor(category: string): LucideIcon {
  return CATEGORY_ICON[category] ?? Package;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

function TopAppCard({ app }: { app: MarketWorkflow }) {
  const Icon = iconFor(app.category);
  return (
    <Link
      href={`/marketplace/${app.slug}`}
      className="group flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#111111] p-5 transition-colors duration-200 hover:border-[#FF383C]/40"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#FF383C]/20 bg-[#FF383C]/10 text-[#FF6B6E]">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium text-white group-hover:text-[#FF6B6E] transition-colors">
            {app.name}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-[#737373]">by {app.publisher_name}</p>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[36px] text-[13px] leading-[18px] text-[#A3A3A3]">
        {app.description}
      </p>

      <div className="mt-auto flex items-center gap-4 text-[12px] text-[#A3A3A3]">
        <span className="inline-flex items-center gap-1.5">
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
          {formatCount(app.download_count)}
        </span>
        {app.rating_count > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 fill-[#FFB020] text-[#FFB020]" strokeWidth={0} />
            {app.rating_avg.toFixed(1)}
            <span className="text-[#737373]">({app.rating_count})</span>
          </span>
        ) : (
          <span className="text-[#737373]">New</span>
        )}
      </div>
    </Link>
  );
}

const MarketplacePromoSection = async () => {
  const topApps = await getTopWorkflows(6);

  return (
    <section
      id="marketplace"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-8 sm:gap-10">
        <SectionReveal className="flex w-full flex-col items-center gap-5 sm:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            MARKETPLACE
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            Don&apos;t build it. Install it.
          </h2>
          <p className="max-w-[640px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Browse mini-apps built by the community. Hit install. They run on your machine with your
            tools, your files, your accounts.
          </p>
        </SectionReveal>

        {topApps.length > 0 ? (
          <SectionReveal delay={0.1} className="w-full">
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topApps.map((app) => (
                <TopAppCard key={app.id} app={app} />
              ))}
            </div>
          </SectionReveal>
        ) : (
          <SectionReveal delay={0.1} className="w-full">
            <MediaAssetSlot
              label="Real marketplace grid — community mini-apps, ratings, visible Install button"
              assetPath="/media/marketplace-grid.png"
              imageSrc={MARKETPLACE_IMAGE_SRC}
              imageAlt="Stuard marketplace with installable community mini-apps"
              aspectClassName="aspect-[16/9]"
            />
          </SectionReveal>
        )}

        <SectionReveal delay={0.15}>
          <Link href="/marketplace">
            <button
              type="button"
              className="inline-flex h-[52px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white px-6 text-[15px] font-medium text-[#080808] transition-colors hover:bg-white/90"
            >
              Browse the marketplace
            </button>
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
};

export default MarketplacePromoSection;
