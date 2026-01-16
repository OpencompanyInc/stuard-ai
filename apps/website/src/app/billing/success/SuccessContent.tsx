'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import Link from 'next/link';

export default function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = useMemo(() => searchParams.get('session_id'), [searchParams]);

  return (
    <main className="min-h-screen pt-28 pb-20">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow p-8">
          <h1 className="text-3xl font-bold mb-2">Thanks for subscribing!</h1>
          <p className="text-gray-600 mb-6">Your subscription is being activated. You will receive an email confirmation shortly.</p>
          {sessionId && (
            <p className="text-xs text-gray-500">Session: {sessionId}</p>
          )}
          <div className="mt-6">
            <Link href="/" className="text-primary font-semibold">Go to dashboard</Link>
          </div>
        </div>
      </div>
    </main>
  );
}









