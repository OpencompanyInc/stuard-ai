import { useEffect, useRef } from "react";
import type { DesignerModel } from "../types";

interface UseWorkflowKeyboardShortcutsProps {
  save: () => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  duplicateNode: () => void;
  copyNodes: () => void | Promise<void>;
  cutNodes: () => void | Promise<void>;
  pasteNodes: () => void | Promise<void>;
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
  onGroup?: () => void;
  onUngroup?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onZoomFit?: () => void;
}

export function useWorkflowKeyboardShortcuts({
  save,
  undo,
  redo,
  duplicateNode,
  copyNodes,
  cutNodes,
  pasteNodes,
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
  onGroup,
  onUngroup,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomFit,
}: UseWorkflowKeyboardShortcutsProps) {
  // Tracks whether the user's last pointer interaction landed inside the canvas.
  // Canvas-editing shortcuts (copy/cut/paste/select-all/undo/redo/duplicate/
  // delete/run) only fire when this is true, so they never hijack typing,
  // text selection, or native undo happening in the chat panel or inspector
  // (both of which live OUTSIDE the [data-onboarding="workflow-canvas"] subtree).
  const canvasActiveRef = useRef(true);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      canvasActiveRef.current = !!el?.closest?.('[data-onboarding="workflow-canvas"]');
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || "").toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      const target = e.target as any;
      const tag = String(target?.tagName || "").toLowerCase();
      const isTypingTarget = tag === "input" || tag === "textarea" || target?.isContentEditable === true;

      // True when the user has actually highlighted text anywhere (chat history,
      // inspector, labels, …). The chat transcript is a plain <div>, not an
      // input, so isTypingTarget misses it — without this check Ctrl+C would
      // hijack the native copy and put the selected node's JSON on the clipboard
      // instead of the highlighted text.
      const hasTextSelection = () => {
        const sel = window.getSelection?.();
        return !!sel && sel.type === "Range" && sel.toString().trim().length > 0;
      };

      // Canvas-editing shortcuts are gated on this. Ctrl+S stays global.
      const canvasActive = canvasActiveRef.current;

      if (mod && key === "s") {
        e.preventDefault();
        save();
        return;
      }

      if (mod && key === "z" && !e.shiftKey && canvasActive) {
        e.preventDefault();
        undo();
        return;
      }

      if (canvasActive && ((mod && key === "y") || (mod && key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if (mod && key === "d" && canvasActive) {
        e.preventDefault();
        duplicateNode();
        return;
      }

      // Copy / Cut / Paste — only when NOT typing in a text field, otherwise
      // we'd hijack the browser's native text clipboard. We also require an
      // active node selection (or, for paste, a non-empty clipboard handled
      // inside pasteNodes itself) so plain canvas clicks don't suppress
      // copying surrounding UI text.
      if (mod && key === "c" && !isTypingTarget && canvasActive) {
        // Defer to the browser when the user is copying highlighted text.
        if (hasTextSelection()) return;
        if (selectedNodeIds.size > 0 || selectedNodeId) {
          e.preventDefault();
          void copyNodes();
        }
        return;
      }

      if (mod && key === "x" && !isTypingTarget && canvasActive) {
        // Don't cut (and delete) nodes while the user has text highlighted.
        if (hasTextSelection()) return;
        if (selectedNodeIds.size > 0 || selectedNodeId) {
          e.preventDefault();
          void cutNodes();
        }
        return;
      }

      if (mod && key === "v" && !isTypingTarget && canvasActive) {
        e.preventDefault();
        void pasteNodes();
        return;
      }

      if (mod && key === "a" && !isTypingTarget && canvasActive) {
        e.preventDefault();
        if (model) {
          const allIds = new Set([...model.triggers.map((t) => t.id), ...model.nodes.map((n) => n.id)]);
          setSelectedNodeIds(allIds);
          setSelectedNodeId(allIds.size > 0 ? [...allIds][0] : "");
        }
        return;
      }

      if (mod && key === "g" && canvasActive) {
        e.preventDefault();
        if (e.shiftKey) onUngroup?.();
        else onGroup?.();
        return;
      }

      if (canvasActive && mod && (key === "=" || key === "+")) {
        e.preventDefault();
        onZoomIn?.();
        return;
      }

      if (canvasActive && mod && key === "-") {
        e.preventDefault();
        onZoomOut?.();
        return;
      }

      if (canvasActive && mod && key === "0" && !e.shiftKey) {
        e.preventDefault();
        onZoomReset?.();
        return;
      }

      if (canvasActive && mod && key === "0" && e.shiftKey) {
        e.preventDefault();
        onZoomFit?.();
        return;
      }

      if (isTypingTarget) return;

      if (mod && key === "enter" && canvasActive) {
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

      if ((key === "delete" || key === "backspace") && canvasActive) {
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
    copyNodes,
    cutNodes,
    pasteNodes,
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
    onGroup,
    onUngroup,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onZoomFit,
  ]);
}
