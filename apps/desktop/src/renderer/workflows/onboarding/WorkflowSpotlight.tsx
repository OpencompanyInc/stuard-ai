import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkflowTheme } from "../WorkflowThemeContext";

interface WorkflowSpotlightProps {
  targetId: string;
  // Refresh tick — bump to force re-measure when the underlying layout shifts.
  refresh?: number;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const RING_PAD = 8;

export function WorkflowSpotlight({ targetId, refresh }: WorkflowSpotlightProps) {
  const { isDark } = useWorkflowTheme();
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();

    const ro = new ResizeObserver(schedule);
    const el = document.getElementById(targetId);
    if (el) ro.observe(el);
    ro.observe(document.body);

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    // Poll for first paint in case the target mounts after us.
    const poll = window.setInterval(schedule, 400);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(poll);
    };
  }, [targetId, refresh]);

  if (!rect) return null;

  const top = rect.top - RING_PAD;
  const left = rect.left - RING_PAD;
  const width = rect.width + RING_PAD * 2;
  const height = rect.height + RING_PAD * 2;

  return createPortal(
    <div data-wf-theme={isDark ? "dark" : "light"}>
      <div
        className="wf-spotlight-ring"
        style={{
          top,
          left,
          width,
          height,
        }}
      />
    </div>,
    document.body,
  );
}
