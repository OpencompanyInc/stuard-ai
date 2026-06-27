import type { Metadata } from 'next';
import HowItWorksPageContent from './HowItWorksPageContent';

export const metadata: Metadata = {
  title: 'How It Works',
  description:
    'Stuard connects your apps, files, tabs, and workflows into one intelligent command center.',
  openGraph: {
    title: 'How It Works - Stuard AI',
    description:
      'Everything you need to work faster. Stuard unifies your apps, files, tabs, and workflows.',
    url: 'https://stuard.ai/how-it-works',
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

export default function HowItWorksPage() {
  return <HowItWorksPageContent />;
}
