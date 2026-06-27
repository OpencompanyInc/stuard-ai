import React from 'react';
import { clsx } from 'clsx';

import { faviconUrlFor } from '../utils/integrationLogoSources';

interface IntegrationLogoProps {
  /** Integration slug or tool-pill brand key (used to resolve the live favicon). */
  logoKey: string;
  /** Bundled SVG/PNG — curated vector mark; always preferred when present. */
  fallbackSrc?: string;
  /** Sizing classes for the img. */
  className?: string;
  /** Inline sizing for the img (e.g. fixed px width/height). */
  style?: React.CSSProperties;
  alt?: string;
  /** Favicon pixel size to request from the service. */
  size?: number;
}

/**
 * Renders a brand logo.
 *
 * Bundled assets win whenever we have one — they're hand-curated vector marks
 * (and Google's favicon service only returns a generic "G" for the Workspace
 * sub-domains, so favicons there are a downgrade). The live favicon is used
 * only to fill gaps for apps we don't bundle (Notion, Slack, Outlook, …), where
 * Chromium's disk HTTP cache handles "fetch once, refresh only when it changes".
 */
export const IntegrationLogo = React.memo(function IntegrationLogo({
  logoKey,
  fallbackSrc,
  className,
  style,
  alt = '',
  size = 128,
}: IntegrationLogoProps) {
  const src = fallbackSrc ?? faviconUrlFor(logoKey, size) ?? undefined;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={clsx('object-contain select-none', className)}
      style={style}
      draggable={false}
      decoding="async"
    />
  );
});

export default IntegrationLogo;
