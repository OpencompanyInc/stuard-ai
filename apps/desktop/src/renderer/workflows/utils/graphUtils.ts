/**
 * Graph utilities for workflow wire analysis.
 * Shared by WorkflowCanvas, WireInspectorPanel, and InspectorPanel.
 */
import type { DesignerWire } from '../types';

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
 * DFS coloring: WHITE = unvisited, GRAY = in current DFS path, BLACK = finished.
 * A back edge is one that points from a node to a GRAY ancestor (still on the path).
 */
export function isBackEdge(
  from: string,
  to: string,
  wires: DesignerWire[]
): boolean {
  // If this wire has explicit .loop config, it's always a back edge
  const thisWire = wires.find(w => w.from === from && w.to === to);
  if (thisWire && (thisWire as any).loop) return true;

  // Build adjacency list and collect all nodes
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();
  for (const w of wires) {
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
  for (const w of wires) hasIncoming.add(w.to);
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
