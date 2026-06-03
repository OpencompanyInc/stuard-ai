import SectionReveal from '@/components/layout/SectionReveal';
import { MessageSquare, Workflow, AppWindow, CalendarClock, Check, type LucideIcon } from 'lucide-react';

type LadderRung = {
  step: string;
  title: string;
  subtitle: string;
  description: string;
  proof: string;
  icon: LucideIcon;
};

const LADDER_RUNGS: LadderRung[] = [
  {
    step: '1',
    title: 'Chat',
    subtitle: 'butler',
    description: 'Tell Stuard what you want. It uses your computer to get it done.',
    proof: 'This actually ran',
    icon: MessageSquare,
  },
  {
    step: '2',
    title: 'Workflows',
    subtitle: 'repeatable',
    description: 'Do something twice? Stuard saves the recipe. Run it again with one click.',
    proof: 'Saved as a workflow',
    icon: Workflow,
  },
  {
    step: '3',
    title: 'Mini-apps',
    subtitle: 'UI on top',
    description: 'Wrap a workflow in a UI and it becomes a tool that lives in your workspace.',
    proof: 'Lives in your workspace',
    icon: AppWindow,
  },
  {
    step: '4',
    title: 'Proactive agents',
    subtitle: 'runs on its own',
    description: 'Schedule them, trigger them, let them run while you sleep.',
    proof: 'Ran at 6:00 AM',
    icon: CalendarClock,
  },
];

const HowItWorksIntroSection = () => {
  return (
    <section
      id="how-it-works"
      className="relative flex flex-col items-center bg-[#0A0A0B] text-white px-4 py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-10 sm:gap-12 lg:gap-14">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 sm:gap-5 lg:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] lg:text-[14px] font-semibold leading-tight text-[#FF383C] tracking-wider">
            THE LADDER
          </p>

          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] sm:leading-[1.2] lg:text-[36px] lg:leading-[1.2] font-normal text-white">
            One assistant. Four ways to use it.
          </h2>

          <p className="max-w-[720px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] lg:text-[16px] lg:leading-[26px] font-normal text-[#E5E5E5]">
            Each rung is more automatic than the last. You climb when you&apos;re ready.
          </p>
        </SectionReveal>

        <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:gap-6">
          {LADDER_RUNGS.map((rung, index) => (
            <SectionReveal key={rung.title} delay={0.08 * index} className="h-full">
              <article className="flex h-full flex-col gap-5 rounded-2xl border border-[#262626] bg-[#111111] p-6 sm:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#FF383C]/25 bg-[#FF383C]/10">
                    <rung.icon className="h-6 w-6 text-[#FF6B6E]" strokeWidth={1.75} />
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#A3A3A3]">
                    <Check className="h-3 w-3 text-[#4ade80]" strokeWidth={2.5} />
                    {rung.proof}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-[#FF383C]">{rung.step}</span>
                    <h3 className="text-[19px] sm:text-[20px] font-medium text-white">{rung.title}</h3>
                    <span className="text-[11px] uppercase tracking-wider text-[#737373]">{rung.subtitle}</span>
                  </div>
                  <p className="text-[14px] leading-[22px] text-[#D4D4D4]">{rung.description}</p>
                </div>
              </article>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksIntroSection;
