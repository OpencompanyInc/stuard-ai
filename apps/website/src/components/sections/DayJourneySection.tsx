'use client';

/**
 * DayJourneySection — the landing page's spine. Instead of feature sections,
 * the visitor scrolls through one day of using Stuard, 7:55 AM → 11:58 PM.
 * A sticky clock chip advances as each moment enters the viewport, so the
 * whole page reads as a single connected story rather than a feature list.
 *
 * The intro paragraph is deliberately NOT animated: it's the plain-language
 * "what is this app" statement Google OAuth verification reviewers and
 * crawlers must always see (id="about" backs the header link).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Phone,
  PhoneIncoming,
  PhoneOff,
  Check,
  Globe,
  FileText,
  MoonStar,
  ArrowRight,
} from 'lucide-react';

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

type Moment = {
  id: string;
  time: string;
  title: string;
  copy: ReactNode;
  visual: ReactNode;
  link?: { href: string; label: string };
};

/* ------------------------------------------------------------------ */
/* Bespoke mini-visuals — CSS only, no images, each reads in a glance. */
/* ------------------------------------------------------------------ */

function VisualFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#111113] p-4 sm:p-5
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_60px_-24px_rgba(0,0,0,0.7)]"
    >
      {children}
    </div>
  );
}

function SmsVisual() {
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF383C] text-[13px] font-semibold text-white">
          S
        </div>
        <div>
          <p className="text-[13px] font-medium text-white">Stuard</p>
          <p className="text-[10px] text-[#737373]">Text message · 7:55 AM</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-white/[0.07] px-3.5 py-2.5 text-[12.5px] leading-[19px] text-[#E5E5E5]">
          Morning ☀️ Standup at 10, dentist at 3. Two internship portals close Friday — I can
          finish those applications today.
        </div>
        <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-white/[0.07] px-3.5 py-2.5 text-[12.5px] leading-[19px] text-[#E5E5E5]">
          Say the word and I&apos;ll get started.
        </div>
        <div className="ml-auto max-w-[60%] rounded-2xl rounded-tr-md bg-[#FF383C] px-3.5 py-2.5 text-[12.5px] leading-[19px] text-white">
          go for it
        </div>
      </div>
    </VisualFrame>
  );
}

