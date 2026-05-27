import { useCallback, useState } from "react";

export const INTERNAL_SIDEBAR_WIDTH_DEFAULT = 304;
export const INTERNAL_SIDEBAR_WIDTH_MIN = 240;
export const INTERNAL_SIDEBAR_WIDTH_MAX = 560;
const LS_KEY = "chat.internalSidebarWidth";

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const n = raw ? Number(raw) : INTERNAL_SIDEBAR_WIDTH_DEFAULT;
    if (!Number.isFinite(n)) return INTERNAL_SIDEBAR_WIDTH_DEFAULT;
    return Math.max(
      INTERNAL_SIDEBAR_WIDTH_MIN,
      Math.min(INTERNAL_SIDEBAR_WIDTH_MAX, n),
    );
  } catch {
    return INTERNAL_SIDEBAR_WIDTH_DEFAULT;
  }
}

function clampWidth(width: number): number {
  return Math.max(
    INTERNAL_SIDEBAR_WIDTH_MIN,
    Math.min(INTERNAL_SIDEBAR_WIDTH_MAX, width),
  );
}

export function useInternalSidebarWidth() {
  const [width, setWidthState] = useState(readStoredWidth);

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(LS_KEY, String(clamped));
    } catch {
      // no-op
    }
    return clamped;
  }, []);

  const applyResizeDelta = useCallback(
    (delta: number) => {
      setWidthState((prev) => {
        const next = clampWidth(prev + delta);
        if (next === prev) return prev;
        try {
          window.localStorage.setItem(LS_KEY, String(next));
        } catch {
          // no-op
        }
        return next;
      });
    },
    [],
  );

  return { width, setWidth, applyResizeDelta };
}
