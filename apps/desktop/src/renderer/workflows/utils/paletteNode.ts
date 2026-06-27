/**
 * Shared "add a palette item to the workflow" logic, used by BOTH drag-drop and
 * click-to-add. Toolbox drag relies on HTML5 drag-and-drop, which is flaky on
 * laptop trackpads / touch input — click-to-add gives a device-independent way
 * to place nodes, so the toolbox always works.
 */

import type { DesignerModel } from "../types";

export interface PaletteItemData {
  k?: string;            // node kind ('trigger' | 'local.tool' | ...)
  t?: string;            // tool / trigger type
  label?: string;
  args?: Record<string, any>;
  iconName?: string;
  colorKey?: string;
  /** Set when dragging an installed top-level function from the toolbox. */
  sourceWorkflowId?: string;
}

/**
 * Create a node/trigger from palette data at canvas coordinates (x, y) and push
 * it into the model via updateModel. Mirrors the previous inline drop handler.
 */
export function createPaletteNode(
  model: DesignerModel,
  updateModel: (m: DesignerModel) => void,
  d: PaletteItemData,
  x: number,
  y: number,
): void {
  if (!model || model.locked) return;

  const safeKind = String(d.k || "step").replace(/\./g, "_");
  const id = `${safeKind}_${Date.now().toString(36)}`;

  // Trigger → triggers track.
  if (d.k === "trigger") {
    updateModel({
      ...model,
      triggers: [...model.triggers, { id, type: d.t, label: d.label, args: d.args || {}, position: { x, y } } as any],
    });
    return;
  }

  // Installed top-level function → materialize it as an internal sub-workflow in
  // this workspace, then wire a call_workspace_function node.
  if (typeof d.sourceWorkflowId === 'string' && d.sourceWorkflowId && d.sourceWorkflowId !== model.id) {
    const importApi = (window as any).desktopAPI?.workflowsImportAsWorkspaceFunction;
    if (typeof importApi === 'function') {
      (async () => {
        try {
          const res = await importApi(model.id, d.sourceWorkflowId);
          if (!res?.ok || !res.path) {
            console.warn('[canvas] importAsWorkspaceFunction failed:', res?.error || 'unknown');
            return;
          }
          const inputParams = Array.isArray(res.inputParams) ? res.inputParams : [];
          const inputs = Object.fromEntries(
            inputParams
              .filter((p: any) => p?.name)
              .map((p: any) => [String(p.name), p?.defaultValue ?? p?.default ?? ''])
          );
          const designed = res.functionNode || null;
          const designedLabel = designed && typeof designed.label === 'string' && designed.label.trim()
            ? designed.label.trim()
            : (res.name || d.label);
          const newNode: any = {
            id,
            type: 'local.tool',
            tool: 'call_workspace_function',
            label: designedLabel,
            args: { path: res.path, inputs },
            position: { x, y },
          };
          const iconName = (designed && typeof designed.icon === 'string' ? designed.icon : d.iconName) || undefined;
          const colorKey = (designed && typeof designed.color === 'string' ? designed.color : d.colorKey) || undefined;
          if (iconName) newNode.iconName = iconName;
          if (colorKey) newNode.colorKey = colorKey;
          updateModel({ ...model, nodes: [...model.nodes, newNode] });
        } catch (err) {
          console.warn('[canvas] importAsWorkspaceFunction threw:', err);
        }
      })();
      return;
    }
    // Fall through to the regular path if the IPC isn't wired.
  }

  const newNode: any = { id, type: d.k, tool: d.t, label: d.label, args: d.args || {}, position: { x, y } };
  if (typeof d.iconName === 'string' && d.iconName) newNode.iconName = d.iconName;
  if (typeof d.colorKey === 'string' && d.colorKey) newNode.colorKey = d.colorKey;
  updateModel({ ...model, nodes: [...model.nodes, newNode] });
}
