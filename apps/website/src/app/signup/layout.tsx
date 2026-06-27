
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create a Stuard AI account to get started with local-first desktop automation.',
  openGraph: {
    title: 'Sign Up - Stuard AI',
    description: 'Create a Stuard AI account to get started.',
    url: 'https://stuard.ai/signup',
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

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
