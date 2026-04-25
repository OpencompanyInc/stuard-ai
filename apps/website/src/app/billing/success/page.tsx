import { Suspense } from 'react';
import SuccessContent from './SuccessContent';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment Successful',
  description: 'Thank you for your purchase.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<main className="min-h-screen pt-28 pb-20" />}>
      <SuccessContent />
    </Suspense>
  );
}


