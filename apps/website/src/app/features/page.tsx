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
    <>
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 overflow-hidden">
                    <Container className="relative text-center">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Intelligent Desktop Automation
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold mb-6 text-gray-900">
              If it&apos;s a chore,<br />
              <span className="text-gradient">let Stuard handle it.</span>
            </h1>
            <p className="text-xl lg:text-2xl mb-8 max-w-3xl mx-auto text-gray-600">
              From simple file cleanup to complex multi-step agentic tasks. Stuard sees your screen, understands your files, and gets the job done.
            </p>
          </Container>
        </section>

        {/* Main Features Showcase */}
        <FeaturesShowcase />
    </>
  );
} 
