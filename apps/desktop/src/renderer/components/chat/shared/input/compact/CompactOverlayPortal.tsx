import React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

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
      <div className={clsx('pointer-events-auto', widthClassName)} data-compact-hit-area="true">
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default CompactOverlayPortal;
