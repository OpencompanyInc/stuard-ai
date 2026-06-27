import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import SectionReveal from '@/components/layout/SectionReveal';

/**
 * CompoundsSection — the payoff after the day journey. One band: everything
 * the visitor just watched happen once becomes permanent, then three quiet
 * doors deeper into the product (how it works, marketplace, cloud).
 */

const DOORS = [
  {
    href: '/how-it-works',
    title: 'Ask → save → automate',
    copy: 'Anything Stuard does once becomes a one-click workflow, a mini-app, or a scheduled agent.',
  },
  {
    href: '/marketplace',
    title: 'Or install, don’t build',
    copy: 'Community mini-apps run on your machine with your files and your accounts.',
  },
  {
    href: '/how-it-works',
    title: 'Cloud when you need it',
    copy: 'One click mirrors an agent to a cloud VM so it runs while your laptop is closed.',
  },
];

export default function CompoundsSection() {
  return (
    <section className="relative border-y border-[#1c1c1f] bg-[#0A0A0B] px-4 py-20 text-white sm:py-28">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-12 sm:gap-14">
        <SectionReveal className="flex flex-col items-center gap-4 text-center">
          <h2 className="tracking-tight" style={{ fontFamily: 'var(--font-general-sans)' }}>
            <span className="block text-[30px] leading-[1.08] text-white sm:text-[44px] lg:text-[54px]">
              That was one day.
            </span>
            <span className="mt-1 block text-[30px] font-medium leading-[1.08] text-[#FF6B6E] sm:text-[44px] lg:text-[54px]">
              It compounds.
            </span>
          </h2>
          <p className="max-w-[620px] text-[15px] leading-[25px] text-[#A8A8AE] sm:text-[16px] sm:leading-[26px]">
            Every task you watched happen is saved the moment it works. Tomorrow it&apos;s one
            click. Next week it runs itself. Your effort adds up instead of starting over.
          </p>
        </SectionReveal>

        <SectionReveal delay={0.08} className="w-full">
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
            {DOORS.map((door) => (
              <Link
                key={door.title}
                href={door.href}
                className="group flex flex-col gap-2.5 rounded-2xl border border-[#222225] bg-[#101012] p-6 transition-colors hover:border-white/25"
              >
                <h3 className="flex items-center gap-2 text-[15px] font-medium text-white">
                  {door.title}
                  <ArrowRight
                    className="h-3.5 w-3.5 text-[#737373] transition-all group-hover:translate-x-0.5 group-hover:text-white"
                    strokeWidth={2}
                  />
                </h3>
                <p className="text-[13px] leading-[20px] text-[#A3A3A3]">{door.copy}</p>
              </Link>
            ))}
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
