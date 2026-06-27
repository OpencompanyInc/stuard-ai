import { Container } from '@/components/ui/Container';
import FeaturesShowcase from '@/components/sections/FeaturesShowcase';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Explore Stuard AI features: desktop automation, smart file operations, visual workflow builder, and durable memory. Local-first and privacy-focused.',
  openGraph: {
    title: 'Features - Stuard AI',
    description: 'Explore Stuard AI features: desktop automation, smart file operations, visual workflow builder, and durable memory.',
    url: 'https://stuard.ai/features',
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

export default function FeaturesPage() {
  return (
    <div className="bg-[#0A0A0B] text-white">
        {/* Hero Section */}
        <section className="relative overflow-hidden pb-20 pt-32">
                    <Container className="relative text-center">
            <div className="mb-6 inline-flex items-center rounded-full border border-[#FF383C]/20 bg-[#FF383C]/10 px-4 py-2 text-sm font-medium text-[#FF6B6E]">
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Intelligent Desktop Automation
            </div>
            <h1 className="mb-6 text-4xl font-bold text-white lg:text-6xl">
              If it&apos;s a chore,<br />
              <span className="text-[#FF383C]">let Stuard handle it.</span>
            </h1>
            <p className="mx-auto mb-8 max-w-3xl text-xl text-[#A3A3A3] lg:text-2xl">
              From simple file cleanup to complex multi-step agentic tasks. Stuard sees your screen, understands your files, and gets the job done.
            </p>
          </Container>
        </section>

        {/* Main Features Showcase */}
        <FeaturesShowcase />
    </div>
  );
} 