function BriefVisual() {
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
          <FileText className="h-4 w-4 text-[#FF6B6E]" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-white">EU-AI-Act-Brief.md</p>
          <p className="text-[10px] text-[#737373]">Written 10:14 AM · 14 sources read</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {['94%', '100%', '78%', '88%'].map((w, i) => (
          <div key={i} className="h-[7px] rounded bg-white/[0.08]" style={{ width: w }} />
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {['EU Official Journal', 'IAPP', 'McKinsey', '+11 more'].map((s) => (
          <span
            key={s}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#A3A3A3]"
          >
            {s}
          </span>
        ))}
      </div>
    </VisualFrame>
  );
}

function MiniAppVisual() {
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <p className="text-[11px] font-medium text-[#A3A3A3]">Bill Splitter — your mini-app</p>
        <span className="w-10" />
      </div>
      <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-5 text-center">
        <p className="text-[12px] text-[#A3A3A3]">Drop a receipt photo</p>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {[
          ['Pad thai', 'you + Sam', '$9.40'],
          ['Dumplings (x2)', 'everyone', '$4.10'],
        ].map(([item, who, amt]) => (
          <div key={item} className="flex items-center justify-between text-[11.5px]">
            <span className="text-[#E5E5E5]">{item}</span>
            <span className="text-[#737373]">{who}</span>
            <span className="font-medium text-white" style={{ fontFamily: MONO }}>
              {amt}
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="mt-3.5 w-full cursor-default rounded-lg border border-[#FF383C]/40 bg-[#FF383C]/15 py-2 text-[12px] font-medium text-white"
      >
        Split it
      </button>
    </VisualFrame>
  );
}

function WebsiteVisual() {
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <div className="flex h-6 flex-1 items-center rounded-md border border-white/10 bg-white/[0.04] px-2.5">
          <span className="text-[10.5px] text-[#A3A3A3]" style={{ fontFamily: MONO }}>
            localhost:3000
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[9.5px] text-[#4ade80]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" /> live
          </span>
        </div>
      </div>
      <div className="rounded-lg border border-white/[0.07] bg-[#0A0A0B] p-3.5">
        <div className="h-2 w-2/5 rounded bg-white/20" />
        <div className="mt-2 h-1.5 w-4/5 rounded bg-white/[0.08]" />
        <div className="mt-1.5 h-1.5 w-3/5 rounded bg-white/[0.08]" />
        <div className="mt-3 flex gap-2">
          <div className="h-10 flex-1 rounded-md bg-[#FF383C]/25" />
          <div className="h-10 flex-1 rounded-md bg-white/[0.06]" />
          <div className="h-10 flex-1 rounded-md bg-white/[0.06]" />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[#737373]">
        <Globe className="mr-1 inline h-3 w-3 align-[-1px]" strokeWidth={2} />
        Built from one sentence — deploy when you&apos;re happy.
      </p>
    </VisualFrame>
  );
}

function TrackerVisual() {
  const rows: Array<[string, string, 'done' | 'doing']> = [
    ['Vertex Labs — SWE Intern', 'Submitted 4:32 PM', 'done'],
    ['Northwind — Data Intern', 'Submitted 4:19 PM', 'done'],
    ['Helio — Product Intern', 'Filling form…', 'doing'],
  ];
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-medium text-white">Applications.xlsx</p>
        <p className="text-[10px] text-[#737373]">tracked by Stuard</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([role, when, st]) => (
          <div
            key={role}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-[12px] text-[#E5E5E5]">{role}</p>
              <p className="text-[10px] text-[#737373]">{when}</p>
            </div>
            {st === 'done' ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#4ade80]/25 bg-[#4ade80]/10 px-2 py-0.5 text-[10px] text-[#4ade80]">
                <Check className="h-3 w-3" strokeWidth={2.5} /> Applied
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] text-[#A3A3A3]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF6B6E]" /> Working
              </span>
            )}
          </div>
        ))}
      </div>
    </VisualFrame>
  );
}

function CallVisual() {
  return (
    <VisualFrame>
      <div className="flex flex-col items-center py-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FF383C] text-[20px] font-semibold text-white">
          S
        </div>
        <p className="mt-3 text-[15px] font-medium text-white">Stuard</p>
        <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-[#A3A3A3]">
          <PhoneIncoming className="h-3 w-3" strokeWidth={2} /> incoming call · 6:12 PM
        </p>
        <p className="mt-3 max-w-[280px] text-[12px] leading-[18px] text-[#D4D4D4]">
          &ldquo;The Vertex portal updated — you got the interview. Friday, 2 PM. Want a brief on
          the team before then?&rdquo;
        </p>
        <div className="mt-4 flex items-center gap-8">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3a3a3e]">
            <PhoneOff className="h-[18px] w-[18px] text-white" strokeWidth={2} />
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#28c840]">
            <Phone className="h-[18px] w-[18px] text-white" strokeWidth={2} />
          </span>
        </div>
      </div>
    </VisualFrame>
  );
}

function NightVisual() {
  return (
    <VisualFrame>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
          <MoonStar className="h-4 w-4 text-[#A3A3A3]" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-white">While you sleep</p>
          <p className="text-[10px] text-[#737373]">agents running · memory synced</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {[
          ['Price watch — flight to NYC', 'checks hourly'],
          ['Interview prep brief', 'ready by 7 AM'],
          ['Morning plan → your phone', 'sends 7:55 AM'],
        ].map(([name, cadence]) => (
          <div
            key={name}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2"
          >
            <span className="truncate text-[12px] text-[#E5E5E5]">{name}</span>
            <span className="ml-3 inline-flex shrink-0 items-center gap-1.5 text-[10px] text-[#737373]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
              {cadence}
            </span>
          </div>
        ))}
      </div>
    </VisualFrame>
  );
}

/* ------------------------------------------------------------------ */
/* The day itself                                                      */
/* ------------------------------------------------------------------ */

const MOMENTS: Moment[] = [
  {
    id: 'morning',
    time: '7:55 AM',
    title: 'Your day lands on your phone',
    copy: (
      <>
        Before you&apos;ve had coffee, Stuard has read your calendar, checked your deadlines, and
        texted you the plan. Reminders go where you&apos;ll actually see them — your phone.
      </>
    ),
    visual: <SmsVisual />,
    link: { href: '/how-it-works', label: 'How scheduling works' },
  },
  {
    id: 'research',
    time: '10:14 AM',
    title: 'Research that goes past page one',
    copy: (
      <>
        You ask for a real answer, not a vibe. Stuard reads dozens of sources, cross-checks them,
        and hands you a cited brief — saved next to your notes, remembered for later.
      </>
    ),
    visual: <BriefVisual />,
    link: { href: '/features', label: 'See deep research' },
  },
  {
    id: 'miniapp',
    time: '12:20 PM',
    title: 'The tool you wished existed at lunch',
    copy: (
      <>
        &ldquo;Make me a bill splitter from a receipt photo.&rdquo; Twenty minutes later it&apos;s a
        mini-app in your workspace — yours forever, no code. Or skip the building and install one
        the community already made.
      </>
    ),
    visual: <MiniAppVisual />,
    link: { href: '/marketplace', label: 'Browse the marketplace' },
  },
  {
    id: 'website',
    time: '2:48 PM',
    title: 'Describe a website. Watch it build.',
    copy: (
      <>
        The portfolio you&apos;ve been putting off — described in a sentence, scaffolded, styled,
        and previewing on localhost while you watch. Tweak it in plain English.
      </>
    ),
    visual: <WebsiteVisual />,
  },
  {
    id: 'applications',
    time: '4:32 PM',
    title: 'It’s been applying while you worked',
    copy: (
      <>
        Those internship portals from this morning? Forms filled from your résumé, every
        submission tracked in a sheet. You did your job while it did the chore.
      </>
    ),
    visual: <TrackerVisual />,
    link: { href: '/features', label: 'Browser automation' },
  },
  {
    id: 'call',
    time: '6:12 PM',
    title: 'Your phone rings. It’s good news.',
    copy: (
      <>
        Stuard kept an eye on the portal so you didn&apos;t have to refresh it. When the answer
        came, it didn&apos;t send a notification you&apos;d miss — it called.
      </>
    ),
    visual: <CallVisual />,
  },
  {
    id: 'night',
    time: '11:58 PM',
    title: 'And it still remembers',
    copy: (
      <>
        What you said this morning, the site you shipped, who you&apos;re meeting Friday — context
        carries across every task without you repeating yourself. Agents keep running in the cloud
        while your laptop sleeps.
      </>
    ),
    visual: <NightVisual />,
    link: { href: '/how-it-works', label: 'Memory & cloud agents' },
  },
];

function MomentRow({
  moment,
  index,
  onActive,
}: {
  moment: Moment;
  index: number;
  onActive: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onActive(index);
      },
      { rootMargin: '-40% 0px -45% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, onActive]);

  const flip = index % 2 === 1;

  return (
    <div ref={ref} className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-2 lg:gap-16">
      {/* timeline node (desktop) */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 hidden h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#FF383C] bg-[#0A0A0B] lg:block"
      />
      <div className={`flex flex-col gap-3 ${flip ? 'lg:order-2 lg:pl-16' : 'lg:pr-16'}`}>
        <p
          className="text-[12px] font-medium tracking-[0.08em] text-[#FF6B6E]"
          style={{ fontFamily: MONO }}
        >
          {moment.time}
        </p>
        <h3
          className="text-[22px] leading-[1.15] text-white sm:text-[26px] lg:text-[30px]"
          style={{ fontFamily: 'var(--font-general-sans)' }}
        >
          {moment.title}
        </h3>
        <p className="max-w-[440px] text-[14px] leading-[23px] text-[#A8A8AE] sm:text-[15px] sm:leading-[24px]">
          {moment.copy}
        </p>
        {moment.link && (
          <Link
            href={moment.link.href}
            className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[#D4D4D4] transition-colors hover:text-white"
          >
            {moment.link.label}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </Link>
        )}
      </div>
      <div className={`flex ${flip ? 'lg:order-1 lg:justify-end lg:pr-16' : 'lg:pl-16'}`}>
        {moment.visual}
      </div>
    </div>
  );
}

export default function DayJourneySection() {
  const [active, setActive] = useState(0);

  return (
    <section id="day" className="relative bg-[#0A0A0B] px-4 py-20 text-white sm:py-24">
      <div className="mx-auto w-full max-w-[1060px]">
        {/* Intro — statically rendered on purpose (crawlers + OAuth reviewers). */}
        <div id="about" className="mx-auto mb-16 flex w-full max-w-[760px] flex-col gap-5 text-center sm:mb-20">
          <p className="text-[12px] font-semibold tracking-wider text-[#FF383C] sm:text-[13px]">
            ONE DAY WITH STUARD
          </p>
          <h2
            className="text-[28px] leading-[1.15] text-white sm:text-[38px] lg:text-[46px]"
            style={{ fontFamily: 'var(--font-general-sans)' }}
          >
            It&apos;s 7:55 AM.
            <br />
            <span className="text-[#FF6B6E]">Stuard is already working.</span>
          </h2>
          <p className="mx-auto max-w-[680px] text-[15px] leading-[25px] text-[#D4D4D4] sm:text-[16px] sm:leading-[27px]">
            Stuard AI is a desktop app for Windows that puts a personal AI assistant on your PC —
            with real access to your files, your apps, and the accounts you choose to connect. You
            ask in plain English; it finishes the work, and remembers you the next time. Here&apos;s
            what one ordinary day looks like.
          </p>
        </div>

        <div className="relative">
          {/* the day's thread */}
          <span
            aria-hidden
            className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/15 to-transparent lg:block"
          />

          {/* sticky clock — follows the visitor through the day */}
          <div className="pointer-events-none sticky top-20 z-30 mb-10 flex justify-center sm:top-24">
            <span
              className="rounded-full border border-white/10 bg-[#111113]/90 px-4 py-1.5 text-[12px] font-medium text-white shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
              style={{ fontFamily: MONO }}
            >
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#FF383C] align-middle" />
              {MOMENTS[active]?.time ?? MOMENTS[0].time}
            </span>
          </div>

          <div className="flex flex-col gap-20 sm:gap-28">
            {MOMENTS.map((m, i) => (
              <MomentRow key={m.id} moment={m} index={i} onActive={setActive} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
