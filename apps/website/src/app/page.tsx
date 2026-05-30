import HeroSection from '@/components/sections/HeroSection';
import BeyondTheChatSection from '@/components/sections/BeyondTheChatSection';
import ConnectedAppsSection from '@/components/sections/ConnectedAppsSection';
import HowItWorksIntroSection from '@/components/sections/HowItWorksIntroSection';
import MarketplacePromoSection from '@/components/sections/MarketplacePromoSection';
import CloudAgentsSection from '@/components/sections/CloudAgentsSection';
import PrivacySection from '@/components/sections/PrivacySection';
import PricingSection from '@/components/sections/PricingSection';
import ClosingCTASection from '@/components/sections/ClosingCTASection';

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
      priceValidUntil: '2026-12-31',
      availability: 'https://schema.org/InStock',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '150',
    },
    description:
      'Stuard lives on your PC, not in a tab. Local-first assistant for files, apps, workflows, mini-apps, and proactive agents — cloud only when you ask.',
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
      <HeroSection />
      <BeyondTheChatSection />
      <ConnectedAppsSection />
      <HowItWorksIntroSection />
      <MarketplacePromoSection />
      <CloudAgentsSection />
      <PrivacySection />
      <PricingSection />
      <ClosingCTASection />
    </>
  );
}
