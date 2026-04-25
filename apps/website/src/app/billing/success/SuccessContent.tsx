'use client';

import Link from 'next/link';

export default function SuccessContent() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment successful</h1>
        <p className="text-gray-500 mb-8">
          Your credits are being added to your account. It may take a moment to reflect.
        </p>
        <Link
          href="/dashboard/billing"
          className="inline-flex items-center px-5 py-2.5 text-[13px] font-medium text-white bg-gray-900 rounded-lg hover:bg-black transition-colors"
        >
          View your credits
        </Link>
      </div>
    </main>
  );
}
