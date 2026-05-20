'use client';

import { useEffect } from 'react';
import HowItWorksIntroSection from '@/components/sections/HowItWorksIntroSection';

export default function HowItWorksPageContent() {
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return <HowItWorksIntroSection />;
}
