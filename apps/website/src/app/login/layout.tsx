
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in to your Stuard AI account to manage your subscription and settings.',
  openGraph: {
    title: 'Sign In - Stuard AI',
    description: 'Sign in to your Stuard AI account.',
    url: 'https://stuard.ai/login',
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
