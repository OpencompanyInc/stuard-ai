/**
 * Shares the editor-only node-group state between the canvas (which renders
 * groups) and the surrounding chrome (context menu, keyboard shortcuts) without
 * threading props through the prop-drilled layout layers.
 */
import { createContext, useContext } from "react";
import type { NodeGroup, WorkflowGroupsApi } from "./hooks/useWorkflowGroups";

export interface WorkflowGroupsContextValue extends WorkflowGroupsApi {
  /** Offset every member of a group by a content-space delta (model mutation). */
  moveGroupBy: (groupId: string, dx: number, dy: number) => void;
  /** Select a group's members on the canvas. */
  selectGroup: (group: NodeGroup) => void;
}

const WorkflowGroupsContext = createContext<WorkflowGroupsContextValue | null>(null);

export const WorkflowGroupsProvider = WorkflowGroupsContext.Provider;

/** Returns the groups API, or null when rendered outside a provider. */
export function useWorkflowGroupsContext(): WorkflowGroupsContextValue | null {
  return useContext(WorkflowGroupsContext);
}
