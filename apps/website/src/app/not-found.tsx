import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page Not Found',
  description: 'The page you are looking for does not exist.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0B] px-4 text-white">
      <div className="max-w-xl w-full text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF383C] to-[#D31519]">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white">Page not found</h1>
        <p className="mt-2 text-[#A3A3A3]">The page you are looking for doesn’t exist or has been moved.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link href="/">
            <Button>Go home</Button>
          </Link>
          <Link href="/blog">
            <Button variant="outline">Visit the blog</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}








