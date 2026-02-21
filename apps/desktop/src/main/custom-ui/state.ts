import { BrowserWindow } from 'electron';

export type CustomUiWindowData = {
  data: any;
  flowId: string;
  resolve?: (result: any) => void;
  keepOpen?: boolean;
  currentPage?: string;
  pages?: Record<string, any>;
  subscribedVars?: Set<string>;
  /** The parsed workflow spec — stored so callNode can resolve sibling steps */
  flowSpec?: { steps?: Array<{ id: string; tool?: string; args?: any; [k: string]: any }> };
  /** The engine step ID of this custom_ui node — used as wireFromId for callNode animations */
  stepId?: string;
};

export const customUiWindows = new Map<string, BrowserWindow>();
export const windowData = new Map<string, CustomUiWindowData>();

export function subscribeWindowToVar(windowId: string, varName: string): void {
  const wd = windowData.get(windowId);
  if (!wd) return;
  if (!wd.subscribedVars) wd.subscribedVars = new Set();
  wd.subscribedVars.add(varName);
}
