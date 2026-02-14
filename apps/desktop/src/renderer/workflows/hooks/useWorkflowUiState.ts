import { useCallback, useEffect, useState } from "react";

export function useWorkflowUiState() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const raw = window.localStorage.getItem("workflow.sidebarCollapsed");
      return raw === "1" || raw === "true";
    } catch {
      return false;
    }
  });

  const [aiLeftWidth, setAiLeftWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem("workflow.ai.leftPaneWidth");
      const n = raw ? Number(raw) : 350;
      if (!Number.isFinite(n)) return 350;
      return Math.max(260, Math.min(520, n));
    } catch {
      return 350;
    }
  });

  const [manualRightWidth, setManualRightWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem("workflow.manual.rightPaneWidth");
      const n = raw ? Number(raw) : 320;
      if (!Number.isFinite(n)) return 320;
      return Math.max(280, Math.min(560, n));
    } catch {
      return 320;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("workflow.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      // no-op
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem("workflow.ai.leftPaneWidth", String(aiLeftWidth));
    } catch {
      // no-op
    }
  }, [aiLeftWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem("workflow.manual.rightPaneWidth", String(manualRightWidth));
    } catch {
      // no-op
    }
  }, [manualRightWidth]);

  const startResizeAiLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = aiLeftWidth;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const next = Math.max(260, Math.min(520, startWidth + dx));
        setAiLeftWidth(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [aiLeftWidth]
  );

  const startResizeManualRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = manualRightWidth;

      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX;
        const next = Math.max(280, Math.min(560, startWidth + dx));
        setManualRightWidth(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [manualRightWidth]
  );

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    aiLeftWidth,
    setAiLeftWidth,
    manualRightWidth,
    setManualRightWidth,
    startResizeAiLeft,
    startResizeManualRight,
  };
}
