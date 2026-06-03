/**
 * Smooth, cursor-anchored canvas zoom for the workflow editor.
 *
 * - Wheel / pinch (ctrl/meta): exponential zoom toward the pointer
 * - Alt + wheel: zoom toward pointer (desktop-friendly shortcut)
 * - Toolbar buttons: animated multiplicative zoom toward viewport center
 * - Fit / reset: eased transitions with scroll correction
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { GroupBox } from "../utils/groupGeometry";

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 2;
const ZOOM_WHEEL_SENSITIVITY = 0.0024;
const ZOOM_BUTTON_FACTOR = 1.18;
const ZOOM_ANIM_MS = 180;
const FIT_ANIM_MS = 260;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

const GRID_STEP = 24;

function syncGridBackground(el: HTMLDivElement) {
  el.style.backgroundPosition = `${-(el.scrollLeft % GRID_STEP)}px ${-(el.scrollTop % GRID_STEP)}px`;
}

function applyScrollForZoom(
  el: HTMLDivElement,
  contentX: number,
  contentY: number,
  newZoom: number,
  localX: number,
  localY: number,
) {
  el.scrollLeft = Math.max(0, contentX * newZoom - localX);
  el.scrollTop = Math.max(0, contentY * newZoom - localY);
  syncGridBackground(el);
}

interface UseWorkflowZoomOptions {
  canvasRef: RefObject<HTMLDivElement>;
  /** Tight bounds of visible content — used by fit-to-view. */
  getContentBBox?: () => GroupBox | null;
  /** Logical canvas dimensions — used for imperative pinch sizing between React commits. */
  getCanvasSize?: () => { w: number; h: number };
}

/** Pinch-to-zoom and modifier+scroll are treated as zoom gestures. */
function isZoomWheel(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) return true;
  try {
    if (e.getModifierState?.("Control") || e.getModifierState?.("Meta")) return true;
  } catch { /* ignore */ }
  if (e.altKey) return true;
  return false;
}

function normalizeWheelDelta(e: WheelEvent): number {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= window.innerHeight;
  return dy;
}

/** Pixel-mode wheels fire continuously (trackpad pinch). */
function isCoalescedWheel(e: WheelEvent): boolean {
  return e.deltaMode === 0;
}

