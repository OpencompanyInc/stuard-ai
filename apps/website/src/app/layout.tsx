import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/components/providers/AuthProvider';
import LayoutShell from '@/components/layout/LayoutShell';

const fontPrimary = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fontSerif = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const baseUrl = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000'
  : 'https://stuard.ai';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Stuard — The AI workspace for your PC",
    template: "%s | Stuard",
  },
  description:
    "Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first. Download for Windows; join the waitlist for macOS and Linux.",
  applicationName: "Stuard AI",
  appleWebApp: {
    capable: true,
    title: "Stuard AI",
    statusBarStyle: "black-translucent",
  },
  keywords: [
    "Stuard AI",
    "desktop AI assistant",
    "private AI assistant",
    "local AI",
    "AI privacy",
    "Windows AI assistant",
    "voice AI assistant",
    "personal AI",
    "AI with memory",
    "secure AI assistant",
    "AI automation",
    "productivity AI",
    "workflow automation",
    "n8n alternative",
    "Zapier alternative",
    "automation platform",
    "AI workflow builder",
    "desktop automation",
    "Windows automation",
    "AI tool builder",
    "custom AI tools",
    "AI marketplace",
    "workflow marketplace",
    "published workflow",
    "download stuard ai",
    "download workflow",
    "automation templates",
    "no-code automation",
    "AI personal assistant",
    "offline AI assistant",
    "steward ai",
    "stuart ai",
    "steward ai assistant",
    "stuart ai assistant"
  ],
  authors: [{ name: "Stuard AI Team" }],
  creator: "Stuard AI",
  publisher: "Stuard AI",
  category: "Technology",
  alternates: {
    canonical: baseUrl,
  },
  openGraph: {
    title: "Stuard — The AI workspace for your PC",
    description:
      "Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first.",
    url: baseUrl,
    siteName: "Stuard AI",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Stuard AI Desktop Assistant",
        type: "image/png",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@stuardai",
    creator: "@stuardai",
    title: "Stuard — The AI workspace for your PC",
    description:
      "Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first.",
    images: ["/og-image.png"],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontPrimary.variable} ${fontSerif.variable}`}>
      <head>
        <meta name="referrer" content="no-referrer" />
        <link rel="apple-touch-icon" href="/stuard-mark.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F3F1EB" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        {/* SEO: Structured data for preferred site name */}
        <script
          suppressHydrationWarning
          id="website-ld-json"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              "name": "Stuard AI",
              "url": baseUrl,
              "alternateName": ["Stuard", "Steward AI", "Stuart AI"],
              "description": "Stuard turns your PC into an AI workspace — chat, workflows, mini-apps, and agents, all local-first.",
              "potentialAction": {
                "@type": "SearchAction",
                "target": {
                  "@type": "EntryPoint",
                  "urlTemplate": `${baseUrl}/marketplace?q={search_term_string}`
                },
                "query-input": "required name=search_term_string"
              },
              "publisher": {
                "@type": "Organization",
                "name": "Stuard AI",
                "logo": {
                  "@type": "ImageObject",
                  "url": `${baseUrl}/stuard-mark.png`
                }
              }
            })
          }}
        />
      </head>
      <body className="antialiased min-h-screen text-gray-900 font-sans">
        <AuthProvider>
          <div className="relative min-h-screen">
            <LayoutShell>
              {children}
            </LayoutShell>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
