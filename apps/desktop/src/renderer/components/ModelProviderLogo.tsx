import React from 'react';
import { clsx } from 'clsx';

/** Providers with full-color logos that should stay native in dark mode. */
const COLOR_LOGO_PROVIDERS = new Set(['google']);

export function shouldInvertProviderLogo(providerId?: string): boolean {
  if (!providerId) return true;
  return !COLOR_LOGO_PROVIDERS.has(providerId.toLowerCase());
}

type ModelProviderLogoProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  providerId?: string;
  /** Force white/inverted rendering in dark mode. */
  invertInDark?: boolean;
  /** Keep original logo colors in dark mode. */
  preserveColors?: boolean;
};

export function ModelProviderLogo({
  providerId,
  invertInDark,
  preserveColors,
  className,
  alt = '',
  ...props
}: ModelProviderLogoProps) {
  const invert = preserveColors
    ? false
    : invertInDark ?? shouldInvertProviderLogo(providerId);

  return (
    <img
      {...props}
      alt={alt}
      className={clsx(
        'model-provider-logo',
        invert && 'model-provider-logo--invert-dark',
        className,
      )}
    />
  );
}
