'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export default function ErrorContent() {
  const searchParams = useSearchParams();
  const provider = useMemo(() => {
    const p = searchParams.get('provider');
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Integration';
  }, [searchParams]);
  const message = useMemo(() => searchParams.get('message') || 'An unknown error occurred.', [searchParams]);

  return (
    <main className="min-h-screen pt-28 pb-20">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <div className="mb-6 flex justify-center">
             <svg className="w-16 h-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </div>
          <h1 className="text-3xl font-bold mb-2">{provider} Connection Failed</h1>
          <p className="text-gray-600 mb-6">
            {message}
          </p>
          <div className="mt-6">
             <p className="text-sm text-gray-500">Please try again or contact support.</p>
          </div>
        </div>
      </div>
    </main>
  );
}


