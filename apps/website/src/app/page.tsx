import HeroSection from '@/components/sections/HeroSection';
import FeatureScrollSection from '@/components/sections/FeatureScrollSection';

export default function Home() {
  // Organization Schema for Google Knowledge Graph
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Stuard AI',
    alternateName: ['Stuard', 'Steward AI', 'Stuart AI'],
    url: 'https://stuard.ai',
    logo: 'https://stuard.ai/icon.svg',
    description: 'A local-first desktop AI assistant that builds tools and automates workflows while keeping your data private.',
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

  // Software Application Schema
  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Stuard AI',
    alternateName: ['Stuard', 'Steward AI', 'Stuart AI'],
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Windows 10, Windows 11, macOS, Linux',
    offers: {
      '@type': 'Offer',
      price: '35',
      priceCurrency: 'USD',
      priceValidUntil: '2025-12-31',
      availability: 'https://schema.org/PreOrder',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '150',
    },
    description: "Stuard is a local-first desktop assistant that handles computer chores, builds tools, and automates workflows while keeping your data private. It combines the ease of a chatbot with the power of automation.",
    featureList: [
      'Real desktop automation (clicks, typing, file access)',
      'Visual workflow builder for custom tools',
      'Sticky memory that learns your preferences',
      'Local-first privacy and data storage',
      'Works with any app or API',
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
      <div id="waitlist">
        <HeroSection />
      </div>
      <FeatureScrollSection />
    </>
  );
}
