/**
 * Alignment utilities for workflow canvas snapping
 * Provides Figma-style alignment guides and grid snapping
 */

// Constants
export const NODE_WIDTH = 256;
export const NODE_HEIGHT = 80;
export const GRID_SIZE = 24;
export const SNAP_THRESHOLD = 12; // Pixels within which alignment guides appear
export const HORIZONTAL_SPACING = 320; // Spacing between nodes horizontally
export const VERTICAL_SPACING = 140; // Spacing between nodes vertically

// Types
export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  position: number; // x for vertical, y for horizontal
  start: number;
  end: number;
}

export interface NodeBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: AlignmentGuide[];
}

interface NodeWithPosition {
  id: string;
  position: { x: number; y: number };
}

/**
 * Snap a value to the nearest grid position
 */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Get the bounds of a node for alignment calculations
 */
export function getNodeBounds(node: NodeWithPosition): NodeBounds {
  const { x, y } = node.position;
  return {
    left: x,
    right: x + NODE_WIDTH,
    top: y,
    bottom: y + NODE_HEIGHT,
    centerX: x + NODE_WIDTH / 2,
    centerY: y + NODE_HEIGHT / 2,
  };
}

/**
 * Calculate alignment guides and snapped position for a dragged node
 */
export function calculateSnapPosition(
  draggedNodeId: string,
  rawX: number,
  rawY: number,
  allNodes: NodeWithPosition[],
  threshold: number = SNAP_THRESHOLD
): SnapResult {
  const guides: AlignmentGuide[] = [];

  // First, snap to grid
  let snappedX = snapToGrid(rawX);
  let snappedY = snapToGrid(rawY);

  // Get bounds of the dragged node at raw position
  const draggedBounds: NodeBounds = {
    left: rawX,
    right: rawX + NODE_WIDTH,
    top: rawY,
    bottom: rawY + NODE_HEIGHT,
    centerX: rawX + NODE_WIDTH / 2,
    centerY: rawY + NODE_HEIGHT / 2,
  };

  // Filter out the dragged node
  const otherNodes = allNodes.filter(n => n.id !== draggedNodeId);

  if (otherNodes.length === 0) {
    return { x: snappedX, y: snappedY, guides };
  }

  // Track best alignments
  let bestVerticalDiff = threshold + 1;
  let bestHorizontalDiff = threshold + 1;
  let bestVerticalPos: number | null = null;
  let bestHorizontalPos: number | null = null;
  let verticalAlignType: 'left' | 'right' | 'center' | null = null;
  let horizontalAlignType: 'top' | 'bottom' | 'center' | null = null;

  // Check alignment with each other node
  for (const node of otherNodes) {
    const bounds = getNodeBounds(node);

    // Vertical alignments (x-axis)
    // Left edge to left edge
    const leftToLeft = Math.abs(draggedBounds.left - bounds.left);
    if (leftToLeft < bestVerticalDiff) {
      bestVerticalDiff = leftToLeft;
      bestVerticalPos = bounds.left;
      verticalAlignType = 'left';
    }

    // Right edge to right edge
    const rightToRight = Math.abs(draggedBounds.right - bounds.right);
    if (rightToRight < bestVerticalDiff) {
      bestVerticalDiff = rightToRight;
      bestVerticalPos = bounds.right - NODE_WIDTH;
      verticalAlignType = 'right';
    }

    // Center to center (vertical)
    const centerToCenter = Math.abs(draggedBounds.centerX - bounds.centerX);
    if (centerToCenter < bestVerticalDiff) {
      bestVerticalDiff = centerToCenter;
      bestVerticalPos = bounds.centerX - NODE_WIDTH / 2;
      verticalAlignType = 'center';
    }

    // Left edge to right edge (stacking)
    const leftToRight = Math.abs(draggedBounds.left - bounds.right);
    if (leftToRight < bestVerticalDiff) {
      bestVerticalDiff = leftToRight;
      bestVerticalPos = bounds.right;
      verticalAlignType = 'left';
    }

    // Right edge to left edge (stacking)
    const rightToLeft = Math.abs(draggedBounds.right - bounds.left);
    if (rightToLeft < bestVerticalDiff) {
      bestVerticalDiff = rightToLeft;
      bestVerticalPos = bounds.left - NODE_WIDTH;
      verticalAlignType = 'right';
    }

    // Horizontal alignments (y-axis)
    // Top edge to top edge
    const topToTop = Math.abs(draggedBounds.top - bounds.top);
    if (topToTop < bestHorizontalDiff) {
      bestHorizontalDiff = topToTop;
      bestHorizontalPos = bounds.top;
      horizontalAlignType = 'top';
    }

    // Bottom edge to bottom edge
    const bottomToBottom = Math.abs(draggedBounds.bottom - bounds.bottom);
    if (bottomToBottom < bestHorizontalDiff) {
      bestHorizontalDiff = bottomToBottom;
      bestHorizontalPos = bounds.bottom - NODE_HEIGHT;
      horizontalAlignType = 'bottom';
    }

    // Center to center (horizontal)
    const centerToCenterH = Math.abs(draggedBounds.centerY - bounds.centerY);
    if (centerToCenterH < bestHorizontalDiff) {
      bestHorizontalDiff = centerToCenterH;
      bestHorizontalPos = bounds.centerY - NODE_HEIGHT / 2;
      horizontalAlignType = 'center';
    }

    // Top to bottom (stacking vertically)
    const topToBottom = Math.abs(draggedBounds.top - bounds.bottom);
    if (topToBottom < bestHorizontalDiff) {
      bestHorizontalDiff = topToBottom;
      bestHorizontalPos = bounds.bottom;
      horizontalAlignType = 'top';
    }

    // Bottom to top (stacking vertically)
    const bottomToTop = Math.abs(draggedBounds.bottom - bounds.top);
    if (bottomToTop < bestHorizontalDiff) {
      bestHorizontalDiff = bottomToTop;
      bestHorizontalPos = bounds.top - NODE_HEIGHT;
      horizontalAlignType = 'bottom';
    }
  }

  // Apply vertical alignment if within threshold
  if (bestVerticalDiff <= threshold && bestVerticalPos !== null) {
    // Snap to the aligned position, but keep it on grid
    snappedX = snapToGrid(bestVerticalPos);

    // Create guide line
    const guideX = verticalAlignType === 'left' ? snappedX
      : verticalAlignType === 'right' ? snappedX + NODE_WIDTH
      : snappedX + NODE_WIDTH / 2;

    // Find min/max y for the guide line
    let minY = snappedY;
    let maxY = snappedY + NODE_HEIGHT;

    for (const node of otherNodes) {
      const bounds = getNodeBounds(node);
      const nodeGuideX = verticalAlignType === 'left' ? bounds.left
        : verticalAlignType === 'right' ? bounds.right
        : bounds.centerX;

      if (Math.abs(guideX - nodeGuideX) <= GRID_SIZE) {
        minY = Math.min(minY, bounds.top);
        maxY = Math.max(maxY, bounds.bottom);
      }
    }

    guides.push({
      type: 'vertical',
      position: guideX,
      start: minY - 10,
      end: maxY + 10,
    });
  }

  // Apply horizontal alignment if within threshold
  if (bestHorizontalDiff <= threshold && bestHorizontalPos !== null) {
    // Snap to the aligned position, but keep it on grid
    snappedY = snapToGrid(bestHorizontalPos);

    // Create guide line
    const guideY = horizontalAlignType === 'top' ? snappedY
      : horizontalAlignType === 'bottom' ? snappedY + NODE_HEIGHT
      : snappedY + NODE_HEIGHT / 2;

    // Find min/max x for the guide line
    let minX = snappedX;
    let maxX = snappedX + NODE_WIDTH;

    for (const node of otherNodes) {
      const bounds = getNodeBounds(node);
      const nodeGuideY = horizontalAlignType === 'top' ? bounds.top
        : horizontalAlignType === 'bottom' ? bounds.bottom
        : bounds.centerY;

      if (Math.abs(guideY - nodeGuideY) <= GRID_SIZE) {
        minX = Math.min(minX, bounds.left);
        maxX = Math.max(maxX, bounds.right);
      }
    }

    guides.push({
      type: 'horizontal',
      position: guideY,
      start: minX - 10,
      end: maxX + 10,
    });
  }

  return {
    x: Math.max(0, snappedX),
    y: Math.max(0, snappedY),
    guides,
  };
}

