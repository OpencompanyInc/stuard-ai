import { MessageSquare, Workflow, Plug, type LucideIcon } from 'lucide-react';

/**
 * AboutSection — a plain-language statement of what Stuard AI is, placed right after
 * the hero. Deliberately rendered WITHOUT scroll-reveal animation so the app's purpose
 * is always visible to visitors, crawlers, and OAuth verification reviewers.
 * id="about" also backs the header link.
 */

type Pillar = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const PILLARS: Pillar[] = [
  {
    icon: MessageSquare,
    title: 'An assistant that acts',
    description:
      'Chat with Stuard like you would a person. Instead of just answering, it does the task — moves the files, drafts the email, books the meeting.',
  },
  {
    icon: Plug,
    title: 'Connected to your world',
    description:
      'It works with your local files and apps, and with accounts you choose to connect — Gmail, Google Calendar, Drive, GitHub, and more.',
  },
  {
    icon: Workflow,
    title: 'A workspace that compounds',
    description:
      'Anything you do once can be saved as a workflow, turned into a mini-app, or scheduled to run on its own. Your effort adds up instead of starting over.',
  },
];

const AboutSection = () => {
  return (
    <section
      id="about"
      className="relative w-full bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-10 sm:gap-12">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 text-center sm:gap-6">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            WHAT IS STUARD AI?
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[34px] lg:text-[42px] font-normal text-white">
            A personal AI assistant installed on your PC — built to finish work, not just talk
            about it.
          </h2>
          <p className="text-[16px] leading-[27px] sm:text-[17px] sm:leading-[29px] text-[#D4D4D4]">
            Stuard AI is a desktop application for Windows. It pairs an AI assistant with real
            access to your computer and the accounts you connect, so everyday work — files, email,
            calendar, repetitive chores — gets done for you. Most of its work happens locally on
            your device; it only reaches the cloud or a connected account when a task you asked
            for requires it.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.title}
              className="flex h-full flex-col gap-4 rounded-2xl border border-[#262626] bg-[#111111] p-6"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#FF383C]/25 bg-[#FF383C]/10">
                <pillar.icon className="h-5 w-5 text-[#FF6B6E]" strokeWidth={1.75} />
              </div>
              <h3 className="text-[17px] font-medium text-white">{pillar.title}</h3>
              <p className="text-[14px] leading-[22px] text-[#A3A3A3]">{pillar.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
