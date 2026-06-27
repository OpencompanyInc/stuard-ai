
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset Password',
  description: 'Set a new password for your Stuard AI account.',
  openGraph: {
    title: 'Reset Password - Stuard AI',
    description: 'Set a new password for your Stuard AI account.',
    url: 'https://stuard.ai/reset-password',
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

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
