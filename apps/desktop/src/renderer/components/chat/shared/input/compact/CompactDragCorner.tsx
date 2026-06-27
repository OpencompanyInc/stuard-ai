import React from 'react';

interface CompactDragCornerProps {
  /** Pointer-down handler that starts the drag-to-expand gesture. */
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /** Visually pop the grip while the user is actively dragging or snapping. */
  active: boolean;
}

const CORNER_POS = { right: -8, bottom: -8, width: 52, height: 52 } as const;

/**
 * Bottom-right drag handle on the compact input pill — a thick red arc
 * hugging the OUTSIDE of the bar's corner that reads as a resize grip.
 *
 * Visual and hit targets are split so clip-path never hides the arc stroke.
 * The hit zone is limited to the exterior wedge so it does not cover the voice button.
 */
export const CompactDragCorner: React.FC<CompactDragCornerProps> = ({
  onPointerDown,
  active,
}) => {
  const transform = active ? 'scale(1.12)' : 'scale(1)';

  return (
    <>
      {/* Full arc — never clipped; does not capture pointer events */}
      <div
        className="no-drag absolute pointer-events-none"
        style={{
          ...CORNER_POS,
          zIndex: 6,
          transform,
          transformOrigin: 'bottom right',
          transition: 'transform 160ms ease-out, filter 160ms ease-out',
          filter: active ? 'brightness(1.15)' : 'none',
        }}
        aria-hidden
      >
        <svg
          width={52}
          height={52}
          viewBox="0 0 52 52"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path
            d="M 47 26 A 21 21 0 0 1 26 47"
            stroke="#FF383C"
            strokeWidth="3"
            strokeLinecap="butt"
            fill="none"
          />
        </svg>
      </div>

      {/* Drag hit wedge — sits under the voice button (z-10) in the pill */}
      <button
        type="button"
        className="no-drag absolute"
        style={{
          ...CORNER_POS,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'nwse-resize',
          zIndex: 5,
          clipPath: 'polygon(100% 50%, 100% 100%, 50% 100%)',
          transform,
          transformOrigin: 'bottom right',
          transition: 'transform 160ms ease-out',
        }}
        onPointerDown={onPointerDown}
        title="Drag to expand"
        aria-label="Drag to expand to window mode"
      />
    </>
  );
};

export default CompactDragCorner;
