
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot Password',
  description: 'Reset your Stuard AI account password.',
  openGraph: {
    title: 'Forgot Password - Stuard AI',
    description: 'Reset your Stuard AI account password.',
    url: 'https://stuard.ai/forgot-password',
  },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
