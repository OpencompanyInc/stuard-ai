'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import SectionReveal from '@/components/layout/SectionReveal';

const FAQS = [
  {
    question: 'What is Stuard AI, in one sentence?',
    answer:
      'Stuard AI is a desktop app for Windows that gives you an AI assistant with real access to your computer — it organizes files, manages your email and calendar, works your apps, and turns any repeated task into an automation that runs on its own.',
  },
  {
    question: 'How is this different from ChatGPT or Copilot?',
    answer:
      'Chatbots answer; Stuard acts. It runs on your machine, so when you say "clean up my Downloads" or "schedule that call," the files actually move and the invite actually goes out. And anything it does once can be saved as a workflow, so you never have to ask twice.',
  },
  {
    question: 'Do I need to be technical to use it?',
    answer:
      'No. Day one is just chat in plain English. Workflows are built for you from a sentence — no code. And if you don\'t want to build anything, you can install ready-made mini-apps from the marketplace with one click.',
  },
  {
    question: 'What should I try first?',
    answer:
      'Pick one chore you do every week — summarizing your inbox, sorting downloads, prepping a report — and ask Stuard to do it. When it works, save it as a workflow. That one automation is usually what makes the app click.',
  },
  {
    question: 'What happens to my data? What about my Google account?',
    answer:
      'Stuard is local-first: your files, screen, and conversations stay on your machine. If you connect Google (Gmail, Calendar, Drive), that data is accessed only when you ask for a task that needs it, in line with Google\'s Limited Use policy. We never sell your data or use it to train models, and you can disconnect any account at any time.',
  },
  {
    question: 'Is it free?',
    answer:
      'Yes — the local assistant is free forever, and you can bring your own API keys. New accounts also get starter credits for managed AI. Credits (from $5/mo) only come in when you want cloud-hosted agents or managed models. No credit card required to start.',
  },
  {
    question: 'What platforms does it run on?',
    answer:
      'Windows 10 and 11 today. macOS and Linux are in development — join the waitlist at the top of this page and we\'ll email you when your platform is ready.',
  },
  {
    question: 'Is it Stuard, Steward, or Stuart?',
    answer:
      'It\'s Stuard AI (pronounced "stew-erd"). People sometimes search "Steward AI" or "Stuart AI" — they\'re all us.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-10 sm:gap-12">
        <SectionReveal className="flex flex-col items-center gap-4 text-center sm:gap-5">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            FAQ
          </p>
          <h2 className="text-[24px] leading-[1.2] sm:text-[32px] lg:text-[40px] font-normal text-white">
            Questions, answered.
          </h2>
        </SectionReveal>

        <SectionReveal delay={0.08} className="flex flex-col gap-3">
          {FAQS.map((faq, index) => {
            const open = openIndex === index;
            return (
              <div
                key={faq.question}
                className={`overflow-hidden rounded-2xl border transition-colors ${
                  open ? 'border-[#FF383C]/30 bg-[#111111]' : 'border-[#262626] bg-[#111111]/60 hover:border-white/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : index)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6 sm:py-5"
                >
                  <span className="text-[15px] sm:text-[16px] font-medium text-white">
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-[#737373] transition-transform ${
                      open ? 'rotate-180 text-[#FF6B6E]' : ''
                    }`}
                    strokeWidth={2}
                  />
                </button>
                {open && (
                  <p className="px-5 pb-5 text-[14px] leading-[23px] text-[#A3A3A3] sm:px-6 sm:pb-6">
                    {faq.answer}
                  </p>
                )}
              </div>
            );
          })}
        </SectionReveal>

        <SectionReveal delay={0.1} className="flex flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-[#A3A3A3]">Still have questions?</p>
          <a
            href="mailto:support@stuard.ai"
            className="text-[14px] font-medium text-white underline underline-offset-4 transition-colors hover:text-[#FF6B6E]"
          >
            support@stuard.ai
          </a>
        </SectionReveal>
      </div>
    </section>
  );
}
