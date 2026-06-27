
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to your Stuard AI account to manage your subscription and settings.',
  openGraph: {
    title: 'Sign In - Stuard AI',
    description: 'Sign in to your Stuard AI account.',
    url: 'https://stuard.ai/login',
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

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
