
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify Email',
  description: 'Verify your email address to complete your Stuard AI account registration.',
  openGraph: {
    title: 'Verify Email - Stuard AI',
    description: 'Verify your email address.',
    url: 'https://stuard.ai/verify-email',
  },
};

export default function VerifyEmailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
