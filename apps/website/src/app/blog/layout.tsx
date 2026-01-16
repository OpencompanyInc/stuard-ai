
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Insights, updates, and articles about Stuard AI, local-first automation, and privacy technology.',
  openGraph: {
    title: 'Blog - Stuard AI',
    description: 'Insights, updates, and articles about Stuard AI, local-first automation, and privacy technology.',
    url: 'https://stuard.ai/blog',
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
