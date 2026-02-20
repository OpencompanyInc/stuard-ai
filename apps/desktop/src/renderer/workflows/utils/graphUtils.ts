/**
 * Graph utilities for workflow wire analysis.
 * Shared by WorkflowCanvas, WireInspectorPanel, and InspectorPanel.
 */
import type { DesignerWire } from '../types';

/**
 * Check if a wire from→to creates an actual cycle in the directed graph.
 * A wire is a "back edge" only if there is a directed path from `to` back to `from`
 * through other wires (i.e., the wire closes a loop: from → to → ... → from).
 *
 * This replaces the old index-based detection which falsely flagged convergence
 * (two branches merging at one node) as loops.
 */
export function isBackEdge(
  from: string,
  to: string,
  wires: DesignerWire[]
): boolean {
  // BFS from `to` following outgoing wires. If we reach `from`, it's a cycle.
  const visited = new Set<string>();
  const queue: string[] = [to];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const w of wires) {
      // Follow outgoing wires from current node, but skip the wire we're testing
      // (we don't want to immediately loop back via the same edge)
      if (w.from === current && !(w.from === from && w.to === to)) {
        if (!visited.has(w.to)) {
          queue.push(w.to);
        }
      }
    }
  }

  return false;
}
