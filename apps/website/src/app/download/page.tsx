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
    <>
      <section className="pt-32 pb-16">
        <Container className="text-center">
          <h1 className="text-4xl lg:text-6xl font-bold mb-6 text-gray-900">
            Download Stuard AI
          </h1>
          <p className="text-xl lg:text-2xl mb-8 text-gray-600 max-w-3xl mx-auto">
            Automation-first desktop assistant for Windows. Plans you can see, actions on your device, and memory that compounds.
          </p>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          {/* Download CTA */}
          <div className="max-w-3xl mx-auto mb-16">
            <Card className="p-8 bg-white border border-gray-200 shadow-xl text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Stuard AI for Windows</h2>
              <p className="text-gray-600 mb-6">
                Download the latest version and start automating in minutes.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                  href="/api/download?platform=windows"
                  className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-black transition-colors shadow-lg"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 3h8.5v8.5H3V3zm9.5 0H21v8.5h-8.5V3zM3 12.5h8.5V21H3v-8.5zm9.5 0H21V21h-8.5v-8.5z" />
                  </svg>
                  Download for Windows
                </a>
                <Link href="/signup" className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-white text-gray-700 font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
                  Create Free Account
                </Link>
              </div>
              <p className="text-xs text-gray-400 mt-4">
                v1.0 &middot; Windows 10+ (64-bit) &middot; ~120 MB
              </p>
            </Card>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {features.map((feature, index) => (
              <Card key={index} className="p-6 text-center hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mx-auto mb-4">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.description}</p>
              </Card>
            ))}
          </div>

          {/* System Requirements */}
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">
              System Requirements
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <Card className="p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Minimum</h3>
                <ul className="space-y-3">
                  {systemRequirements.minimum.map((req, index) => (
                    <li key={index} className="flex items-center text-gray-700">
                      <svg className="w-5 h-5 text-primary mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-6 border-2 border-primary">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">Recommended</h3>
                  <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded">BEST</span>
                </div>
                <ul className="space-y-3">
                  {systemRequirements.recommended.map((req, index) => (
                    <li key={index} className="flex items-center text-gray-700">
                      <svg className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div className="mt-16 max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
              Quick & Easy Installation
            </h2>
            <Card className="p-8">
              <ol className="space-y-4">
                <li className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-semibold mr-4">
                    1
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Download the installer</h4>
                    <p className="text-gray-600 text-sm">Click the download button above to get the latest version</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-semibold mr-4">
                    2
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Run the installer</h4>
                    <p className="text-gray-600 text-sm">Follow the simple setup wizard</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-semibold mr-4">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-1">Sign in and start</h4>
                    <p className="text-gray-600 text-sm">Press Win+Space to activate your AI assistant</p>
                  </div>
                </li>
              </ol>
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