export function useWorkflowZoom({ canvasRef, getContentBBox, getCanvasSize }: UseWorkflowZoomOptions) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const animFrameRef = useRef<number | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const wheelFactorRef = useRef(1);
  const wheelAnchorRef = useRef({ x: 0, y: 0 });
  const pinchSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getCanvasSizeRef = useRef(getCanvasSize);
  getCanvasSizeRef.current = getCanvasSize;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const cancelWheelRaf = useCallback(() => {
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
    }
    wheelFactorRef.current = 1;
  }, []);

  const syncReactZoom = useCallback(() => {
    if (pinchSyncTimerRef.current != null) {
      clearTimeout(pinchSyncTimerRef.current);
      pinchSyncTimerRef.current = null;
    }
    flushSync(() => setZoom(zoomRef.current));
  }, []);

  const schedulePinchReactSync = useCallback(() => {
    if (pinchSyncTimerRef.current != null) {
      clearTimeout(pinchSyncTimerRef.current);
    }
    pinchSyncTimerRef.current = setTimeout(syncReactZoom, 120);
  }, [syncReactZoom]);

  /** Pinch path: update DOM + scroll immediately; defer heavy React commit until gesture pauses. */
  const applyPinchZoom = useCallback(
    (targetZoom: number, clientX: number, clientY: number) => {
      const el = canvasRef.current;
      const next = clampZoom(targetZoom);
      if (!el) {
        zoomRef.current = next;
        flushSync(() => setZoom(next));
        return;
      }

      cancelAnimation();

      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const current = zoomRef.current;
      const contentX = (el.scrollLeft + localX) / current;
      const contentY = (el.scrollTop + localY) / current;

      const size = getCanvasSizeRef.current?.() ?? { w: 4000, h: 3000 };
      const wrapper = el.querySelector("[data-wf-scroll-content]") as HTMLDivElement | null;
      const inner = el.querySelector("[data-wf-transform-content]") as HTMLDivElement | null;

      zoomRef.current = next;
      if (wrapper) {
        wrapper.style.width = `${size.w * next}px`;
        wrapper.style.height = `${size.h * next}px`;
      }
      if (inner) {
        inner.style.transform = `scale(${next})`;
      }
      applyScrollForZoom(el, contentX, contentY, next, localX, localY);
      schedulePinchReactSync();
    },
    [cancelAnimation, canvasRef, schedulePinchReactSync],
  );

  /** Synchronous React commit + scroll — keeps transform and scroll in one paint. */
  const applyInstantZoom = useCallback(
    (targetZoom: number, clientX: number, clientY: number) => {
      const el = canvasRef.current;
      const next = clampZoom(targetZoom);
      if (!el) {
        cancelAnimation();
        zoomRef.current = next;
        flushSync(() => setZoom(next));
        return;
      }

      cancelAnimation();

      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const current = zoomRef.current;
      const contentX = (el.scrollLeft + localX) / current;
      const contentY = (el.scrollTop + localY) / current;

      zoomRef.current = next;
      flushSync(() => setZoom(next));
      applyScrollForZoom(el, contentX, contentY, next, localX, localY);
    },
    [cancelAnimation, canvasRef],
  );

  const flushCoalescedWheel = useCallback(() => {
    wheelRafRef.current = null;
    const factor = wheelFactorRef.current;
    wheelFactorRef.current = 1;
    if (Math.abs(factor - 1) < 0.00001) return;
    const next = clampZoom(zoomRef.current * factor);
    const { x, y } = wheelAnchorRef.current;
    applyPinchZoom(next, x, y);
  }, [applyPinchZoom]);

  const scheduleCoalescedWheel = useCallback(() => {
    if (wheelRafRef.current != null) return;
    wheelRafRef.current = requestAnimationFrame(flushCoalescedWheel);
  }, [flushCoalescedWheel]);

  const zoomAtClient = useCallback(
    (targetZoom: number, clientX: number, clientY: number, animate: boolean) => {
      const el = canvasRef.current;
      const next = clampZoom(targetZoom);
      if (!el) {
        cancelAnimation();
        setZoom(next);
        return;
      }

      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const current = zoomRef.current;
      const contentX = (el.scrollLeft + localX) / current;
      const contentY = (el.scrollTop + localY) / current;

      if (!animate || Math.abs(next - current) < 0.001) {
        cancelWheelRaf();
        if (pinchSyncTimerRef.current != null) {
          clearTimeout(pinchSyncTimerRef.current);
          pinchSyncTimerRef.current = null;
        }
        applyInstantZoom(next, clientX, clientY);
        return;
      }

      cancelAnimation();
      cancelWheelRaf();
      const startZoom = current;
      const startTime = performance.now();

      const tick = (now: number) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          animFrameRef.current = null;
          return;
        }
        const t = Math.min(1, (now - startTime) / ZOOM_ANIM_MS);
        const z = startZoom + (next - startZoom) * easeOutCubic(t);
        zoomRef.current = z;
        setZoom(z);
        applyScrollForZoom(canvas, contentX, contentY, z, localX, localY);
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          zoomRef.current = next;
          setZoom(next);
          applyScrollForZoom(canvas, contentX, contentY, next, localX, localY);
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, cancelWheelRaf, applyInstantZoom, canvasRef],
  );

  const viewportCenter = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [canvasRef]);

  const zoomIn = useCallback(() => {
    const c = viewportCenter();
    zoomAtClient(zoomRef.current * ZOOM_BUTTON_FACTOR, c.x, c.y, true);
  }, [viewportCenter, zoomAtClient]);

  const zoomOut = useCallback(() => {
    const c = viewportCenter();
    zoomAtClient(zoomRef.current / ZOOM_BUTTON_FACTOR, c.x, c.y, true);
  }, [viewportCenter, zoomAtClient]);

  const zoomReset = useCallback(() => {
    const c = viewportCenter();
    zoomAtClient(1, c.x, c.y, true);
  }, [viewportCenter, zoomAtClient]);

  const fitToView = useCallback(() => {
    const el = canvasRef.current;
    const bbox = getContentBBox?.() ?? null;
    if (!el || !bbox || bbox.w <= 0 || bbox.h <= 0) {
      cancelAnimation();
      setZoom(1);
      if (el) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
      return;
    }

    const padding = 96;
    const availW = Math.max(el.clientWidth - padding, 200);
    const availH = Math.max(el.clientHeight - padding, 200);
    const targetZoom = clampZoom(Math.min(availW / bbox.w, availH / bbox.h));

    cancelAnimation();
    cancelWheelRaf();
    const startZoom = zoomRef.current;
    const startTime = performance.now();

    const tick = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = null;
        return;
      }
      const t = Math.min(1, (now - startTime) / FIT_ANIM_MS);
      const z = startZoom + (targetZoom - startZoom) * easeOutCubic(t);

      zoomRef.current = z;
      setZoom(z);
      canvas.scrollLeft = Math.max(0, bbox.x * z - (canvas.clientWidth - bbox.w * z) / 2);
      canvas.scrollTop = Math.max(0, bbox.y * z - (canvas.clientHeight - bbox.h * z) / 2);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        zoomRef.current = targetZoom;
        setZoom(targetZoom);
        canvas.scrollLeft = Math.max(0, bbox.x * targetZoom - (canvas.clientWidth - bbox.w * targetZoom) / 2);
        canvas.scrollTop = Math.max(0, bbox.y * targetZoom - (canvas.clientHeight - bbox.h * targetZoom) / 2);
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation, cancelWheelRaf, canvasRef, getContentBBox]);

  const applyInstantZoomRef = useRef(applyInstantZoom);
  applyInstantZoomRef.current = applyInstantZoom;
  const scheduleCoalescedWheelRef = useRef(scheduleCoalescedWheel);
  scheduleCoalescedWheelRef.current = scheduleCoalescedWheel;

  const attachWheelZoom = useCallback((el: HTMLDivElement) => {
    const onWheel = (e: WheelEvent) => {
      if (!isZoomWheel(e)) return;

      e.preventDefault();
      e.stopPropagation();

      const dy = normalizeWheelDelta(e);
      const factor = Math.exp(-dy * ZOOM_WHEEL_SENSITIVITY);

      if (isCoalescedWheel(e)) {
        wheelFactorRef.current *= factor;
        wheelAnchorRef.current = { x: e.clientX, y: e.clientY };
        scheduleCoalescedWheelRef.current();
        return;
      }

      cancelWheelRaf();
      if (pinchSyncTimerRef.current != null) {
        clearTimeout(pinchSyncTimerRef.current);
        pinchSyncTimerRef.current = null;
      }
      const next = clampZoom(zoomRef.current * factor);
      if (Math.abs(next - zoomRef.current) < 0.0001) return;
      applyInstantZoomRef.current(next, e.clientX, e.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [cancelWheelRaf]);

  const bindWheelTarget = useCallback((el: HTMLDivElement | null) => {
    if (!el) return () => {};
    return attachWheelZoom(el);
  }, [attachWheelZoom]);

  useEffect(() => () => {
    cancelAnimation();
    cancelWheelRaf();
    if (pinchSyncTimerRef.current != null) {
      clearTimeout(pinchSyncTimerRef.current);
    }
  }, [cancelAnimation, cancelWheelRaf]);

  return { zoom, zoomIn, zoomOut, zoomReset, fitToView, zoomAtClient, bindWheelTarget };
}
