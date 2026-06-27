/**
 * Workflow clipboard — copy/paste of nodes between workflows and across windows.
 *
 * Storage strategy:
 *   1. `navigator.clipboard` (string) — primary, so users can paste into a
 *      different workflow window or even into a text field for inspection.
 *   2. `localStorage` — fallback for environments where the clipboard read
 *      permission isn't granted (Electron sometimes denies it without a
 *      gesture). This is also what makes cross-workflow paste reliable
 *      regardless of focus state.
 */
import type { DesignerNode, DesignerTrigger, DesignerWire } from "../types";

export const WORKFLOW_CLIPBOARD_MAGIC = "stuard-workflow-clipboard-v1";
const LS_KEY = "stuard.workflow.clipboard.v1";

export interface WorkflowClipboardPayload {
  magic: typeof WORKFLOW_CLIPBOARD_MAGIC;
  triggers: DesignerTrigger[];
  nodes: DesignerNode[];
  wires: DesignerWire[];
}

export function buildClipboardPayload(
  triggers: DesignerTrigger[],
  nodes: DesignerNode[],
  wires: DesignerWire[],
): WorkflowClipboardPayload {
  return { magic: WORKFLOW_CLIPBOARD_MAGIC, triggers, nodes, wires };
}

export async function writeWorkflowClipboard(payload: WorkflowClipboardPayload): Promise<void> {
  const json = JSON.stringify(payload);
  try {
    window.localStorage.setItem(LS_KEY, json);
  } catch {}
  try {
    await navigator.clipboard?.writeText(json);
  } catch {}
}

function parsePayload(raw: string | null | undefined): WorkflowClipboardPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.magic === WORKFLOW_CLIPBOARD_MAGIC && Array.isArray(parsed.nodes) && Array.isArray(parsed.wires)) {
      return {
        magic: WORKFLOW_CLIPBOARD_MAGIC,
        triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
        nodes: parsed.nodes,
        wires: parsed.wires,
      };
    }
  } catch {}
  return null;
}

export async function readWorkflowClipboard(): Promise<WorkflowClipboardPayload | null> {
  // Try OS clipboard first — the user may have copied from another window.
  try {
    const text = await navigator.clipboard?.readText();
    const fromOs = parsePayload(text);
    if (fromOs) return fromOs;
  } catch {}
  try {
    return parsePayload(window.localStorage.getItem(LS_KEY));
  } catch {
    return null;
  }
}

export function hasLocalWorkflowClipboard(): boolean {
  try {
    return !!parsePayload(window.localStorage.getItem(LS_KEY));
  } catch {
    return false;
  }
}
