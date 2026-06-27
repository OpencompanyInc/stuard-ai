import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/components/providers/AuthProvider';
import LayoutShell from '@/components/layout/LayoutShell';
import WebsiteStructuredData from '@/components/seo/WebsiteStructuredData';
import { buildRootMetadata } from '@/lib/site-metadata';

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

export async function generateMetadata(): Promise<Metadata> {
  return buildRootMetadata();
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontPrimary.variable} ${fontSerif.variable}`}>
      <head>
        <meta name="referrer" content="no-referrer" />
        {/* General Sans (hero display font) — Fontshare is its official free CDN */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap"
        />
        <link rel="apple-touch-icon" href="/stuard-mark.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0A0A0B" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <WebsiteStructuredData />
      </head>
      <body className="antialiased min-h-screen text-[#F5F5F5] font-sans">
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
