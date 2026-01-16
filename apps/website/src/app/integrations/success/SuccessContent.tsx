'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

export default function SuccessContent() {
  const searchParams = useSearchParams();
  const provider = useMemo(() => {
    const p = searchParams.get('provider');
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Integration';
  }, [searchParams]);

  return (
    <main className="min-h-screen pt-28 pb-20">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <div className="mb-6 flex justify-center">
             <svg className="w-16 h-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h1 className="text-3xl font-bold mb-2">{provider} Connected!</h1>
          <p className="text-gray-600 mb-6">
            Your {provider} account has been successfully connected to Stuard.
          </p>
          <div className="mt-6">
            <p className="text-sm text-gray-500">You can close this window and return to the app.</p>
            {/* Optional: Add a button to open the app via deep link if applicable, 
                but usually closing the window or going to dashboard is fine. */}
          </div>
        </div>
      </div>
    </main>
  );
}


