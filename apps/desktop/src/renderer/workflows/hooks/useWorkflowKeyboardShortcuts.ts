import { useEffect } from "react";
import type { DesignerModel } from "../types";

interface UseWorkflowKeyboardShortcutsProps {
  save: () => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  duplicateNode: () => void;
  run: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  delNode: () => void;
  updateModel: (model: DesignerModel) => void;
  model: DesignerModel | null;
  selectedId: string;
  runningIds: Record<string, boolean>;
  reconnecting: { wireIndex: number; end: "from" | "to" } | null;
  setReconnecting: (value: { wireIndex: number; end: "from" | "to" } | null) => void;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: (ids: Set<string>) => void;
  selectedWireIndex: number | null;
  setSelectedWireIndex: (index: number | null) => void;
  setConnectingFrom: (id: string) => void;
}

export function useWorkflowKeyboardShortcuts({
  save,
  undo,
  redo,
  duplicateNode,
  run,
  stop,
  delNode,
  updateModel,
  model,
  selectedId,
  runningIds,
  reconnecting,
  setReconnecting,
  selectedNodeId,
  setSelectedNodeId,
  selectedNodeIds,
  setSelectedNodeIds,
  selectedWireIndex,
  setSelectedWireIndex,
  setConnectingFrom,
}: UseWorkflowKeyboardShortcutsProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || "").toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      const target = e.target as any;
      const tag = String(target?.tagName || "").toLowerCase();
      const isTypingTarget = tag === "input" || tag === "textarea" || target?.isContentEditable === true;

      if (mod && key === "s") {
        e.preventDefault();
        save();
        return;
      }

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if ((mod && key === "y") || (mod && key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
        return;
      }

      if (mod && key === "d") {
        e.preventDefault();
        duplicateNode();
        return;
      }

      if (mod && key === "a" && !isTypingTarget) {
        e.preventDefault();
        if (model) {
          const allIds = new Set([...model.triggers.map((t) => t.id), ...model.nodes.map((n) => n.id)]);
          setSelectedNodeIds(allIds);
          setSelectedNodeId(allIds.size > 0 ? [...allIds][0] : "");
        }
        return;
      }

      if (isTypingTarget) return;

      if (mod && key === "enter") {
        e.preventDefault();
        run();
        return;
      }

      if (key === "escape") {
        if (reconnecting) {
          e.preventDefault();
          setReconnecting(null);
          return;
        }
        if (selectedNodeIds.size > 1) {
          e.preventDefault();
          setSelectedNodeIds(new Set());
          setSelectedNodeId("");
          return;
        }
        if (runningIds[selectedId]) {
          e.preventDefault();
          stop();
        } else {
          setSelectedNodeId("");
          setSelectedNodeIds(new Set());
          setSelectedWireIndex(null);
          setConnectingFrom("");
        }
      }

      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        if (selectedWireIndex !== null && model) {
          const newWires = model.wires.filter((_, i) => i !== selectedWireIndex);
          updateModel({ ...model, wires: newWires });
          setSelectedWireIndex(null);
        } else if (selectedNodeIds.size > 0 || selectedNodeId) {
          delNode();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    save,
    undo,
    redo,
    duplicateNode,
    run,
    stop,
    delNode,
    updateModel,
    model,
    selectedId,
    runningIds,
    reconnecting,
    setReconnecting,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedWireIndex,
    setSelectedWireIndex,
    setConnectingFrom,
  ]);
}
