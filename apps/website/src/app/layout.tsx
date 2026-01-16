import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/components/providers/AuthProvider';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

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
    default: "Stuard AI - Your Private Desktop Assistant",
    template: "%s | Stuard AI",
  },
  description: "Stuard is a local-first desktop assistant that handles computer chores, builds tools, and automates workflows while keeping your data private.",
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
    "AI waitlist",
    "early access AI",
    "steward ai",
    "stuart ai",
    "steward ai assistant",
    "stuart ai assistant",
    "steward",
    "stuart"
  ],
  authors: [{ name: "Stuard AI Team" }],
  creator: "Stuard AI",
  publisher: "Stuard AI",
  category: "Technology",
  alternates: {
    canonical: baseUrl,
  },
  openGraph: {
    title: "Stuard AI - Your Private Desktop Assistant",
    description: "Stuard is a local-first desktop assistant that handles computer chores, builds tools, and automates workflows while keeping your data private.",
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
    title: "Stuard AI - Your Private Desktop Assistant",
    description: "Stuard is a local-first desktop assistant that handles computer chores, builds tools, and automates workflows while keeping your data private.",
    images: ["/og-image.png"],
  },
  manifest: '/manifest.json',
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
    <html lang="en" className={`scroll-smooth ${fontPrimary.variable} ${fontSerif.variable}`}>
      <head>
        <meta name="referrer" content="no-referrer" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
              "alternateName": ["Stuard", "Steward AI", "Stuart AI"]
            })
          }}
        />
      </head>
      <body className="antialiased min-h-screen text-gray-900 font-sans">
        {/* Grid fade overlay - controlled by HeroSection via body.grid-faded class */}
        <div className="relative z-10">
          <div className="bg-[#007AFF] text-white text-center py-2 text-sm font-medium">
            🚀 Stuard Beta is here!!!
          </div>
          <AuthProvider>
            <div className="flex flex-col min-h-screen">
              <Header />
              <main id="main" className="flex-1 pt-16 lg:pt-20">
                {children}
              </main>
              <Footer />
            </div>
          </AuthProvider>
        </div>
      </body>
    </html>
  );
}
