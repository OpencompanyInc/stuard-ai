import type { CSSProperties } from 'react';

/** Shared layout tokens for compact search / file-nav / response overlays. */
export const COMPACT_DROPDOWN_MAX_HEIGHT = 560;
export const COMPACT_OVERLAY_DROPDOWN_GAP = 8;
export const COMPACT_WINDOW_DROPDOWN_MARGIN = 32;
export const COMPACT_OVERLAY_WIDTH_CLASS = 'w-[96%] max-w-[560px]';
export const COMPACT_OVERLAY_Z = 100000;

export type CompactOverlayPlacement = 'top' | 'bottom';

/** Resize anchor passed to overlay:resize — opposite of dropdown placement. */
export function compactWindowResizeAnchor(
  placement: CompactOverlayPlacement,
): 'top' | 'bottom' {
  return placement === 'top' ? 'bottom' : 'top';
}

/** Fixed positioning for portaled dropdowns (full-width wrapper + centered panel). */
export function compactOverlayWrapperStyle(
  placement: CompactOverlayPlacement,
  inputBarHeight: number,
): CSSProperties {
  return placement === 'top'
    ? { bottom: inputBarHeight, top: 'auto', left: 0, right: 0 }
    : {
        top: Math.max(0, inputBarHeight - COMPACT_OVERLAY_DROPDOWN_GAP),
        bottom: 'auto',
        left: 0,
        right: 0,
      };
}
