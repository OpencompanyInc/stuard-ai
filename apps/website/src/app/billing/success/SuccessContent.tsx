'use client';

import Link from 'next/link';

export default function SuccessContent() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0A0A0B] px-4 text-white">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Payment successful</h1>
        <p className="text-[#A3A3A3] mb-8">
          Your credits are being added to your account. It may take a moment to reflect.
        </p>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center px-5 py-2.5 text-[13px] font-medium text-[#0A0A0B] bg-white rounded-lg hover:bg-white/90 transition-colors"
        >
          View your credits
        </Link>
      </div>
    </main>
  );
}
