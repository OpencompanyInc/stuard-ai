'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import SectionReveal from '@/components/layout/SectionReveal';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../../shared/integration-flags';

type IntegrationCategory =
  | 'Communication'
  | 'Productivity'
  | 'Files'
  | 'Data'
  | 'Development'
  | 'Local'
  | 'Automation';

type Integration = {
  slug: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  logo: string;
  comingSoon?: boolean;
};

const INTEGRATIONS: Integration[] = [
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read, search, draft and send email from any workflow.',
    category: 'Communication',
    logo: '/integrations/Gmail.svg',
  },
  {
    slug: 'google-drive',
    name: 'Google Drive',
    description: 'List, open and search the files in your Drive.',
    category: 'Files',
    logo: '/integrations/GoogleDrive.svg',
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Read agendas, create events, schedule reminders.',
    category: 'Productivity',
    logo: '/integrations/GoogleCalendar.svg',
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    description: 'Pull the contents of a doc into a workflow.',
    category: 'Files',
    logo: '/integrations/GoogleDocs.svg',
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read ranges, fill rows, kick off automations from a cell.',
    category: 'Data',
    logo: '/integrations/GoogleSheets.svg',
  },
  {
    slug: 'google-tasks',
    name: 'Google Tasks',
    description: 'List, create and complete tasks across your task lists.',
    category: 'Productivity',
    logo: '/integrations/GoogleTasks.svg',
  },
  ...(OUTLOOK_INTEGRATION_ENABLED
    ? [{
        slug: 'outlook',
        name: 'Outlook',
        description: 'Connect Microsoft Outlook via PKCE to read your mail.',
        category: 'Communication' as IntegrationCategory,
        logo: '/integrations/Outlook.png',
      }]
    : []),
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Read repos, issues and PRs. Branch off into automations.',
    category: 'Development',
    logo: '/integrations/GitHub.svg',
  },
  ...(DISCORD_INTEGRATION_ENABLED
    ? [{
        slug: 'discord',
        name: 'Discord',
        description: 'Read and send messages, list servers and DMs.',
        category: 'Communication' as IntegrationCategory,
        logo: '/integrations/Discord.svg',
      }]
    : []),
  ...(REDDIT_INTEGRATION_ENABLED
    ? [{
        slug: 'reddit',
        name: 'Reddit',
        description: 'Browse, search, post, and comment on Reddit.',
        category: 'Communication' as IntegrationCategory,
        logo: '/integrations/Reddit.svg',
      }]
    : []),
  {
    slug: 'x',
    name: 'X (Twitter)',
    description: 'Read timelines, post tweets, send DMs, and look up users.',
    category: 'Communication',
    logo: '/integrations/X.svg',
  },
  // Disabled — Meta integrations temporarily hidden (see shared/integration-flags.ts)
  ...(META_INTEGRATION_ENABLED
    ? [
        {
          slug: 'facebook',
          name: 'Facebook',
          description: 'Sign in with OAuth for social automations and account access.',
          category: 'Communication' as IntegrationCategory,
          logo: '/integrations/Facebook.svg',
        },
        {
          slug: 'instagram',
          name: 'Instagram',
          description: 'OAuth + secure token storage for account-based features.',
          category: 'Communication' as IntegrationCategory,
          logo: '/integrations/Instagram.svg',
        },
        {
          slug: 'threads',
          name: 'Threads',
          description: 'Connect Threads for identity and future publishing workflows.',
          category: 'Communication' as IntegrationCategory,
          logo: '/integrations/Threads.svg',
        },
      ]
    : []),
  ...(WHATSAPP_INTEGRATION_ENABLED
    ? [{
        slug: 'whatsapp',
        name: 'WhatsApp',
        description: 'Receive messages, voice notes, images and files from Stuard.',
        category: 'Communication' as IntegrationCategory,
        logo: '/integrations/WhatsApp.svg',
      }]
    : []),
  {
    slug: 'telnyx',
    name: 'Phone (SMS / Call)',
    description: 'Verify your number to receive SMS and voice notifications.',
    category: 'Communication',
    logo: '/integrations/Telnyx.png',
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    description: 'Search videos, pull transcripts, summarise channels.',
    category: 'Communication',
    logo: '/integrations/YouTube.svg',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Query and write rows in your Supabase project.',
    category: 'Data',
    logo: '/integrations/Supabase.svg',
  },
  {
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Generate natural voice for narration and notifications.',
    category: 'Automation',
    logo: '/integrations/ElevenLabs.svg',
  },
  {
    slug: 'python',
    name: 'Python',
    description: 'Run Python locally. Stuard installs it for you when needed.',
    category: 'Local',
    logo: '/integrations/Python.svg',
  },
  {
    slug: 'ffmpeg',
    name: 'FFmpeg',
    description: 'Convert and edit audio & video. Installs on demand.',
    category: 'Local',
    logo: '/integrations/FFmpeg.svg',
  },
  {
    slug: 'ollama',
    name: 'Ollama',
    description: 'Run open-source models privately on your machine.',
    category: 'Local',
    logo: '/integrations/Ollama.svg',
  },
];

