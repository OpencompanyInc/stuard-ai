import SectionReveal from '@/components/layout/SectionReveal';
import MediaAssetSlot from '@/components/sections/MediaAssetSlot';

const DEMO_RUNGS = [
  { time: '0–15s', title: 'Chat', detail: 'One messy task — filesystem in motion, done.' },
  { time: '15–40s', title: 'Workflow', detail: 'Save the recipe. One click to run again.' },
  { time: '40–65s', title: 'Mini-app', detail: 'Drop a folder, hit go — a tool in your workspace.' },
  { time: '65–90s', title: 'Proactive agent', detail: 'Schedule or webhook — runs while the lid is closed.' },
] as const;

const DEMO_VIDEO_SRC = process.env.NEXT_PUBLIC_DEMO_VIDEO_SRC;

const BeyondTheChatSection = () => {
  return (
    <section
      id="demo"
      className="relative flex flex-col items-center bg-[#0A0A0B] text-white px-4 py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-8 sm:gap-10 lg:gap-12">
        <SectionReveal className="flex w-full max-w-[780px] flex-col items-center gap-4 sm:gap-5 text-center">
          <h2 className="text-[22px] leading-[1.2] sm:text-[28px] lg:text-[36px] font-normal text-white">
            Four rungs. One story. Sixty seconds.
          </h2>
          <p className="max-w-[720px] text-[14px] leading-[22px] sm:text-[15px] sm:leading-[24px] lg:text-[16px] lg:leading-[26px] text-[#E5E5E5]">
            Not a feature tour — watch Stuard climb from a one-off chat task to a workflow, a
            mini-app, and an agent that runs without you. Motion over menus: windows opening, files
            moving, work finishing.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.1} className="w-full">
          <MediaAssetSlot
            label="60–90s demo: chat → workflow save → mini-app UI → proactive agent / cloud cut"
            assetPath="/media/demo-ladder.mp4"
            videoSrc={DEMO_VIDEO_SRC}
            imageAlt="Stuard demo climbing the ladder from chat to proactive agent"
          />
        </SectionReveal>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEMO_RUNGS.map((rung, index) => (
            <SectionReveal key={rung.title} delay={0.05 * index}>
              <div className="rounded-xl border border-[#262626] bg-[#111111] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#FF383C]">
                  {rung.time}
                </p>
                <p className="mt-1 text-[15px] font-medium text-white">{rung.title}</p>
                <p className="mt-1 text-[13px] leading-snug text-[#737373]">{rung.detail}</p>
              </div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BeyondTheChatSection;
