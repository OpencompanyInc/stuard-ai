import { createContext, useContext } from "react";

interface WorkflowTheme {
  isDark: boolean;
}

export const WorkflowThemeContext = createContext<WorkflowTheme>({ isDark: false });

export function useWorkflowTheme() {
  return useContext(WorkflowThemeContext);
}
