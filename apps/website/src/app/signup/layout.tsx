
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign Up',
  description: 'Create a Stuard AI account to get started with local-first desktop automation.',
  openGraph: {
    title: 'Sign Up - Stuard AI',
    description: 'Create a Stuard AI account to get started.',
    url: 'https://stuard.ai/signup',
  },
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
