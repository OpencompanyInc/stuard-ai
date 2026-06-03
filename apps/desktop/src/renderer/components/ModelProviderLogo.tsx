import React from 'react';
import { clsx } from 'clsx';

/**
 * Provider logos are treated as monochrome glyphs: dark on light surfaces,
 * white on dark surfaces. Our logo set (LobeHub `currentColor` SVGs + models.dev
 * marks) renders dark by default and is inverted to white in dark mode, so every
 * provider inverts — no color-preserve exceptions (a colored mark would
 * otherwise stay dark and vanish on dark surfaces).
 */
const COLOR_LOGO_PROVIDERS = new Set<string>();

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
  src,
  onError,
  ...props
}: ModelProviderLogoProps) {
  const invert = preserveColors
    ? false
    : invertInDark ?? shouldInvertProviderLogo(providerId);

  // De-branded OpenRouter vendors may point at a models.dev logo that 404s.
  // Hide the element on error so callers show a neutral box instead of the
  // browser's broken-image glyph (the src resets when it changes).
  const [errored, setErrored] = React.useState(false);
  React.useEffect(() => { setErrored(false); }, [src]);

  if (errored) return null;

  return (
    <img
      {...props}
      src={src}
      alt={alt}
      onError={(e) => { setErrored(true); onError?.(e); }}
      className={clsx(
        'model-provider-logo',
        invert && 'model-provider-logo--invert-dark',
        className,
      )}
    />
  );
}
