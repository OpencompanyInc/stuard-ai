/**
 * Pure geometry helpers for visual node groups.
 *
 * Groups are an EDITOR-ONLY visual layer — these helpers derive what to draw
 * from the live model positions + the sidecar group list. They never mutate the
 * model and the group data never reaches the engine or the AI.
 */
import type { DesignerModel } from "../types";

// Node cards are 256×80 on the canvas (see WorkflowNodeCard). A collapsed group
// tile is rendered node-sized so the existing wire math (x = pos.x + 256, …)
// lines up without special-casing.
export const GROUP_NODE_W = 256;
export const GROUP_NODE_H = 80;
const FRAME_PAD = 28;
const FRAME_HEADER_H = 30;

export interface GroupBox { x: number; y: number; w: number; h: number; }

export interface NodeGroupLike {
  id: string;
  name: string;
  memberIds: string[];
  collapsed: boolean;
  color?: string;
}

interface PositionedNode { id: string; position: { x: number; y: number } }

export function memberBBox(
  memberIds: string[],
  byId: Map<string, PositionedNode>,
): GroupBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (const id of memberIds) {
    const n = byId.get(id);
    if (!n) continue;
    count++;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + GROUP_NODE_W);
    maxY = Math.max(maxY, n.position.y + GROUP_NODE_H);
  }
  if (count === 0) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export interface GroupRender {
  /** Members of COLLAPSED groups — hidden from the canvas. */
  hiddenNodeIds: Set<string>;
  /** Node-sized tiles to draw for each collapsed group, at the members' top-left. */
  collapsedTiles: Array<{ group: NodeGroupLike; box: GroupBox }>;
  /** Padded frames to draw BEHIND members for each expanded group. */
  expandedFrames: Array<{ group: NodeGroupLike; box: GroupBox }>;
  /** memberId → the collapsed group it belongs to (for wire re-routing). */
  collapsedGroupByMember: Map<string, NodeGroupLike>;
  /** groupId → its collapsed tile box (for wire re-routing). */
  collapsedBoxByGroupId: Map<string, GroupBox>;
  /** nodeId → live member count of the group it belongs to. */
  memberCountByGroupId: Map<string, number>;
}

export function buildGroupRender(groups: NodeGroupLike[], model: DesignerModel): GroupRender {
  const byId = new Map<string, PositionedNode>();
  for (const t of model.triggers) byId.set(t.id, t);
  for (const n of model.nodes) byId.set(n.id, n);

  const hiddenNodeIds = new Set<string>();
  const collapsedTiles: GroupRender["collapsedTiles"] = [];
  const expandedFrames: GroupRender["expandedFrames"] = [];
  const collapsedGroupByMember = new Map<string, NodeGroupLike>();
  const collapsedBoxByGroupId = new Map<string, GroupBox>();
  const memberCountByGroupId = new Map<string, number>();

  for (const g of groups) {
    const present = g.memberIds.filter((id) => byId.has(id));
    if (present.length < 2) continue;
    const bbox = memberBBox(present, byId);
    if (!bbox) continue;
    memberCountByGroupId.set(g.id, present.length);

    if (g.collapsed) {
      const box: GroupBox = {
        x: bbox.x + Math.max(0, (bbox.w - GROUP_NODE_W) / 2),
        y: bbox.y + Math.max(0, (bbox.h - GROUP_NODE_H) / 2),
        w: GROUP_NODE_W,
        h: GROUP_NODE_H,
      };
      collapsedTiles.push({ group: g, box });
      collapsedBoxByGroupId.set(g.id, box);
      for (const id of present) {
        hiddenNodeIds.add(id);
        collapsedGroupByMember.set(id, g);
      }
    } else {
      expandedFrames.push({
        group: g,
        box: {
          x: bbox.x - FRAME_PAD,
          y: bbox.y - FRAME_PAD - FRAME_HEADER_H,
          w: bbox.w + FRAME_PAD * 2,
          h: bbox.h + FRAME_PAD * 2 + FRAME_HEADER_H,
        },
      });
    }
  }

  return {
    hiddenNodeIds,
    collapsedTiles,
    expandedFrames,
    collapsedGroupByMember,
    collapsedBoxByGroupId,
    memberCountByGroupId,
  };
}

/**
 * Resolve a wire endpoint to its EFFECTIVE position for drawing. If the id is a
 * member of a collapsed group, the wire connects to the group tile instead.
 * Returns null when the id is unknown (wire should be skipped).
 */
export function resolveEndpoint(
  id: string,
  byId: Map<string, PositionedNode>,
  gr: GroupRender,
): PositionedNode | null {
  const g = gr.collapsedGroupByMember.get(id);
  if (g) {
    const box = gr.collapsedBoxByGroupId.get(g.id);
    if (box) return { id: g.id, position: { x: box.x, y: box.y } };
  }
  return byId.get(id) ?? null;
}

const CANVAS_PAD = 600;
const MIN_CANVAS_W = 4000;
const MIN_CANVAS_H = 3000;

/** Scrollable canvas dimensions — excludes hidden collapsed members so the workspace doesn't balloon. */
export function computeCanvasSize(model: DesignerModel, gr: GroupRender): { w: number; h: number } {
  let mx = MIN_CANVAS_W;
  let my = MIN_CANVAS_H;
  const bump = (x: number, y: number, w: number, h: number) => {
    mx = Math.max(mx, x + w + CANVAS_PAD);
    my = Math.max(my, y + h + CANVAS_PAD);
  };

  for (const t of model.triggers) {
    if (gr.hiddenNodeIds.has(t.id)) continue;
    bump(t.position.x, t.position.y, GROUP_NODE_W, GROUP_NODE_H);
  }
  for (const n of model.nodes) {
    if (gr.hiddenNodeIds.has(n.id)) continue;
    bump(n.position.x, n.position.y, GROUP_NODE_W, GROUP_NODE_H);
  }
  for (const { box } of gr.collapsedTiles) bump(box.x, box.y, box.w, box.h);
  for (const { box } of gr.expandedFrames) bump(box.x, box.y, box.w, box.h);

  return { w: mx, h: my };
}

/** Tight bounding box of visible canvas content (for fit-to-view). */
export function computeContentBBox(model: DesignerModel, gr: GroupRender): GroupBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  const bump = (x: number, y: number, w: number, h: number) => {
    count++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const t of model.triggers) {
    if (gr.hiddenNodeIds.has(t.id)) continue;
    bump(t.position.x, t.position.y, GROUP_NODE_W, GROUP_NODE_H);
  }
  for (const n of model.nodes) {
    if (gr.hiddenNodeIds.has(n.id)) continue;
    bump(n.position.x, n.position.y, GROUP_NODE_W, GROUP_NODE_H);
  }
  for (const { box } of gr.collapsedTiles) bump(box.x, box.y, box.w, box.h);

  if (count === 0) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
