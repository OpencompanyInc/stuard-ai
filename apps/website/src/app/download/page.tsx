import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Download',
  description: 'Download Stuard AI for Windows. The local-first desktop assistant that automates your workflows.',
  openGraph: {
    title: 'Download - Stuard AI',
    description: 'Download Stuard AI for Windows. The local-first desktop assistant.',
    url: 'https://stuard.ai/download',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Stuard AI',
      },
    ],
  },
};

export default function DownloadPage() {

  const systemRequirements = {
    minimum: [
      'Windows 10 or later (64-bit)',
      '4 GB RAM',
      '2 GB free disk space',
      'Internet connection for cloud AI models',
    ],
    recommended: [
      'Windows 11 (64-bit)',
      '8 GB RAM or more',
      '5 GB free disk space',
      'SSD for optimal performance',
    ],
  };

  const features = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      title: 'Explainable Reasoning',
      description: 'Plans you can see before execution',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      title: 'On-device Actions',
      description: 'Executes steps on your Windows device with approvals',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      title: 'Durable Memory',
      description: 'Remembers context across sessions and projects',
    },
  ];

  return (
    <div className="bg-[#0A0A0B] text-white">
      <section className="pt-32 pb-16">
        <Container className="text-center">
          <h1 className="mb-6 text-4xl font-bold text-white lg:text-6xl">
            Download Stuard AI
          </h1>
          <p className="mx-auto mb-8 max-w-3xl text-xl text-[#A3A3A3] lg:text-2xl">
            Automation-first desktop assistant for Windows. Plans you can see, actions on your device, and memory that compounds.
          </p>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          {/* Download CTA */}
          <div className="mx-auto mb-16 max-w-3xl">
            <Card className="p-8 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF383C] to-[#D31519] shadow-lg shadow-[#FF383C]/20">
                <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <h2 className="mb-2 text-2xl font-bold text-white">Stuard AI for Windows</h2>
              <p className="mb-6 text-[#A3A3A3]">
                Download the latest version and start automating in minutes.
              </p>
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  href="/api/download?platform=windows"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 font-semibold text-[#0A0A0B] transition-colors hover:bg-white/90"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 3h8.5v8.5H3V3zm9.5 0H21v8.5h-8.5V3zM3 12.5h8.5V21H3v-8.5zm9.5 0H21V21h-8.5v-8.5z" />
                  </svg>
                  Download for Windows
                </a>
                <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-8 py-3.5 font-semibold text-white transition-colors hover:bg-white/10">
                  Create Free Account
                </Link>
              </div>
              <p className="mt-4 text-xs text-[#737373]">
                v1.0 &middot; Windows 10+ (64-bit) &middot; ~120 MB
              </p>
            </Card>
          </div>

          {/* Features Grid */}
          <div className="mb-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {features.map((feature, index) => (
              <Card key={index} className="p-6 text-center transition-colors hover:border-[#FF383C]/40">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#FF383C]/20 bg-[#FF383C]/10 text-[#FF6B6E]">
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-semibold text-white">{feature.title}</h3>
                <p className="text-sm text-[#A3A3A3]">{feature.description}</p>
              </Card>
            ))}
          </div>

          {/* System Requirements */}
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-8 text-center text-3xl font-bold text-white">
              System Requirements
            </h2>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <Card className="p-6">
                <h3 className="mb-4 text-xl font-semibold text-white">Minimum</h3>
                <ul className="space-y-3">
                  {systemRequirements.minimum.map((req, index) => (
                    <li key={index} className="flex items-center text-[#D4D4D4]">
                      <svg className="mr-3 h-5 w-5 flex-shrink-0 text-[#FF6B6E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="border-[#FF383C]/40 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-white">Recommended</h3>
                  <span className="rounded bg-[#FF383C]/10 px-2 py-1 text-xs font-semibold text-[#FF6B6E]">BEST</span>
                </div>
                <ul className="space-y-3">
                  {systemRequirements.recommended.map((req, index) => (
                    <li key={index} className="flex items-center text-[#D4D4D4]">
                      <svg className="mr-3 h-5 w-5 flex-shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          {/* Installation Steps */}
          <div className="mx-auto mt-16 max-w-3xl">
            <h2 className="mb-6 text-center text-2xl font-bold text-white">
              Quick & Easy Installation
            </h2>
            <Card className="p-8">
              <ol className="space-y-4">
                {[
                  { n: 1, title: 'Download the installer', desc: 'Click the download button above to get the latest version' },
                  { n: 2, title: 'Run the installer', desc: 'Follow the simple setup wizard' },
                  { n: 3, title: 'Sign in and start', desc: 'Press Win+Space to activate your AI assistant' },
                ].map((step) => (
                  <li key={step.n} className="flex items-start">
                    <div className="mr-4 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#FF383C]/20 bg-[#FF383C]/10 font-semibold text-[#FF6B6E]">
                      {step.n}
                    </div>
                    <div>
                      <h4 className="mb-1 font-semibold text-white">{step.title}</h4>
                      <p className="text-sm text-[#A3A3A3]">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </Container>
      </section>
    </div>
  );
}
