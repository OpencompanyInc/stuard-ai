import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Suspense } from 'react';
import ErrorContent from './ErrorContent';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Integration Failed',
  description: 'Failed to connect to third-party service.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function IntegrationErrorPage() {
  return (
    <>
      <Header />
      <Suspense fallback={<main className="min-h-screen pt-28 pb-20"/>}>
        <ErrorContent />
      </Suspense>
      <Footer />
    </>
  );
}


