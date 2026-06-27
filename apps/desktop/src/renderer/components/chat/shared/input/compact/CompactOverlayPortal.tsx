import React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

import {
  COMPACT_OVERLAY_WIDTH_CLASS,
  COMPACT_OVERLAY_Z,
  compactOverlayWrapperStyle,
  type CompactOverlayPlacement,
} from './compactOverlayLayout';

interface CompactOverlayPortalProps {
  placement: CompactOverlayPlacement;
  inputBarHeight: number;
  widthClassName?: string;
  children: React.ReactNode;
}

/**
 * Portaled compact overlay — centered horizontally, anchored to the input bar
 * edge using the same math for search, file nav, and related dropdowns.
 */
export const CompactOverlayPortal: React.FC<CompactOverlayPortalProps> = ({
  placement,
  inputBarHeight,
  widthClassName = COMPACT_OVERLAY_WIDTH_CLASS,
  children,
}) => {
  if (typeof document === 'undefined' || !document.body) return null;

  return createPortal(
    <div
      className="fixed flex justify-center pointer-events-none"
      style={{
        ...compactOverlayWrapperStyle(placement, inputBarHeight),
        zIndex: COMPACT_OVERLAY_Z,
      }}
    >
      {/* Keyed on placement so a top↔bottom flip re-runs the entrance: the panel
          eases in from the bar on the new side instead of hard-cutting. The bar
          itself stays put across a flip, so animating just the dropdown is what
          makes the swap read as smooth rather than a teleport. */}
      <motion.div
        key={placement}
        initial={{ opacity: 0, y: placement === 'top' ? 14 : -14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={clsx('pointer-events-auto', widthClassName)}
        data-compact-hit-area="true"
        data-compact-overlay-panel="true"
      >
        {children}
      </motion.div>
    </div>,
    document.body,
  );
};

export default CompactOverlayPortal;
