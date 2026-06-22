/**
 * Graph utilities for workflow wire analysis.
 * Shared by WorkflowCanvas, WireInspectorPanel, and InspectorPanel.
 */
import type { DesignerWire } from '../types';

export function normalizeWires(wires: unknown): DesignerWire[] {
  return Array.isArray(wires) ? wires : [];
}

/**
 * Check if a specific wire (from→to) is a TRUE back edge in the directed graph.
 *
 * Uses DFS coloring to correctly identify only the single edge per cycle that
 * "goes backwards" — i.e., the edge that, when removed, would break the cycle.
 *
 * The old BFS approach ("can we reach `from` by following forward from `to`?")
 * incorrectly flagged ALL edges in a cycle as back edges. This caused forward
 * wires like A→B→C to be rendered as loop-back overhead paths when a loop wire
 * C→A existed.
 *
 * Loop config on a wire (repeat/forEach/while) does NOT make it a back edge by
 * itself — entry wires to upcoming nodes stay forward edges and use normal routing.
 *
 * DFS coloring: WHITE = unvisited, GRAY = in current DFS path, BLACK = finished.
 * A back edge is one that points from a node to a GRAY ancestor (still on the path).
 */
export function isBackEdge(
  from: string,
  to: string,
  wires: unknown
): boolean {
  const list = normalizeWires(wires);
  // Build adjacency list and collect all nodes
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();
  for (const w of list) {
    allNodes.add(w.from);
    allNodes.add(w.to);
    if (!adj.has(w.from)) adj.set(w.from, []);
    adj.get(w.from)!.push(w.to);
  }

  // DFS-based back-edge detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of allNodes) color.set(n, WHITE);

  const backEdges = new Set<string>(); // "from|to" keys

  function dfs(u: string) {
    color.set(u, GRAY);
    for (const v of (adj.get(u) || [])) {
      if (color.get(v) === GRAY) {
        // v is an ancestor of u in the DFS tree → u→v is a back edge
        backEdges.add(`${u}|${v}`);
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  // Start DFS from root nodes (no incoming edges) first for consistent ordering
  const hasIncoming = new Set<string>();
  for (const w of list) hasIncoming.add(w.to);
  const roots = [...allNodes].filter(n => !hasIncoming.has(n));

  for (const root of roots) {
    if (color.get(root) === WHITE) dfs(root);
  }
  // Handle any remaining unvisited nodes (fully cyclic subgraphs)
  for (const n of allNodes) {
    if (color.get(n) === WHITE) dfs(n);
  }

  return backEdges.has(`${from}|${to}`);
}

/** Rose — wires whose source is inside an open loop scope (continues iterating). */
export const WIRE_COLOR_LOOP_CONTINUE = '#e11d48';
/** Amber — the single closing back-edge of a cycle. */
export const WIRE_COLOR_LOOP_BACK = '#f59e0b';
/** Slate — wire marked loopBreak (exits loop after all iterations). */
export const WIRE_COLOR_LOOP_EXIT = '#64748b';
/** Purple — wire that carries loop config (forEach / repeat / while entry). */
export const WIRE_COLOR_LOOP_CONFIG = '#a855f7';

/**
 * Count unclosed loop scopes at `nodeId` by walking upstream.
 * Mirrors WireInspectorPanel semantics: each `.loop` wire opens a scope,
 * each `.loopBreak` wire closes one.
 */
export function countOpenLoops(
  nodeId: string,
  wires: unknown,
  visited: Set<string> = new Set(),
): number {
  const list = normalizeWires(wires);
  if (visited.has(nodeId)) return 0;
  visited.add(nodeId);

  const incomingWires = list.filter(w => w.to === nodeId);
  let maxOpenLoops = 0;

  for (const w of incomingWires) {
    let openLoops = countOpenLoops(w.from, list, new Set(visited));

    if ((w as any).loop) {
      openLoops++;
    }

    if ((w as any).loopBreak && openLoops > 0) {
      openLoops--;
    }

    maxOpenLoops = Math.max(maxOpenLoops, openLoops);
  }

  return maxOpenLoops;
}

export function isNodeInsideOpenLoop(nodeId: string, wires: unknown): boolean {
  return countOpenLoops(nodeId, wires, new Set()) > 0;
}

/** True when the wire re-enters the loop body (source inside an open loop scope). */
export function isContinueInLoopWire(
  wire: DesignerWire,
  wires: unknown,
  isBackEdge: boolean,
): boolean {
  if ((wire as any).loop || (wire as any).loopBreak || isBackEdge) return false;
  return isNodeInsideOpenLoop(wire.from, wires);
}
