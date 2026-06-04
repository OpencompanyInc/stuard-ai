import type { Metadata } from 'next';
import { getRequestSiteUrl } from '@/lib/site-url';

const sharedDescription =
  'Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first. Download for Windows; join the waitlist for macOS and Linux.';

const sharedOgDescription =
  'Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first.';

export async function buildRootMetadata(): Promise<Metadata> {
  const baseUrl = await getRequestSiteUrl();

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: 'Stuard — The AI workspace for your PC',
      template: '%s | Stuard',
    },
    description: sharedDescription,
    applicationName: 'Stuard AI',
    appleWebApp: {
      capable: true,
      title: 'Stuard AI',
      statusBarStyle: 'black-translucent',
    },
    keywords: [
      'Stuard AI',
      'desktop AI assistant',
      'private AI assistant',
      'local AI',
      'AI privacy',
      'Windows AI assistant',
      'voice AI assistant',
      'personal AI',
      'AI with memory',
      'secure AI assistant',
      'AI automation',
      'productivity AI',
      'workflow automation',
      'n8n alternative',
      'Zapier alternative',
      'automation platform',
      'AI workflow builder',
      'desktop automation',
      'Windows automation',
      'AI tool builder',
      'custom AI tools',
      'AI marketplace',
      'workflow marketplace',
      'published workflow',
      'download stuard ai',
      'download workflow',
      'automation templates',
      'no-code automation',
      'AI personal assistant',
      'offline AI assistant',
      'steward ai',
      'stuart ai',
      'steward ai assistant',
      'stuart ai assistant',
    ],
    authors: [{ name: 'Stuard AI Team' }],
    creator: 'Stuard AI',
    publisher: 'Stuard AI',
    category: 'Technology',
    alternates: {
      canonical: baseUrl,
    },
    openGraph: {
      title: 'Stuard — The AI workspace for your PC',
      description: sharedOgDescription,
      url: baseUrl,
      siteName: 'Stuard AI',
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: 'Stuard AI Desktop Assistant',
          type: 'image/png',
        },
      ],
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      site: '@stuardai',
      creator: '@stuardai',
      title: 'Stuard — The AI workspace for your PC',
      description: sharedOgDescription,
      images: ['/og-image.png'],
    },
    manifest: '/manifest.json',
    icons: {
      icon: [{ url: '/stuard-mark.png', type: 'image/png' }],
      apple: [{ url: '/stuard-mark.png', type: 'image/png' }],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  };
}
