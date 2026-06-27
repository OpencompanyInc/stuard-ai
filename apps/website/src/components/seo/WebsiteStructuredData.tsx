import { getRequestSiteUrl } from '@/lib/site-url';

export default async function WebsiteStructuredData() {
  const baseUrl = await getRequestSiteUrl();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Stuard AI',
    url: baseUrl,
    alternateName: ['Stuard', 'Steward AI', 'Stuart AI'],
    description:
      'Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/marketplace?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Stuard AI',
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/stuard-mark.png`,
      },
    },
  };

  return (
    <script
      suppressHydrationWarning
      id="website-ld-json"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
