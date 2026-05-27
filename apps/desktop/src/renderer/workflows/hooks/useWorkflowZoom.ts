/**
 * Smooth, cursor-anchored canvas zoom for the workflow editor.
 *
 * - Wheel / pinch (ctrl/meta): exponential zoom toward the pointer
 * - Alt + wheel: zoom toward pointer (desktop-friendly shortcut)
 * - Toolbar buttons: animated multiplicative zoom toward viewport center
 * - Fit / reset: eased transitions with scroll correction
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
}

interface UseWorkflowZoomOptions {
  canvasRef: RefObject<HTMLDivElement>;
  /** Tight bounds of visible content — used by fit-to-view. */
  getContentBBox?: () => GroupBox | null;
}

/** Pinch-to-zoom and modifier+scroll are treated as zoom gestures. */
function isZoomWheel(e: WheelEvent): boolean {
  // Trackpad pinch on Chrome/Edge/Firefox (Windows + Mac) sets ctrlKey.
  if (e.ctrlKey || e.metaKey) return true;
  // Alt + scroll fallback for mice / some drivers.
  if (e.altKey) return true;
  return false;
}

function normalizeWheelDelta(e: WheelEvent): number {
  // deltaMode: 0 = pixels (trackpads), 1 = lines, 2 = pages
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= window.innerHeight;
  return dy;
}

export function useWorkflowZoom({ canvasRef, getContentBBox }: UseWorkflowZoomOptions) {
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const animFrameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{
    contentX: number;
    contentY: number;
    localX: number;
    localY: number;
    targetZoom: number;
  } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Apply scroll correction after React commits an instant (wheel) zoom.
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const el = canvasRef.current;
    if (!pending || !el) return;
    pendingScrollRef.current = null;
    applyScrollForZoom(el, pending.contentX, pending.contentY, pending.targetZoom, pending.localX, pending.localY);
  });

  const cancelAnimation = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

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
        cancelAnimation();
        pendingScrollRef.current = { contentX, contentY, localX, localY, targetZoom: next };
        setZoom(next);
        return;
      }

      cancelAnimation();
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
        setZoom(z);
        applyScrollForZoom(canvas, contentX, contentY, z, localX, localY);
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          setZoom(next);
          applyScrollForZoom(canvas, contentX, contentY, next, localX, localY);
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, canvasRef],
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

      setZoom(z);
      canvas.scrollLeft = Math.max(0, bbox.x * z - (canvas.clientWidth - bbox.w * z) / 2);
      canvas.scrollTop = Math.max(0, bbox.y * z - (canvas.clientHeight - bbox.h * z) / 2);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setZoom(targetZoom);
        canvas.scrollLeft = Math.max(0, bbox.x * targetZoom - (canvas.clientWidth - bbox.w * targetZoom) / 2);
        canvas.scrollTop = Math.max(0, bbox.y * targetZoom - (canvas.clientHeight - bbox.h * targetZoom) / 2);
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation, canvasRef, getContentBBox]);

  // Stable wheel handler via ref so the listener never goes stale.
  const zoomAtClientRef = useRef(zoomAtClient);
  zoomAtClientRef.current = zoomAtClient;

  /** Bind directly to a canvas node — call from a callback ref for reliable mount timing. */
  const bindWheelTarget = useCallback((el: HTMLDivElement | null) => {
    if (!el) return () => {};

    const onWheel = (e: WheelEvent) => {
      if (!isZoomWheel(e)) return;

      e.preventDefault();
      e.stopPropagation();

      const dy = normalizeWheelDelta(e);
      const factor = Math.exp(-dy * ZOOM_WHEEL_SENSITIVITY);
      const current = zoomRef.current;
      const next = clampZoom(current * factor);
      if (Math.abs(next - current) < 0.0001) return;

      zoomAtClientRef.current(next, e.clientX, e.clientY, false);
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  return { zoom, zoomIn, zoomOut, zoomReset, fitToView, zoomAtClient, bindWheelTarget };
}
