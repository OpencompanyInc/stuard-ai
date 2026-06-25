import React from 'react';
import { Box, Globe, Mail, Phone, Puzzle, ScanFace, Table, Terminal, Webhook } from 'lucide-react';
import { clsx } from 'clsx';

import { IntegrationLogo } from './IntegrationLogo';
import { faviconUrlFor } from '../utils/integrationLogoSources';

import discordLogo from '../assets/integrations/Discord.svg';
import elevenLabsLogo from '../assets/integrations/ElevenLabs.svg';
import ffmpegLogo from '../assets/integrations/FFmpeg.svg';
import facebookLogo from '../assets/integrations/Facebook.svg';
import githubBrandLogo from '../assets/integrations/GitHub.svg';
import gmailLogo from '../assets/integrations/Gmail.svg';
import googleCalendarLogo from '../assets/integrations/GoogleCalendar.svg';
import googleDocsLogo from '../assets/integrations/GoogleDocs.svg';
import googleDriveLogo from '../assets/integrations/GoogleDrive.svg';
import googleSheetsLogo from '../assets/integrations/GoogleSheets.svg';
import googleTasksLogo from '../assets/integrations/GoogleTasks.svg';
import instagramLogo from '../assets/integrations/Instagram.svg';
import ollamaLogo from '../assets/integrations/Ollama.svg';
import pythonLogo from '../assets/integrations/Python.svg';
import redditLogo from '../assets/integrations/Reddit.svg';
import supabaseLogo from '../assets/integrations/Supabase.svg';
import threadsLogo from '../assets/integrations/Threads.svg';
import whatsappLogo from '../assets/integrations/WhatsApp.svg';
import xLogo from '../assets/integrations/X.svg';
import youtubeLogo from '../assets/integrations/YouTube.svg';

export const BRAND_LOGOS: Record<string, string> = {
  python: pythonLogo,
  ffmpeg: ffmpegLogo,
  ollama: ollamaLogo,
  github: githubBrandLogo,
  discord: discordLogo,
  reddit: redditLogo,
  x: xLogo,
  facebook: facebookLogo,
  instagram: instagramLogo,
  threads: threadsLogo,
  whatsapp: whatsappLogo,
  youtube: youtubeLogo,
  supabase: supabaseLogo,
  elevenlabs: elevenLabsLogo,
  gmail: gmailLogo,
  'google-drive': googleDriveLogo,
  'google-calendar': googleCalendarLogo,
  'google-docs': googleDocsLogo,
  'google-sheets': googleSheetsLogo,
  'google-tasks': googleTasksLogo,
};

let brandLogosPreloaded = false;

/** Warm bundled logos once when Connected Apps is opened. */
export function preloadIntegrationBrandLogos(): void {
  if (brandLogosPreloaded) return;
  brandLogosPreloaded = true;
  try {
    for (const src of Object.values(BRAND_LOGOS)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  } catch {}
}

export function hasBrandLogo(slug: string): boolean {
  return slug in BRAND_LOGOS;
}

function LucideFallback({ slug, className }: { slug: string; className: string }) {
  switch (slug) {
    case 'mediapipe':
      return <ScanFace className={className} strokeWidth={1.25} />;
    case 'data-analysis':
      return <Table className={className} strokeWidth={1.25} />;
    case 'agent-cli':
      return <Terminal className={className} strokeWidth={1.25} />;
    case 'browser':
    case 'browser-use':
      return <Globe className={className} strokeWidth={1.25} />;
    case 'browser-extension':
      return <Puzzle className={className} strokeWidth={1.25} />;
    case 'webhooks':
      return <Webhook className={className} strokeWidth={1.25} />;
    case 'outlook':
      return <Mail className={className} strokeWidth={1.25} />;
    case 'telnyx':
      return <Phone className={className} strokeWidth={1.25} />;
    default:
      return <Box className={className} strokeWidth={1.25} />;
  }
}

export const IntegrationBrandIcon = React.memo(function IntegrationBrandIcon({
  slug,
  className = 'w-5 h-5',
}: {
  slug: string;
  className?: string;
}) {
  const src = BRAND_LOGOS[slug];
  const hasRemote = faviconUrlFor(slug) != null;
  if (!src && !hasRemote) {
    return <LucideFallback slug={slug} className={className} />;
  }
  return (
    <IntegrationLogo
      logoKey={slug}
      fallbackSrc={src}
      className={clsx(className, 'shrink-0')}
    />
  );
});

export function getIntegrationIcon(slug: string, size = 'w-5 h-5') {
  return <IntegrationBrandIcon slug={slug} className={size} />;
}
