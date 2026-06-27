import React, {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
} from 'react';
import { clsx } from 'clsx';

const SHIMMER_STYLE_ID = 'stuard-ai-shimmer-keyframes';

function ensureShimmerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SHIMMER_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    @keyframes stuard-ai-text-shimmer {
      0% { background-position: 115% 50%; }
      100% { background-position: -15% 50%; }
    }
    /* Respect reduced-motion: drop the sweep for a calm, static muted label. */
    @media (prefers-reduced-motion: reduce) {
      .stuard-ai-shimmer {
        animation: none !important;
        background: none !important;
        -webkit-text-fill-color: color-mix(in srgb, var(--foreground) 60%, transparent) !important;
        color: color-mix(in srgb, var(--foreground) 60%, transparent) !important;
      }
    }
  `;
  document.head.appendChild(style);
}

type ShimmerOwnProps<T extends ElementType> = {
  as?: T;
  children?: React.ReactNode;
  className?: string;
  duration?: number;
  spread?: number;
};

export type ShimmerProps<T extends ElementType = 'span'> = ShimmerOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof ShimmerOwnProps<T>>;

export function Shimmer<T extends ElementType = 'span'>({
  as,
  children,
  className,
  duration = 2,
  spread = 2,
  style,
  ...props
}: ShimmerProps<T>) {
  ensureShimmerStyles();

  const Component = (as || 'span') as ElementType;
  // Theme-aware + gentle: the label rests at a readable ~52% of the foreground
  // token and the highlight only lifts to ~88% (no hard white flash), so the
  // sweep reads as a soft glide on both light and dark themes rather than a
  // generic high-contrast "AI shimmer".
  const shimmerStyle: CSSProperties = {
    backgroundImage:
      'linear-gradient(100deg,' +
      ' color-mix(in srgb, var(--foreground) 52%, transparent) 32%,' +
      ' color-mix(in srgb, var(--foreground) 88%, transparent) 50%,' +
      ' color-mix(in srgb, var(--foreground) 52%, transparent) 68%)',
    backgroundSize: `${Math.max(170, spread * 100)}% 100%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '115% 50%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    animation: `stuard-ai-text-shimmer ${duration}s linear infinite`,
    willChange: 'background-position',
    ...style,
  };

  return (
    <Component
      className={clsx('stuard-ai-shimmer inline-block align-baseline', className)}
      style={shimmerStyle}
      {...props}
    >
      {children}
    </Component>
  );
}

export default Shimmer;
