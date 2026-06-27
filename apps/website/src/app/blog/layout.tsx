
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Insights, updates, and articles about Stuard AI, local-first automation, and privacy technology.',
  openGraph: {
    title: 'Blog - Stuard AI',
    description: 'Insights, updates, and articles about Stuard AI, local-first automation, and privacy technology.',
    url: 'https://stuard.ai/blog',
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

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
