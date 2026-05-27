
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot Password',
  description: 'Reset your Stuard AI account password.',
  openGraph: {
    title: 'Forgot Password - Stuard AI',
    description: 'Reset your Stuard AI account password.',
    url: 'https://stuard.ai/forgot-password',
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

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
