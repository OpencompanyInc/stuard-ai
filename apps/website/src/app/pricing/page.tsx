import type { Metadata } from 'next';
import PricingPageContent from './PricingPageContent';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple pricing for smarter workflows. Start free, upgrade when you’re ready, and unlock more powerful AI workflows as your productivity grows.',
  openGraph: {
    title: 'Pricing - Stuard AI',
    description:
      'Pay what you want. Start free, scale as you grow. Larger amounts unlock better credit rates.',
    url: 'https://stuard.ai/pricing',
  },
};

export default function PricingPage() {
  return <PricingPageContent />;
}
