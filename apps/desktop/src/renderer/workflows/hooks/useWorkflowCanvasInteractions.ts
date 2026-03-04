import { useCallback, useRef, useState } from "react";
import type { DesignerModel } from "../types";
import type { AlignmentGuide } from "../utils/alignment";
import { calculateSnapPosition, snapToGrid } from "../utils/alignment";
import type { WorkflowContextMenu } from "../layout/types";

interface UseWorkflowCanvasInteractionsProps {
  model: DesignerModel | null;
  setModel: (model: DesignerModel) => void;
  updateModel: (model: DesignerModel) => void;
  zoom: number;
  canvasRef: React.RefObject<HTMLDivElement>;
  setDirty: (dirty: boolean) => void;
}

export function useWorkflowCanvasInteractions({
  model,
  setModel,
  updateModel,
  zoom,
  canvasRef,
  setDirty,
}: UseWorkflowCanvasInteractionsProps) {
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [connectingFrom, setConnectingFrom] = useState("");
  const [selectedWireIndex, setSelectedWireIndex] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState<{ wireIndex: number; end: "from" | "to" } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [multiDragOffsets, setMultiDragOffsets] = useState<Map<string, { ox: number; oy: number }> | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const isMarqueeRef = useRef(false);
  const justFinishedMarqueeRef = useRef(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (model?.locked) return;

      try {
        const d = JSON.parse(e.dataTransfer.getData("text/plain"));
        const rect = canvasRef.current?.getBoundingClientRect();
        const rawX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
        const rawY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
        const x = snapToGrid(Math.max(0, rawX));
        const y = snapToGrid(Math.max(0, rawY));
        const safeKind = String(d.k || "step").replace(/\./g, "_");
        const id = `${safeKind}_${Date.now().toString(36)}`;
        if (!model) return;

        if (d.k === "trigger") {
          updateModel({
            ...model,
            triggers: [...model.triggers, { id, type: d.t, label: d.label, args: d.args || {}, position: { x, y } }],
          });
        } else {
          updateModel({
            ...model,
            nodes: [...model.nodes, { id, type: d.k, tool: d.t, label: d.label, args: d.args || {}, position: { x, y } }],
          });
        }
      } catch {
        // no-op
      }
    },
    [canvasRef, model, updateModel, zoom]
  );

  const handleNodeMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (model?.locked) return;
      const allItems = [...(model?.triggers || []), ...(model?.nodes || [])];
      const item = allItems.find((n) => n.id === id);
      if (!item) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
      const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;

      if (selectedNodeIds.has(id) && selectedNodeIds.size > 1) {
        const offsets = new Map<string, { ox: number; oy: number }>();
        for (const nid of selectedNodeIds) {
          const n = allItems.find((i) => i.id === nid);
          if (n) offsets.set(nid, { ox: canvasX - n.position.x, oy: canvasY - n.position.y });
        }
        setMultiDragOffsets(offsets);
        setDragging({ id, ox: canvasX - item.position.x, oy: canvasY - item.position.y });
      } else {
        setMultiDragOffsets(null);
        setDragging({ id, ox: canvasX - item.position.x, oy: canvasY - item.position.y });
      }
    },
    [canvasRef, model, selectedNodeIds, zoom]
  );

  const handleNodeContextMenu = useCallback(
    (id: string, e: React.MouseEvent, setContextMenu: (menu: WorkflowContextMenu | null) => void) => {
      e.preventDefault();
      if (!selectedNodeIds.has(id)) {
        setSelectedNodeId(id);
        setSelectedNodeIds(new Set([id]));
      } else {
        setSelectedNodeId(id);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId: id, type: "node" });
    },
    [selectedNodeIds]
  );

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent, setContextMenu: (menu: WorkflowContextMenu | null) => void) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-node-id]")) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: "canvas" });
    },
    []
  );

  const handleWireContextMenu = useCallback(
    (wireIndex: number, e: React.MouseEvent, setContextMenu: (menu: WorkflowContextMenu | null) => void) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedWireIndex(wireIndex);
      setContextMenu({ x: e.clientX, y: e.clientY, wireIndex, type: "wire" });
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isMarqueeRef.current && selectionBox) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
        const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
        setSelectionBox((prev) => (prev ? { ...prev, endX: canvasX, endY: canvasY } : prev));

        if (model) {
          const allItems = [...model.triggers, ...model.nodes];
          const bx1 = Math.min(selectionBox.startX, canvasX);
          const by1 = Math.min(selectionBox.startY, canvasY);
          const bx2 = Math.max(selectionBox.startX, canvasX);
          const by2 = Math.max(selectionBox.startY, canvasY);
          const NODE_W = 256;
          const NODE_H = 80;
          const ids = new Set<string>();
          for (const item of allItems) {
            const ix = item.position.x;
            const iy = item.position.y;
            if (ix + NODE_W > bx1 && ix < bx2 && iy + NODE_H > by1 && iy < by2) {
              ids.add(item.id);
            }
          }
          setSelectedNodeIds(ids);
        }
        return;
      }

      if (!dragging || !model) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
      const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;

      if (multiDragOffsets && multiDragOffsets.size > 1) {
        const newTriggers = [...model.triggers];
        const newNodes = [...model.nodes];
        for (const [nid, off] of multiDragOffsets) {
          const nx = Math.max(0, canvasX - off.ox);
          const ny = Math.max(0, canvasY - off.oy);
          const snapped = snapToGrid(nx);
          const snappedY = snapToGrid(ny);
          const ti = newTriggers.findIndex((t) => t.id === nid);
          if (ti >= 0) {
            newTriggers[ti] = { ...newTriggers[ti], position: { x: snapped, y: snappedY } };
          } else {
            const ni = newNodes.findIndex((n) => n.id === nid);
            if (ni >= 0) {
              newNodes[ni] = { ...newNodes[ni], position: { x: snapped, y: snappedY } };
            }
          }
        }
        setModel({ ...model, triggers: newTriggers, nodes: newNodes });
        setDirty(true);
        setAlignmentGuides([]);
        return;
      }

      const rawX = Math.max(0, canvasX - dragging.ox);
      const rawY = Math.max(0, canvasY - dragging.oy);
      const allNodes = [...model.triggers, ...model.nodes];
      const { x, y, guides } = calculateSnapPosition(dragging.id, rawX, rawY, allNodes);
      setAlignmentGuides(guides);

      const ti = model.triggers.findIndex((t) => t.id === dragging.id);
      if (ti >= 0) {
        const triggers = [...model.triggers];
        triggers[ti] = { ...triggers[ti], position: { x, y } };
        setModel({ ...model, triggers });
        setDirty(true);
      } else {
        const ni = model.nodes.findIndex((n) => n.id === dragging.id);
        if (ni >= 0) {
          const nodes = [...model.nodes];
          nodes[ni] = { ...nodes[ni], position: { x, y } };
          setModel({ ...model, nodes });
          setDirty(true);
        }
      }
    },
    [canvasRef, dragging, model, multiDragOffsets, selectionBox, setDirty, setModel, zoom]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-node-id]") || target.closest("circle") || target.closest("path")) return;
      if (e.button !== 0) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      const canvasX = (e.clientX - (rect?.left || 0) + (canvasRef.current?.scrollLeft || 0)) / zoom;
      const canvasY = (e.clientY - (rect?.top || 0) + (canvasRef.current?.scrollTop || 0)) / zoom;
      isMarqueeRef.current = true;
      setSelectionBox({ startX: canvasX, startY: canvasY, endX: canvasX, endY: canvasY });
    },
    [canvasRef, zoom]
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      justFinishedMarqueeRef.current = true;
      setSelectionBox(null);
      return;
    }
    setDragging(null);
    setMultiDragOffsets(null);
    setAlignmentGuides([]);
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    setDragging(null);
    setMultiDragOffsets(null);
    setAlignmentGuides([]);
    isMarqueeRef.current = false;
    setSelectionBox(null);
  }, []);

  const handleNodeSelect = useCallback((id: string, e?: React.MouseEvent) => {
    setSelectedWireIndex(null);
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedNodeId(next.size > 0 ? id : "");
        return next;
      });
      return;
    }

    setSelectedNodeId(id);
    setSelectedNodeIds(new Set([id]));
  }, []);

  const handleConnect = useCallback(
    (id: string) => {
      if (model?.locked) return;

      if (reconnecting && model) {
        const wire = model.wires[reconnecting.wireIndex];
        if (!wire) {
          setReconnecting(null);
          return;
        }

        if (reconnecting.end === "from" && id === wire.to) {
          setReconnecting(null);
          return;
        }
        if (reconnecting.end === "to" && id === wire.from) {
          setReconnecting(null);
          return;
        }

        const newWires = [...model.wires];
        if (reconnecting.end === "from") {
          newWires[reconnecting.wireIndex] = { ...wire, from: id };
        } else {
          newWires[reconnecting.wireIndex] = { ...wire, to: id };
        }
        updateModel({ ...model, wires: newWires });
        setReconnecting(null);
        setSelectedWireIndex(null);
        return;
      }

      if (!connectingFrom) setConnectingFrom(id);
      else {
        if (connectingFrom !== id && model) updateModel({ ...model, wires: [...model.wires, { from: connectingFrom, to: id }] });
        setConnectingFrom("");
      }
    },
    [connectingFrom, model, reconnecting, updateModel]
  );

  const startReconnect = useCallback((wireIndex: number, end: "from" | "to") => {
    if (model?.locked) return;
    setReconnecting({ wireIndex, end });
  }, [model]);

  const clearCanvasSelection = useCallback(() => {
    // Skip clearing if a marquee drag just finished — the click event
    // fires right after mouseUp and would wipe out the selection
    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false;
      return;
    }
    setSelectedNodeId("");
    setSelectedNodeIds(new Set());
    setConnectingFrom("");
    setSelectedWireIndex(null);
    setReconnecting(null);
  }, []);

  return {
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    connectingFrom,
    setConnectingFrom,
    selectedWireIndex,
    setSelectedWireIndex,
    reconnecting,
    setReconnecting,
    selectionBox,
    alignmentGuides,
    isMarqueeRef,
    handleDrop,
    handleNodeMouseDown,
    handleNodeContextMenu,
    handleCanvasContextMenu,
    handleWireContextMenu,
    handleMouseMove,
    handleCanvasMouseDown,
    handleCanvasMouseUp,
    handleCanvasMouseLeave,
    handleNodeSelect,
    handleConnect,
    startReconnect,
    clearCanvasSelection,
  };
}
