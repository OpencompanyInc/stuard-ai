'use client';

import { useEffect } from 'react';

import PricingSection from '@/components/sections/PricingSection';

export default function PricingPageContent() {
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <div className="pt-16 sm:pt-20 lg:pt-24">
      <PricingSection />
    </div>
  );
}
