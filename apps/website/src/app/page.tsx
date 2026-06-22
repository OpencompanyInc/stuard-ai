import HeroSection from '@/components/sections/HeroSection';
import DayJourneySection from '@/components/sections/DayJourneySection';
import CompoundsSection from '@/components/sections/CompoundsSection';
import TrustPricingSection from '@/components/sections/TrustPricingSection';
import FAQ from '@/components/sections/FAQ';
import ClosingSection from '@/components/sections/ClosingSection';

export default function Home() {
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Stuard AI',
    alternateName: ['Stuard', 'Steward AI', 'Stuart AI'],
    url: 'https://stuard.ai',
    logo: 'https://stuard.ai/stuard-mark.png',
    description:
      'Stuard is the AI that lives on your PC — local-first chat, workflows, mini-apps, and agents that finish real work on your machine.',
    foundingDate: '2024',
    sameAs: [
      'https://twitter.com/stuardai',
      'https://linkedin.com/company/stuardai',
      'https://github.com/stuardai',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'Customer Support',
      email: 'support@stuard.ai',
    },
  };

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Stuard AI',
    alternateName: ['Stuard', 'Steward AI', 'Stuart AI'],
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Windows 10, Windows 11',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    description:
      'Stuard AI is a personal AI assistant app for Windows. It organizes your files, manages Gmail and Calendar, works your apps, and turns repeated tasks into one-click automations, mini-apps, and scheduled agents — local-first, cloud only when you ask.',
    featureList: [
      'Desktop chat that controls your PC',
      'Visual workflow builder',
      'Community mini-app marketplace',
      'Proactive agents with optional cloud hosting',
      'Local-first privacy',
    ],
    screenshot: 'https://stuard.ai/og-image.png',
    url: 'https://stuard.ai',
    author: {
      '@type': 'Organization',
      name: 'Stuard AI',
      url: 'https://stuard.ai',
    },
  };

  return (
    <>
      <script
        suppressHydrationWarning
        id="org-ld-json"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        suppressHydrationWarning
        id="software-ld-json"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      {/*
        The page is one connected story — a single day of using Stuard:
        1. Hero — the hook + a live compact-mode demo you can type in
        2. DayJourney — 7:55 AM → 11:58 PM, every use case as a moment in the day
        3. Compounds — the payoff: one day's work becomes permanent automation
        4. TrustPricing — the day stayed private and cost nothing
        5. FAQ + Closing — objections answered, then "tomorrow, 7:55 AM"
        Anything deeper redirects out (/how-it-works, /marketplace, /pricing, /privacy).
      */}
      <HeroSection />
      <DayJourneySection />
      <CompoundsSection />
      <TrustPricingSection />
      <FAQ />
      <ClosingSection />
    </>
  );
}
