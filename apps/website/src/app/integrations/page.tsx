import type { Metadata } from 'next';
import IntegrationsPageContent from './IntegrationsPageContent';

export const metadata: Metadata = {
  title: 'Integrations',
  description:
    'Plug Stuard into Gmail, Drive, GitHub, Slack, Calendar, and the apps already on your PC. OAuth where it has to be — local everywhere else.',
  openGraph: {
    title: 'Integrations — Stuard AI',
    description:
      'Plug Stuard into Gmail, Drive, GitHub, Slack, Calendar, and the apps already on your PC.',
    url: 'https://stuard.ai/integrations',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Stuard AI',
      },
    ],
  },
  alternates: {
    canonical: 'https://stuard.ai/integrations',
  },
};

export default function IntegrationsPage() {
  return <IntegrationsPageContent />;
}
