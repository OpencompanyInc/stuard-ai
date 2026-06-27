import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextItem, FileNavRef } from "../components/FileNavigator";
import { chooseDropdownPlacement } from "../utils/dropdownPlacement";

interface UseFileNavigatorOptions {
  query: string;
  setQuery: (value: string) => void;
  onAddContext?: (item: ContextItem) => void;
}

interface FileNavOverlayPos {
  left: number;
  top: number;
  placement: "top" | "bottom";
  width: number;
}

/**
 * Wires the @-style file/context picker to a textarea. Both ChatView and
 * LauncherView use this so the behavior stays consistent across overlay modes.
 */
export function useFileNavigator({
  query,
  setQuery,
  onAddContext,
}: UseFileNavigatorOptions) {
  const [showFileNav, setShowFileNav] = useState(false);
  const [fileNavFilter, setFileNavFilter] = useState("");
  const [fileNavOverlay, setFileNavOverlay] = useState<FileNavOverlayPos | null>(
    null,
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileNavRef = useRef<FileNavRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Watch the textarea for an @-trigger. The "@<filter>" stays visible in the
  // input bar; on a successful pick we strip it, on dismissal we leave it.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const lastAt = query.lastIndexOf("@");
      if (lastAt === -1) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      const afterAt = query.substring(lastAt + 1);
      if (/\s/.test(afterAt)) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      const charBefore = lastAt > 0 ? query[lastAt - 1] : " ";
      const validTrigger =
        charBefore === " " || charBefore === "\n" || lastAt === 0;
      if (!validTrigger) {
        setShowFileNav(false);
        setFileNavFilter("");
        return;
      }
      setShowFileNav(true);
      setFileNavFilter(afterAt);
    }, 60);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const updateFileNavOverlayPos = useCallback(() => {
    if (!showFileNav) return;
    const el = textareaRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 10;
    const dropdownGap = 12;
    const width = Math.min(Math.max(320, rect.width), 600);

    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, window.innerWidth - width - margin),
    );

    const spaceAbove = rect.top - margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const placement = chooseDropdownPlacement({
      currentPlacement: fileNavOverlay?.placement ?? "bottom",
      spaceAbove,
      spaceBelow,
      minComfortableSpace: 280,
      hysteresis: 36,
    });
    const top =
      placement === "top" ? rect.top - dropdownGap : rect.bottom + dropdownGap;

    setFileNavOverlay({ left, top, placement, width });
  }, [fileNavOverlay?.placement, showFileNav]);

  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();
    const handler = () => updateFileNavOverlayPos();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [showFileNav, updateFileNavOverlayPos]);

  useEffect(() => {
    if (!showFileNav) return;
    updateFileNavOverlayPos();
  }, [showFileNav, fileNavFilter, updateFileNavOverlayPos]);

  const handleFileSelect = useCallback(
    (item: ContextItem) => {
      const lastAt = query.lastIndexOf("@");
      if (lastAt >= 0) {
        setQuery(query.substring(0, lastAt).trimEnd());
      }
      onAddContext?.(item);
      setShowFileNav(false);
      setFileNavFilter("");
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [query, setQuery, onAddContext],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      const lastAt = query.lastIndexOf("@");
      if (lastAt >= 0) {
        setQuery(query.substring(0, lastAt + 1) + path);
      }
    },
    [query, setQuery],
  );

  // Dismiss without selecting; leave whatever is in the textarea alone.
  const handleCloseFileNav = useCallback(() => {
    setShowFileNav(false);
    setFileNavFilter("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // Programmatically open via the "+" menu — append "@" so the useEffect picks
  // it up via the existing trigger detection.
  const handleOpenFileNav = useCallback(() => {
    const needsSpace = query.length > 0 && !/\s$/.test(query);
    setQuery(query + (needsSpace ? " @" : "@"));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [query, setQuery]);

  return {
    showFileNav,
    fileNavFilter,
    fileNavOverlay,
    textareaRef,
    fileNavRef,
    handleFileSelect,
    handleNavigate,
    handleCloseFileNav,
    handleOpenFileNav,
  };
}
