import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import {
  getActiveBrandKey,
  uniqueBrands,
  type ToolCallLike,
} from '../../../../utils/toolBrand';

interface ToolBrandStackProps {
  toolCalls: readonly ToolCallLike[];
  /** Maximum visible logo circles before collapsing to a "+N" overflow chip. */
  maxVisible?: number;
  /** Overlap icons horizontally like an avatar stack. */
  overlap?: boolean;
  size?: 'sm' | 'md';
  /** Brand key for the currently active tool — gets a highlight ring. */
  activeBrandKey?: string | null;
}

const SIZE = {
  sm: { outer: 20, inner: 13, logo: 11, icon: 11, overlap: -7, ring: 1.5 },
  md: { outer: 28, inner: 22, logo: 16, icon: 14, overlap: -9, ring: 2 },
} as const;

/**
 * Horizontal stack of brand-logo icons representing integrations touched by
 * the current response. Icons accumulate and overlap; the active tool gets
 * a primary-colored ring.
 */
export const ToolBrandStack: React.FC<ToolBrandStackProps> = ({
  toolCalls,
  maxVisible = 5,
  overlap = false,
  size = 'md',
  activeBrandKey: activeBrandKeyProp,
}) => {
  const names = toolCalls.map((t) => t.tool);
  const brands = uniqueBrands(names);
  const activeBrandKey = activeBrandKeyProp ?? getActiveBrandKey(toolCalls);

  if (brands.length === 0) return null;

  const visible = brands.slice(0, maxVisible);
  const overflow = brands.length - visible.length;
  const dim = SIZE[size];

  return (
    <div
      className={clsx(
        'flex items-center flex-shrink-0',
        overlap ? 'pl-0.5' : 'gap-1.5',
      )}
    >
      <AnimatePresence initial={false}>
        {visible.map((brand, index) => {
          const isActive = brand.key === activeBrandKey;
          return (
            <motion.span
              key={brand.key}
              layout
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              title={brand.label}
              className={clsx(
                'relative flex items-center justify-center flex-shrink-0 rounded-full overflow-hidden',
                isActive && 'ring-primary',
              )}
              style={{
                width: dim.outer,
                height: dim.outer,
                marginLeft: overlap && index > 0 ? dim.overlap : 0,
                zIndex: index + 1,
                background: 'color-mix(in srgb, var(--foreground) 8%, var(--card-bg) 92%)',
                boxShadow: isActive
                  ? `0 0 0 ${dim.ring}px var(--primary)`
                  : '0 0 0 1px color-mix(in srgb, var(--foreground) 6%, transparent)',
              }}
            >
              {brand.logo ? (
                <img
                  src={brand.logo}
                  alt={brand.label}
                  className="object-contain select-none"
                  draggable={false}
                  style={{ width: dim.logo, height: dim.logo }}
                />
              ) : brand.icon ? (
                <brand.icon
                  style={{ width: dim.icon, height: dim.icon, color: brand.color || 'var(--foreground)' }}
                  strokeWidth={2}
                />
              ) : null}
            </motion.span>
          );
        })}
        {overflow > 0 && (
          <motion.span
            key="overflow"
            layout
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            className="relative flex items-center justify-center flex-shrink-0 rounded-full font-bold text-theme-muted"
            style={{
              width: dim.outer,
              height: dim.outer,
              marginLeft: overlap ? dim.overlap : 0,
              zIndex: visible.length + 1,
              fontSize: size === 'sm' ? 9 : 10,
              background: 'color-mix(in srgb, var(--foreground) 8%, var(--card-bg) 92%)',
              boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 6%, transparent)',
            }}
            title={`+${overflow} more`}
          >
            +{overflow}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ToolBrandStack;
