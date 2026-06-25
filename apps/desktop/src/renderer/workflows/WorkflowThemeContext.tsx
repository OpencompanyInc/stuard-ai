import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface WorkflowTheme {
  isDark: boolean;
}

export const WorkflowThemeContext = createContext<WorkflowTheme>({ isDark: false });

export function useWorkflowTheme() {
  return useContext(WorkflowThemeContext);
}

/** Portals to document.body with workflow theme CSS variables applied. */
export function WorkflowPortal({ children }: { children: ReactNode }) {
  const { isDark } = useWorkflowTheme();
  return createPortal(
    <div data-wf-theme={isDark ? "dark" : "light"}>{children}</div>,
    document.body,
  );
}
