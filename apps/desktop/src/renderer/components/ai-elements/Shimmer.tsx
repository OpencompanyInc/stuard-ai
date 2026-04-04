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
      0% { background-position: 120% 50%; }
      100% { background-position: -20% 50%; }
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
  const shimmerStyle: CSSProperties = {
    backgroundImage:
      'linear-gradient(110deg, rgba(120,130,150,0.55) 20%, rgba(255,255,255,0.98) 50%, rgba(120,130,150,0.55) 80%)',
    backgroundSize: `${Math.max(180, spread * 110)}% 100%`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '120% 50%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    animation: `stuard-ai-text-shimmer ${duration}s linear infinite`,
    ...style,
  };

  return (
    <Component
      className={clsx('inline-block align-baseline', className)}
      style={shimmerStyle}
      {...props}
    >
      {children}
    </Component>
  );
}

export default Shimmer;
