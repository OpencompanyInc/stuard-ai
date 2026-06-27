import SectionReveal from '@/components/layout/SectionReveal';
import {
  Mail,
  FolderOpen,
  CalendarClock,
  FileBarChart,
  Clapperboard,
  BellRing,
  type LucideIcon,
} from 'lucide-react';

/**
 * UseCasesSection — concrete, copy-paste-able jobs people give Stuard.
 * This exists because visitors understand "summarize my unread emails" instantly,
 * while "AI workspace" means nothing to them. Each card shows the literal prompt,
 * what it touches, and what it becomes once saved.
 */

type UseCase = {
  icon: LucideIcon;
  title: string;
  prompt: string;
  uses: string;
  becomes: string;
};

const USE_CASES: UseCase[] = [
  {
    icon: Mail,
    title: 'Tame your inbox',
    prompt: 'Summarize my unread emails and draft replies to the important ones.',
    uses: 'Gmail',
    becomes: 'A morning briefing that runs at 8 AM every day.',
  },
  {
    icon: FolderOpen,
    title: 'Keep files in order',
    prompt: 'Sort my Downloads into folders by type and rename the screenshots.',
    uses: 'Local files',
    becomes: 'A cleanup that runs every Friday without you.',
  },
  {
    icon: CalendarClock,
    title: 'Run your calendar',
    prompt: 'Find a free slot Thursday afternoon and schedule a call with Sam.',
    uses: 'Google Calendar · Gmail',
    becomes: 'Scheduling you never think about again.',
  },
  {
    icon: FileBarChart,
    title: 'Automate the weekly report',
    prompt: "Pull last week's numbers from my sheet into a summary doc every Monday.",
    uses: 'Google Sheets · Docs',
    becomes: 'A mini-app your whole routine runs through.',
  },
  {
    icon: Clapperboard,
    title: 'Handle media chores',
    prompt: 'Trim this video to the first 30 seconds and compress it for email.',
    uses: 'Local files · ffmpeg',
    becomes: 'A drop-a-file-in, get-a-result-out tool.',
  },
  {
    icon: BellRing,
    title: 'Watch things for you',
    prompt: 'Check this site every hour and notify me when the price drops.',
    uses: 'Browser · Notifications',
    becomes: 'An agent that runs even while you sleep.',
  },
];

const UseCasesSection = () => {
  return (
    <section
      id="use-cases"
      className="relative w-full bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-10 sm:gap-12">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 text-center sm:gap-5">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            WHAT PEOPLE USE IT FOR
          </p>
          <h2 className="text-[24px] leading-[1.2] sm:text-[32px] lg:text-[40px] font-normal text-white">
            Not sure where to start? Steal one of these.
          </h2>
          <p className="max-w-[680px] text-[14px] leading-[22px] sm:text-[16px] sm:leading-[26px] text-[#D4D4D4]">
            Every job below starts as one sentence in chat. Do it once, save it, and it becomes an
            automation you never have to think about again.
          </p>
        </SectionReveal>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5">
          {USE_CASES.map((useCase, index) => (
            <SectionReveal key={useCase.title} delay={0.05 * index} className="h-full">
              <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#262626] bg-[#111111] p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#FF383C]/25 bg-[#FF383C]/10">
                    <useCase.icon className="h-5 w-5 text-[#FF6B6E]" strokeWidth={1.75} />
                  </div>
                  <h3 className="text-[16px] font-medium text-white">{useCase.title}</h3>
                </div>

                <p className="rounded-xl border border-white/[0.07] bg-[#0A0A0B] px-4 py-3 text-[13px] leading-[20px] text-[#C9C9CE]">
                  &ldquo;{useCase.prompt}&rdquo;
                </p>

                <div className="mt-auto flex flex-col gap-1.5">
                  <p className="text-[12px] text-[#737373]">
                    Uses <span className="text-[#A3A3A3]">{useCase.uses}</span>
                  </p>
                  <p className="text-[12px] text-[#737373]">
                    Becomes <span className="text-[#A3A3A3]">{useCase.becomes}</span>
                  </p>
                </div>
              </article>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
};

export default UseCasesSection;