const CATEGORIES = [
  'All',
  'Communication',
  'Productivity',
  'Files',
  'Data',
  'Development',
  'Local',
  'Automation',
] as const;

const SYSTEM_CAPABILITIES = [
  'Files & folders',
  'Screen & windows',
  'Camera & mic',
  'Bluetooth',
  'Brightness',
  'Wallpaper',
  'Notifications',
  'Clipboard',
  'Browser automation',
  'Any installed app',
  'Custom MCP servers',
  'Webhooks & HTTP',
] as const;

const CONNECT_STEPS = [
  {
    step: '1',
    title: 'Sign in once',
    description:
      'OAuth or PKCE for each provider. Stuard never sees your password — only a token scoped to what you allow.',
  },
  {
    step: '2',
    title: 'Tokens stay encrypted',
    description:
      'Tokens are encrypted per-user with keys we cannot read. They live on your machine and on a vault we cannot decrypt.',
  },
  {
    step: '3',
    title: 'Use it from anywhere',
    description:
      'Chat, workflows, mini-apps and agents can all call the connection — locally on your PC, or from a cloud agent you spin up.',
  },
] as const;

type Category = (typeof CATEGORIES)[number];

const IntegrationsPageContent = () => {
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INTEGRATIONS.filter((integration) => {
      const matchesCategory =
        activeCategory === 'All' || integration.category === activeCategory;
      const matchesQuery =
        !q ||
        integration.name.toLowerCase().includes(q) ||
        integration.description.toLowerCase().includes(q) ||
        integration.category.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query]);

  return (
    <div className="pt-16 sm:pt-20 lg:pt-24">
      <IntegrationsHero />
      <IntegrationsGrid
        filtered={filtered}
        query={query}
        setQuery={setQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />
      <HowTheyConnect />
      <SystemCapabilities />
      <ClosingCTA />
    </div>
  );
};

function IntegrationsHero() {
  return (
    <section className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-6 text-center sm:gap-8">
        <SectionReveal className="flex flex-col items-center gap-5 sm:gap-7">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            INTEGRATIONS
          </p>
          <h1 className="text-[28px] leading-[1.15] sm:text-[40px] sm:leading-[1.15] lg:text-[52px] lg:leading-[1.1] font-normal text-white">
            Stuard plugs into the apps you already use.
          </h1>
          <p className="max-w-[680px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Sign in once with OAuth — then Stuard can read your Gmail, file your Drive, ship in
            GitHub, and ping your phone. Local-first where it counts. Cloud-routed only where it
            has to be.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link href="/download">
              <button
                type="button"
                className="inline-flex h-[42px] items-center justify-center gap-2 rounded-full bg-[#F5F5F5] px-5 text-[14px] font-medium text-black transition-colors hover:bg-white"
              >
                Download Stuard
              </button>
            </Link>
            <Link href="#integration-grid">
              <button
                type="button"
                className="inline-flex h-[42px] items-center justify-center rounded-full border border-white/20 px-5 text-[14px] font-medium text-white transition-colors hover:bg-white/5"
              >
                Browse {INTEGRATIONS.length} integrations
              </button>
            </Link>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}

interface IntegrationsGridProps {
  filtered: Integration[];
  query: string;
  setQuery: (value: string) => void;
  activeCategory: Category;
  setActiveCategory: (value: Category) => void;
}

function IntegrationsGrid({
  filtered,
  query,
  setQuery,
  activeCategory,
  setActiveCategory,
}: IntegrationsGridProps) {
  return (
    <section
      id="integration-grid"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 sm:gap-12">
        <SectionReveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <div className="flex flex-col items-start gap-3 sm:gap-4">
            <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
              THE LIBRARY
            </p>
            <h2 className="text-[22px] leading-[1.2] sm:text-[28px] lg:text-[36px] font-normal text-white">
              Everything Stuard knows how to talk to.
            </h2>
          </div>

          <div className="relative w-full sm:max-w-[320px]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search integrations"
              aria-label="Search integrations"
              className="w-full rounded-xl border border-white/15 bg-[#111111] py-2.5 pl-9 pr-3 text-[14px] text-white placeholder:text-[#525252] focus:outline-none focus:ring-1 focus:ring-[#FF383C]/50"
            />
          </div>
        </SectionReveal>

        <SectionReveal
          delay={0.05}
          className="flex flex-wrap gap-2 sm:gap-[10px]"
        >
          {CATEGORIES.map((category) => {
            const active = category === activeCategory;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                aria-pressed={active}
                className={`inline-flex h-[40px] items-center justify-center rounded-full px-4 text-[13px] sm:text-[14px] font-medium transition-colors ${
                  active
                    ? 'bg-[#D31519] text-white'
                    : 'border border-[#262626] text-[#D4D4D4] hover:border-white/30 hover:text-white'
                }`}
              >
                {category}
              </button>
            );
          })}
        </SectionReveal>

        <SectionReveal delay={0.1}>
          {filtered.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-[#262626] bg-[#111111] p-8 text-center">
              <p className="text-[15px] text-white">No matches.</p>
              <p className="text-[13px] text-[#A3A3A3]">
                Try a different search or category — or build your own with a custom MCP server.
              </p>
            </div>
          ) : (
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {filtered.map((integration) => (
                <IntegrationCard key={integration.slug} integration={integration} />
              ))}
            </div>
          )}
        </SectionReveal>
      </div>
    </section>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  return (
    <article className="group flex h-full flex-col gap-3 rounded-2xl border border-[#262626] bg-[#111111] p-5 transition-colors hover:border-white/20 hover:bg-[#151515]">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#262626] bg-[#0A0A0B] p-1.5">
          <Image
            src={integration.logo}
            alt={`${integration.name} logo`}
            width={28}
            height={28}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="flex flex-col">
          <h3 className="text-[15px] font-medium leading-tight text-white">
            {integration.name}
          </h3>
          <p className="text-[11px] uppercase tracking-wider text-[#737373]">
            {integration.category}
          </p>
        </div>
      </div>
      <p className="text-[13px] leading-[20px] text-[#D4D4D4]">{integration.description}</p>
    </article>
  );
}

function HowTheyConnect() {
  return (
    <section className="relative border-y border-[#262626] bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-10 sm:gap-12 lg:gap-14">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 sm:gap-5 lg:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            HOW THEY CONNECT
          </p>
          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] sm:leading-[1.2] lg:text-[36px] lg:leading-[1.2] font-normal text-white">
            Three steps. Then never think about it again.
          </h2>
          <p className="max-w-[720px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] lg:text-[16px] lg:leading-[26px] font-normal text-[#E5E5E5]">
            Stuard uses standard OAuth + PKCE flows. Tokens are encrypted at rest and only sent
            when a workflow actually needs them.
          </p>
        </SectionReveal>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
          {CONNECT_STEPS.map((stepItem, index) => (
            <SectionReveal key={stepItem.step} delay={0.08 * index} className="h-full">
              <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#262626] bg-[#111111] p-5 sm:p-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-[#FF383C]">{stepItem.step}</span>
                  <h3 className="text-[18px] sm:text-[20px] font-medium text-white">
                    {stepItem.title}
                  </h3>
                </div>
                <p className="text-[14px] leading-[22px] text-[#D4D4D4]">{stepItem.description}</p>
              </article>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SystemCapabilities() {
  return (
    <section className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 lg:gap-16">
        <SectionReveal className="flex w-full max-w-[900px] flex-col items-start gap-5 sm:gap-7">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            BEYOND APPS
          </p>
          <h2 className="text-[26px] leading-[1.15] sm:text-[36px] sm:leading-[1.15] lg:text-[44px] lg:leading-[1.1] font-normal text-white">
            Plus everything your PC already exposes.
          </h2>
          <p className="max-w-[680px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[26px] text-[#D4D4D4]">
            Cloud integrations are only half the story. Stuard also has the keys to the rest of
            your machine — the same things you would do with a script, only spoken in plain
            English.
          </p>
        </SectionReveal>

        <SectionReveal
          direction="up"
          distance={50}
          delay={0.1}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
        >
          {SYSTEM_CAPABILITIES.map((label) => (
            <div
              key={label}
              className="flex min-h-[72px] items-center justify-center rounded-xl border border-[#262626] bg-[#111111] px-3 py-4 text-center text-[12px] leading-snug text-[#E5E5E5] sm:text-[13px]"
            >
              {label}
            </div>
          ))}
        </SectionReveal>

        <SectionReveal delay={0.15} className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[520px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] text-[#A3A3A3]">
            Don&apos;t see what you need? Point Stuard at any MCP server — or write a 20-line
            tool and the rest of the assistant picks it up automatically.
          </p>
          <Link href="/features">
            <button
              type="button"
              className="inline-flex h-[48px] items-center justify-center gap-2 rounded-full border border-white/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.8)_0%,rgba(26,26,26,0.8)_100%)] px-6 text-[15px] font-normal text-white transition-opacity hover:opacity-90"
            >
              Browse all capabilities
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="relative bg-[#0A0A0B] px-4 py-20 text-white sm:py-28 lg:py-32">
      <div className="mx-auto flex w-full max-w-[800px] flex-col items-center gap-8 text-center">
        <SectionReveal className="flex flex-col items-center gap-6 sm:gap-8">
          <h2 className="text-[28px] leading-[1.15] sm:text-[40px] lg:text-[48px] font-normal text-white">
            One assistant. Every account. One place.
          </h2>
          <p className="text-[16px] sm:text-[18px] text-[#A3A3A3]">
            Connect once, then forget you set it up.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link href="/download">
              <button
                type="button"
                className="inline-flex h-[48px] items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#080808] transition-colors hover:bg-white/90"
              >
                Download Stuard
              </button>
            </Link>
            <Link href="/pricing">
              <button
                type="button"
                className="inline-flex h-[48px] items-center justify-center rounded-full border border-white/20 px-6 text-[15px] text-white transition-colors hover:bg-white/5"
              >
                See pricing
              </button>
            </Link>
          </div>
          <p className="text-[12px] text-[#525252]">
            Free. Local-first. Connect what you want, ignore the rest.
          </p>
        </SectionReveal>
      </div>
    </section>
  );
}

export default IntegrationsPageContent;