/**
 * Auto-organize layout algorithm
 * Arranges nodes in a left-to-right hierarchical tree layout based on wire connections
 * Triggers start on the left, subsequent steps flow to the right
 */
export interface AutoLayoutResult {
  triggers: Array<{ id: string; position: { x: number; y: number } }>;
  nodes: Array<{ id: string; position: { x: number; y: number } }>;
}

export function calculateAutoLayout(
  triggers: Array<{ id: string; position: { x: number; y: number } }>,
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
  wires: Array<{ from: string; to: string }>
): AutoLayoutResult {
  const START_X = 80;
  const START_Y = 120;

  // Build adjacency maps
  const childrenMap = new Map<string, string[]>();
  const parentsMap = new Map<string, string[]>();

  // Initialize all items
  const allIds = [...triggers.map(t => t.id), ...nodes.map(n => n.id)];
  for (const id of allIds) {
    childrenMap.set(id, []);
    parentsMap.set(id, []);
  }

  // Populate from wires
  for (const wire of wires) {
    const children = childrenMap.get(wire.from) || [];
    if (!children.includes(wire.to)) {
      children.push(wire.to);
      childrenMap.set(wire.from, children);
    }

    const parents = parentsMap.get(wire.to) || [];
    if (!parents.includes(wire.from)) {
      parents.push(wire.from);
      parentsMap.set(wire.to, parents);
    }
  }

  // Calculate levels (columns) using BFS from triggers/root nodes
  // Level 0 = leftmost column (triggers), Level 1 = next column, etc.
  const levels = new Map<string, number>();
  const triggerIds = new Set(triggers.map(t => t.id));

  // Find root nodes (triggers or nodes with no parents)
  const roots = allIds.filter(id => {
    const parents = parentsMap.get(id) || [];
    return triggerIds.has(id) || parents.length === 0;
  });

  // BFS to assign levels (left-to-right columns)
  const queue: Array<{ id: string; level: number }> = roots.map(id => ({ id, level: 0 }));

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;

    // Take the maximum level if already visited (handles convergence)
    const currentLevel = levels.get(id);
    if (currentLevel !== undefined && currentLevel >= level) {
      continue;
    }
    levels.set(id, level);

    const children = childrenMap.get(id) || [];
    for (const childId of children) {
      // Only queue if this parent contributes to a higher level
      const childCurrentLevel = levels.get(childId);
      if (childCurrentLevel === undefined || level + 1 > childCurrentLevel) {
        queue.push({ id: childId, level: level + 1 });
      }
    }
  }

  // Group by level (column)
  const levelGroups = new Map<number, string[]>();
  let maxLevel = 0;

  for (const [id, level] of levels.entries()) {
    const group = levelGroups.get(level) || [];
    group.push(id);
    levelGroups.set(level, group);
    maxLevel = Math.max(maxLevel, level);
  }

  // Sort nodes within each level (column) for consistent vertical ordering
  // Try to maintain parent-child alignment by sorting based on parent row positions
  const rowPositions = new Map<string, number>(); // Track row position for each node

  for (let level = 0; level <= maxLevel; level++) {
    const group = levelGroups.get(level) || [];

    if (level === 0) {
      // Sort triggers/roots alphabetically for consistency
      group.sort((a, b) => a.localeCompare(b));
      group.forEach((id, idx) => rowPositions.set(id, idx));
    } else {
      // Sort by average parent row position to minimize wire crossings
      group.sort((a, b) => {
        const parentsA = parentsMap.get(a) || [];
        const parentsB = parentsMap.get(b) || [];

        const avgA = parentsA.length > 0
          ? parentsA.reduce((sum, p) => sum + (rowPositions.get(p) ?? 0), 0) / parentsA.length
          : 0;
        const avgB = parentsB.length > 0
          ? parentsB.reduce((sum, p) => sum + (rowPositions.get(p) ?? 0), 0) / parentsB.length
          : 0;

        return avgA - avgB;
      });
      group.forEach((id, idx) => rowPositions.set(id, idx));
    }

    levelGroups.set(level, group);
  }

  // Calculate positions - LEFT TO RIGHT layout
  const positions = new Map<string, { x: number; y: number }>();

  // Find the tallest column to center others vertically
  let maxHeight = 0;
  for (let level = 0; level <= maxLevel; level++) {
    const group = levelGroups.get(level) || [];
    maxHeight = Math.max(maxHeight, group.length);
  }

  for (let level = 0; level <= maxLevel; level++) {
    const group = levelGroups.get(level) || [];
    const columnHeight = group.length;

    // Center this column vertically relative to the tallest column
    const totalColumnHeight = columnHeight * VERTICAL_SPACING;
    const maxTotalHeight = maxHeight * VERTICAL_SPACING;
    const offsetY = (maxTotalHeight - totalColumnHeight) / 2;

    group.forEach((id, idx) => {
      positions.set(id, {
        x: snapToGrid(START_X + level * HORIZONTAL_SPACING),  // Level determines X (left to right)
        y: snapToGrid(START_Y + offsetY + idx * VERTICAL_SPACING),  // Row determines Y (top to bottom)
      });
    });
  }

  // Handle disconnected nodes - place them to the right
  const disconnected = allIds.filter(id => !positions.has(id));
  if (disconnected.length > 0) {
    const baseX = START_X + (maxLevel + 1) * HORIZONTAL_SPACING;
    disconnected.forEach((id, idx) => {
      positions.set(id, {
        x: snapToGrid(baseX),
        y: snapToGrid(START_Y + idx * VERTICAL_SPACING),
      });
    });
  }

  // Build result
  return {
    triggers: triggers.map(t => ({
      id: t.id,
      position: positions.get(t.id) || t.position,
    })),
    nodes: nodes.map(n => ({
      id: n.id,
      position: positions.get(n.id) || n.position,
    })),
  };
}
