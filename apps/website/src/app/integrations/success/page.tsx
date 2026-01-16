import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Suspense } from 'react';
import SuccessContent from './SuccessContent';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Integration Connected',
  description: 'Successfully connected to third-party service.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function IntegrationSuccessPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<main className="min-h-screen pt-28 pb-20"/>}>
        <SuccessContent />
      </Suspense>
      <Footer />
    </>
  );
}


