import SectionReveal from '@/components/layout/SectionReveal';

const LADDER_RUNGS = [
  {
    step: '1',
    title: 'Chat',
    subtitle: 'butler',
    description: 'Tell Stuard what you want. It uses your computer to get it done.',
  },
  {
    step: '2',
    title: 'Workflows',
    subtitle: 'repeatable',
    description: 'Do something twice? Stuard saves the recipe. Run it again with one click.',
  },
  {
    step: '3',
    title: 'Mini-apps',
    subtitle: 'UI on top',
    description: 'Wrap a workflow in a UI and it becomes a tool that lives in your workspace.',
  },
  {
    step: '4',
    title: 'Proactive agents',
    subtitle: 'runs on its own',
    description: 'Schedule them, trigger them, let them run while you sleep.',
  },
] as const;

const HowItWorksIntroSection = () => {
  return (
    <section
      id="how-it-works"
      className="relative flex min-h-screen flex-col items-center justify-center bg-[#0A0A0B] text-white px-4 py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-10 sm:gap-12 lg:gap-14">
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

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {LADDER_RUNGS.map((rung, index) => (
            <SectionReveal key={rung.title} delay={0.08 * index} className="h-full">
              <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#262626] bg-[#111111] p-5 sm:p-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-[#FF383C]">{rung.step}</span>
                  <h3 className="text-[18px] sm:text-[20px] font-medium text-white">{rung.title}</h3>
                </div>
                <p className="text-[12px] uppercase tracking-wider text-[#737373]">{rung.subtitle}</p>
                <p className="text-[14px] leading-[22px] text-[#D4D4D4]">{rung.description}</p>
              </article>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksIntroSection;
