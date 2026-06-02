"use client";

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0A0B] px-4 text-white">
      <div className="max-w-xl w-full text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF383C] to-[#D31519]">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white">Something went wrong</h1>
        <p className="mt-2 text-[#A3A3A3]">An unexpected error occurred. Please try again.</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={() => reset()}>Try again</Button>
          <Link href="/">
            <Button variant="outline">Go home</Button>
          </Link>
        </div>
        {error?.digest && (
          <p className="mt-4 text-xs text-[#737373]">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  );
}








