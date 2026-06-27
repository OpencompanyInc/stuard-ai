import SectionReveal from '@/components/layout/SectionReveal';
import Link from 'next/link';

const PrivacySection = () => {
  return (
    <section
      id="privacy"
      className="relative bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center gap-8 sm:gap-10">
        <SectionReveal className="flex flex-col items-center gap-5 sm:gap-7 text-center">
          <p className="text-[12px] sm:text-[13px] font-semibold tracking-wider text-[#FF383C]">
            PRIVACY & DATA USAGE
          </p>
          <h2 className="text-[26px] leading-[1.2] sm:text-[36px] lg:text-[44px] font-normal text-white">
            Local by architecture. Cloud only when you ask.
          </h2>
          <p className="max-w-[720px] text-[15px] leading-[24px] sm:text-[17px] sm:leading-[28px] text-[#D4D4D4]">
            Stuard AI is a personal desktop assistant application that automates tasks across your local machine and cloud accounts. Your files, your camera, and your screen never leave your machine. The only things that go to the cloud are your memories (so Stuard remembers you across devices) and your OAuth tokens (so it can talk to your connected apps). Both are encrypted per-user with keys we can&apos;t read.
          </p>
          
          <div className="mt-6 max-w-[720px] rounded-2xl border border-white/10 bg-[#111111] p-6 sm:p-8 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_50px_-12px_rgba(0,0,0,0.55)]">
            <h3 className="mb-3 text-[18px] font-semibold text-white">Why we request Google data</h3>
            <p className="text-[14px] leading-[24px] sm:text-[15px] sm:leading-[26px] text-[#A3A3A3]">
              To act as a helpful assistant, Stuard AI requests access to your Google Workspace. We use <strong className="text-[#D4D4D4] font-medium">Gmail</strong> access to let you draft and read emails from chat, <strong className="text-[#D4D4D4] font-medium">Google Drive</strong> access to let you search and organize your cloud files, and <strong className="text-[#D4D4D4] font-medium">Google Calendar</strong> access so the assistant can view your schedule and create events for you. 
              <br/><br/>
              This data is only accessed when you explicitly ask the assistant to perform a task requiring it. We never sell your data, use it to train our models, or share it with unauthorized third parties.
            </p>
          </div>
        </SectionReveal>

        <SectionReveal delay={0.1} className="flex flex-col items-center gap-5">
          <p className="text-center text-[15px] sm:text-[16px] font-medium text-white">
            Local where it matters. Cloud where it has to be. Encrypted either way.
          </p>
          <Link 
            href="/privacy" 
            className="text-[14px] text-[#737373] hover:text-white underline underline-offset-4 transition-colors"
          >
            Read our full Privacy Policy
          </Link>
        </SectionReveal>
      </div>
    </section>
  );
};

export default PrivacySection;
