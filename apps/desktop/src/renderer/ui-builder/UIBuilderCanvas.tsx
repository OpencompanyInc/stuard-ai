/**
 * UIBuilderCanvas - Real-time HTML/CSS renderer using iframe
 * Renders actual custom_ui output and allows selecting/editing any element
 */

import React, { useRef, useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';

const PREVIEW_SURFACE_WIDTH = 1920;
const PREVIEW_SURFACE_HEIGHT = 1040;
const PREVIEW_WINDOW_MARGIN = 20;

export interface UIBuilderCanvasRef {
  refresh: () => void;
  updateElement: (path: string, updates: { textContent?: string; className?: string; style?: string; id?: string; attributes?: Record<string, string | undefined> }) => void;
  deleteElement: (path: string) => void;
  requestHtml: () => void;
  appendHtml: (html: string) => void;
  insertHtmlAtPoint: (html: string, point: { clientX: number; clientY: number }) => void;
  /** Programmatically select an element by its path (e.g. from the breadcrumb). */
  selectPath: (path: string | null) => void;
  /** Select the parent of the currently-selected element. */
  selectParent: () => void;
  /** Duplicate the currently-selected element in place. */
  duplicateSelected: () => void;
  /** Move the currently-selected element up/down among its siblings. */
  moveSelected: (direction: 'up' | 'down') => void;
  focus: () => void;
}

/** A single hop in the ancestor chain, used to render the selection breadcrumb. */
export interface ElementAncestor {
  path: string;
  tagName: string;
  label: string;
}

export interface SelectedElementInfo {
  path: string;
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  innerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
  attributes: Record<string, string>;
  /** Root → element ancestor chain (excludes the element itself), for breadcrumb navigation. */
  ancestors?: ElementAncestor[];
  /** True when this element can move earlier among its siblings. */
  canMoveUp?: boolean;
  /** True when this element can move later among its siblings. */
  canMoveDown?: boolean;
}

interface UIBuilderCanvasProps {
  html: string;
  css: string;
  js: string;
  canvasWidth: number;
  canvasHeight: number;
  windowPosition?: 'center' | 'topleft' | 'topcenter' | 'topright' | 'bottomleft' | 'bottomright' | 'bottomcenter' | 'mouse' | 'cursor' | 'custom';
  customX?: number;
  customY?: number;
  windowMargin?: number;
  backgroundColor: string;
  borderRadius?: number;
  zoom: number;
  showGrid: boolean;
  gridSize: number;
  previewMode: boolean;
  selectedPath: string | null;
  onSelectElement: (element: SelectedElementInfo | null) => void;
  onHoverElement: (path: string | null) => void;
  onHtmlChange?: (html: string) => void;
  /** Called when the user ctrl/⌘+scrolls to zoom; lets the parent own zoom state. */
  onZoomChange?: (zoom: number) => void;
}

export const UIBuilderCanvas = forwardRef<UIBuilderCanvasRef, UIBuilderCanvasProps>(function UIBuilderCanvas({
  html,
  css,
  js,
  canvasWidth,
  canvasHeight,
  windowPosition = 'center',
  customX,
  customY,
  windowMargin,
  backgroundColor,
  borderRadius: borderRadiusProp = 0,
  zoom,
  showGrid,
  gridSize,
  previewMode,
  selectedPath,
  onSelectElement,
  onHoverElement,
  onHtmlChange,
  onZoomChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [surfaceScale, setSurfaceScale] = useState(1);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  // Prebuilt assets (React UMD + Tailwind CSS) loaded from main process — no CDN
  const [prebuiltAssets, setPrebuiltAssets] = useState<{
    reactUmd?: string; reactDomUmd?: string; framerMotionUmd?: string; tailwindCss?: string; extraCss?: string; jitJs?: string;
  }>({});
  const assetsLoadedRef = useRef(false);

  useEffect(() => {
    if (assetsLoadedRef.current) return;
    assetsLoadedRef.current = true;
    window.desktopAPI?.customUiGetPrebuiltAssets?.().then((res: any) => {
      if (res?.ok) {
        setPrebuiltAssets({
          reactUmd: res.reactUmd,
          reactDomUmd: res.reactDomUmd,
          framerMotionUmd: res.framerMotionUmd,
          tailwindCss: res.tailwindCss,
          extraCss: res.extraCss,
          jitJs: res.jitJs,
        });
      } else {
        console.warn('[UIBuilderCanvas] Failed to load prebuilt assets, iframe will use fallback');
      }
    }).catch(() => {});
  }, []);

  const isInternalHtmlChange = useRef(false);
  const lastHtmlRef = useRef(html);

  const safeCanvasWidth = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1;
  const safeCanvasHeight = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 1;

  // The window box renders at native size inside the stage; `zoom` magnifies the
  // entire stage (so it's pannable via scroll) rather than just the iframe.
  const scaledCanvasWidth = safeCanvasWidth;
  const scaledCanvasHeight = safeCanvasHeight;
  const stageScale = surfaceScale * zoom;

  const windowOffset = useMemo(() => {
    const m = typeof windowMargin === 'number' ? windowMargin : PREVIEW_WINDOW_MARGIN;
    const centeredX = (PREVIEW_SURFACE_WIDTH - scaledCanvasWidth) / 2;
    const centeredY = (PREVIEW_SURFACE_HEIGHT - scaledCanvasHeight) / 2;
    const pos = String(windowPosition || 'center').toLowerCase().replace(/[_-]/g, '');

    switch (pos) {
      case 'topleft':
        return { x: m, y: m };
      case 'top':
      case 'topcenter':
        return { x: centeredX, y: m };
      case 'topright':
        return { x: PREVIEW_SURFACE_WIDTH - m - scaledCanvasWidth, y: m };
      case 'left':
      case 'centerleft':
        return { x: m, y: centeredY };
      case 'right':
      case 'centerright':
        return { x: PREVIEW_SURFACE_WIDTH - m - scaledCanvasWidth, y: centeredY };
      case 'bottomleft':
        return { x: m, y: PREVIEW_SURFACE_HEIGHT - m - scaledCanvasHeight };
      case 'bottom':
      case 'bottomcenter':
        return { x: centeredX, y: PREVIEW_SURFACE_HEIGHT - m - scaledCanvasHeight };
      case 'bottomright':
        return {
          x: PREVIEW_SURFACE_WIDTH - m - scaledCanvasWidth,
          y: PREVIEW_SURFACE_HEIGHT - m - scaledCanvasHeight,
        };
      case 'mouse':
      case 'cursor':
        return {
          x: PREVIEW_SURFACE_WIDTH * 0.65 - scaledCanvasWidth / 2,
          y: PREVIEW_SURFACE_HEIGHT * 0.4 - scaledCanvasHeight / 2,
        };
      case 'custom': {
        const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
        const xPct = clampPercent(typeof customX === 'number' ? customX : 50) / 100;
        const yPct = clampPercent(typeof customY === 'number' ? customY : 50) / 100;
        return {
          x: PREVIEW_SURFACE_WIDTH * xPct - scaledCanvasWidth / 2,
          y: PREVIEW_SURFACE_HEIGHT * yPct - scaledCanvasHeight / 2,
        };
      }
      case 'center':
      default:
        return { x: centeredX, y: centeredY };
    }
  }, [windowPosition, windowMargin, customX, customY, scaledCanvasWidth, scaledCanvasHeight]);

  const generateIframeContent = useCallback(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${prebuiltAssets.reactUmd ? `<script>${prebuiltAssets.reactUmd}</script>` : '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>'}
  ${prebuiltAssets.reactDomUmd ? `<script>${prebuiltAssets.reactDomUmd}</script>` : '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>'}
  ${prebuiltAssets.framerMotionUmd ? `<script>${prebuiltAssets.framerMotionUmd}</script>` : ''}
  ${prebuiltAssets.tailwindCss ? `<style>${prebuiltAssets.tailwindCss}</style>` : '<script src="https://cdn.tailwindcss.com"></script>'}
  ${prebuiltAssets.extraCss ? `<style>${prebuiltAssets.extraCss}</style>` : ''}
  ${prebuiltAssets.jitJs ? `<script>${prebuiltAssets.jitJs}</script>` : ''}
  <style>
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${backgroundColor || 'transparent'};
      -webkit-font-smoothing: antialiased;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${backgroundColor || 'transparent'};
      color: #1e293b;
      height: 100%;
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
    }
    .stuard-root {
      height: 100%;
    }

    /* Base button — matches runtime default */
    button, .btn {
      cursor: pointer; user-select: none;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 8px 16px; border: none; border-radius: 8px;
      background: #f1f5f9; color: #475569;
      font-weight: 500; font-size: 13px; gap: 8px;
      transition: all 0.15s ease;
    }
    button:hover { background: #e2e8f0; }
    button:active { transform: scale(0.98); }
    button:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-ghost { background: transparent; color: #475569; }
    .btn-ghost:hover { background: #f1f5f9; color: #1e293b; }
    .btn-outline { background: transparent; color: #4f46e5; border: 1px solid #4f46e5; }
    .btn-outline:hover { background: #eef2ff; }

    /* Input — matches runtime */
    input[type="text"], input[type="email"], input[type="password"],
    input[type="number"], input[type="url"], input[type="tel"],
    textarea, select {
      width: 100%; padding: 8px 12px; font-size: 14px;
      border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; color: #1e293b;
      outline: none; transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus, textarea:focus, select:focus {
      border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
    }
    input::placeholder, textarea::placeholder { color: #94a3b8; }

    label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }

    /* Card — matches runtime */
    .card {
      background: white; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #475569; }
    hr { border: none; height: 1px; background: #e2e8f0; margin: 16px 0; }

    .drag { -webkit-app-region: drag; }
    .no-drag { -webkit-app-region: no-drag; }

    ${css || ''}

    ${!previewMode ? `
    .drag { -webkit-app-region: no-drag !important; }
    [data-elements-path] {
      cursor: pointer !important;
    }
    [data-elements-path].ui-hovered {
      outline: 2px dashed rgba(244, 63, 94, 0.55) !important;
      outline-offset: 1px;
    }
    [data-elements-path].ui-selected {
      outline: 2px solid #f43f5e !important;
      outline-offset: 1px;
      cursor: move !important;
    }
    [data-elements-path].ui-editing {
      outline: 2px solid #10b981 !important;
      cursor: text !important;
    }
    [data-elements-path].ui-dragging {
      opacity: 0.7;
      z-index: 9999 !important;
      position: relative;
    }
    /* Floating tag label (devtools-style) */
    .uib-label {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      font: 600 10px/1.4 'Segoe UI', system-ui, sans-serif;
      padding: 1px 6px;
      border-radius: 4px 4px 4px 0;
      white-space: nowrap;
      transform: translateY(-100%);
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    }
    .uib-label-hover { background: rgba(244, 63, 94, 0.85); color: #fff; }
    .uib-label-select { background: #f43f5e; color: #fff; }
    /* Drop indicator line for inserts */
    .uib-drop-line {
      position: fixed;
      z-index: 2147483645;
      pointer-events: none;
      background: #f43f5e;
      box-shadow: 0 0 0 1px rgba(244,63,94,0.4);
      border-radius: 2px;
    }
    /* Floating selection toolbar */
    .uib-toolbar {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 1px;
      padding: 2px;
      background: #1e1e2e;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
      transform: translateY(-100%);
    }
    .uib-toolbar button {
      all: unset;
      cursor: pointer;
      width: 26px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 5px;
      color: #cbd5e1;
      font-size: 13px;
      transition: background 0.12s, color 0.12s;
    }
    .uib-toolbar button:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .uib-toolbar button:disabled { opacity: 0.3; cursor: default; }
    .uib-toolbar button.danger:hover { background: rgba(239,68,68,0.25); color: #fca5a5; }
    .uib-toolbar .sep { width: 1px; height: 14px; background: rgba(255,255,255,0.12); margin: 0 2px; }
    ` : ''}

    ${showGrid ? `
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(99, 102, 241, 0.1) 1px, transparent 1px),
        linear-gradient(90deg, rgba(99, 102, 241, 0.1) 1px, transparent 1px);
      background-size: ${gridSize}px ${gridSize}px;
      z-index: 10000;
    }
    ` : ''}
  </style>
</head>
<body>
  <div class="stuard-root">${html || ''}</div>
  <script>
    window.initialData = {};
    window.stuard = {
      close: (data) => console.log('[Preview] stuard.close()', data),
      submit: (data, keepOpen) => console.log('[Preview] stuard.submit()', data, keepOpen),
      action: (name, data) => console.log('[Preview] stuard.action()', name, data),
      emit: (event, data) => console.log('[Preview] stuard.emit()', event, data),
      on: (event, cb) => { console.log('[Preview] stuard.on()', event); return () => {}; },
      onDataUpdate: (cb) => { return () => {}; },
      onVarUpdate: (cb) => { return () => {}; },
      onPageChange: (cb) => { return () => {}; },
      onStreamChunk: (cb) => { return () => {}; },
      getData: async () => ({}),
      getWindowId: async () => 'preview',
      getFlowId: async () => null,
      updateData: async (data) => {},
      callTool: async (name, args) => {
        console.log('[Preview] stuard.callTool:', name, args);
        return { ok: false, error: 'Preview mode - tools disabled' };
      },
      callNode: async (nodeId, data) => {
        console.log('[Preview] stuard.callNode:', nodeId, data);
        return { ok: false, error: 'Preview mode - nodes disabled' };
      },
      pickFile: async (opts) => ({ canceled: true, filePaths: [] }),
      pickFolder: async (opts) => ({ canceled: true, filePaths: [] }),
      pickSavePath: async (opts) => ({ canceled: true }),
      readFile: async () => '',
      writeFile: async () => {},
      notify: (title, body) => console.log('[Preview] notify:', title, body),
      copyToClipboard: async (text) => {},
      readClipboard: async () => '',
      subscribeVars: async (names) => {},
      getVar: async (name) => ({ ok: false, name, value: undefined }),
      setVar: async (name, value) => ({ ok: true, name, value, type: typeof value }),
      subscribeStream: async (id, cb) => ({ ok: false }),
      unsubscribeStream: async () => {},
      navigate: (page, data) => console.log('[Preview] navigate:', page, data),
      getCurrentPage: async () => null,
      stopWorkflow: () => {},
      log: (msg) => console.log('[Preview]', msg),
      setAlwaysOnTop: (flag) => {},
      resize: (w, h) => {},
      moveTo: (x, y) => {},
      center: () => {},
      minimize: () => {},
      getScreenInfo: async () => ({ width: 1920, height: 1080, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    };
    window.$stuard = {
      tool: window.stuard.callTool,
      node: window.stuard.callNode,
      emit: window.stuard.emit,
      close: window.stuard.close,
      submit: window.stuard.submit,
      nav: window.stuard.navigate,
      setVar: window.stuard.setVar,
      getVar: window.stuard.getVar,
    };

    // ─── React Runtime (mirrors custom-ui runtime) ─────────────────────────
    var __reactOk = (typeof React !== 'undefined' && typeof ReactDOM !== 'undefined');
    var useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, useLayoutEffect, Fragment, createElement;
    if (__reactOk) {
      useState = React.useState; useEffect = React.useEffect;
      useRef = React.useRef; useMemo = React.useMemo;
      useCallback = React.useCallback; useReducer = React.useReducer;
      useContext = React.useContext; useLayoutEffect = React.useLayoutEffect;
      Fragment = React.Fragment; createElement = React.createElement;
    }

    // Framer Motion globals
    var motion = (window.Motion && window.Motion.motion) ? window.Motion.motion : undefined;
    var AnimatePresence = (window.Motion && window.Motion.AnimatePresence) ? window.Motion.AnimatePresence : undefined;
    var useAnimation = (window.Motion && window.Motion.useAnimation) ? window.Motion.useAnimation : undefined;
    var useMotionValue = (window.Motion && window.Motion.useMotionValue) ? window.Motion.useMotionValue : undefined;
    var useTransform = (window.Motion && window.Motion.useTransform) ? window.Motion.useTransform : undefined;
    var useSpring = (window.Motion && window.Motion.useSpring) ? window.Motion.useSpring : undefined;
    var hasStuardApi = typeof window.stuard !== 'undefined';
    window.__varListeners = {};

    // useVar – preview stub (local state only, no real variable IPC)
    function useVar(varName, defaultValue) {
      if (!__reactOk) return [defaultValue, function(){}];
      var pair = useState(defaultValue);
      var setVar = function(v) {
        pair[1](v);
        console.log('[Preview] useVar set:', varName, '=', v);
      };
      return [pair[0], setVar];
    }

    // useStream – preview stub
    function useStream(streamId) {
      return { chunk: null, frame: null, text: null, fullText: '', index: -1, done: false };
    }

    function getDesignerRoot() {
      return document.querySelector('.stuard-root');
    }

    function getElementPath(el) {
      const root = getDesignerRoot();
      if (!el || !root || el === root || el === document.body || el === document.documentElement) return null;
      const parts = [];
      let current = el;
      while (current && current !== root) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector += '#' + current.id;
          parts.unshift(selector);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-child(' + index + ')';
        }
        parts.unshift(selector);
        current = parent;
      }
      return parts.join(' > ');
    }

    function sanitizeClone(node) {
      // Remove all <script> tags — these are designer/preview scaffolding, never user content
      node.querySelectorAll('script').forEach(el => el.remove());
      // Remove designer data attributes and classes
      node.querySelectorAll('[data-elements-path]').forEach(el => {
        el.removeAttribute('data-elements-path');
        el.removeAttribute('contenteditable');
        el.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging', 'ui-editing');
        if (el.getAttribute && el.getAttribute('class') === '') el.removeAttribute('class');
      });
      // Strip designer overlay chrome if it ever leaked into the tree
      node.querySelectorAll('.uib-toolbar, .uib-label, .uib-drop-line').forEach(el => el.remove());
      // Unwrap nested .stuard-root divs (corruption artifact)
      node.querySelectorAll('.stuard-root').forEach(el => {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.remove();
      });
    }

    function emitHtmlUpdate() {
      const root = getDesignerRoot();
      if (!root) {
        window.parent.postMessage({ type: 'html', html: '' }, '*');
        return;
      }
      const clone = root.cloneNode(true);
      sanitizeClone(clone);
      window.parent.postMessage({ type: 'html', html: clone.innerHTML }, '*');
    }

    // Human-friendly label for an element (used by breadcrumb + floating tags)
    function getElementLabel(el) {
      if (!el) return '';
      let label = el.tagName.toLowerCase();
      if (el.id) return label + '#' + el.id;
      const cls = (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '')
        .split(/\\s+/).filter(Boolean)
        .filter(c => !c.startsWith('ui-'))[0];
      if (cls) label += '.' + cls;
      const page = el.getAttribute && el.getAttribute('data-page');
      if (page) label += ' · ' + page;
      return label;
    }

    // Root → element ancestor chain (excludes element itself) for breadcrumb
    function getAncestors(el) {
      const root = getDesignerRoot();
      const chain = [];
      let cur = el && el.parentElement;
      while (cur && cur !== root && cur !== document.body) {
        const p = getElementPath(cur);
        if (p) chain.unshift({ path: p, tagName: cur.tagName.toLowerCase(), label: getElementLabel(cur) });
        cur = cur.parentElement;
      }
      return chain;
    }

    function getElementInfo(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);

      const styles = {};
      const relevantProps = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'borderRadius', 'display', 'flexDirection', 'gap', 'alignItems', 'justifyContent'];
      relevantProps.forEach(prop => { styles[prop] = computed[prop]; });
      const attributes = {};
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('data-elements')) {
          attributes[attr.name] = attr.value;
        }
      }
      let className = '';
      if (typeof el.className === 'string') {
        className = el.className;
      } else if (el.className && el.className.baseVal !== undefined) {
        className = el.className.baseVal;
      } else if (el.getAttribute) {
        className = el.getAttribute('class') || '';
      }
      // Sibling position (ignoring designer-only nodes) for move affordances
      const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.nodeType === 1) : [];
      const idx = siblings.indexOf(el);
      return {
        path: getElementPath(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        className: className,
        textContent: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent : '',
        innerHTML: el.innerHTML,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        styles,
        attributes,
        ancestors: getAncestors(el),
        canMoveUp: idx > 0,
        canMoveDown: idx >= 0 && idx < siblings.length - 1,
      };
    }

    function initializeElements() {
      const root = getDesignerRoot();
      if (!root) {
        window.parent.postMessage({ type: 'ready' }, '*');
        return;
      }
      const elements = root.querySelectorAll('*');
      elements.forEach(el => {
        const path = getElementPath(el);
        if (path) {
          el.setAttribute('data-elements-path', path);
        } else {
          el.removeAttribute('data-elements-path');
        }
      });
      window.parent.postMessage({ type: 'ready' }, '*');
    }

    function findElementByPath(path) {
      if (!path) return null;
      const root = getDesignerRoot();
      if (!root) return null;
      try {
        return root.querySelector('[data-elements-path="' + path.replace(/"/g, '\\"') + '"]');
      } catch(e) {
        return null;
      }
    }

    ${!previewMode ? `
    let selectedPath = null;
    let hoveredPath = null;
    let isDragging = false;
    let draggedElement = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let elementStartX = 0;
    let elementStartY = 0;
    let editingElement = null;

    // ─── Overlay chrome (labels + selection toolbar) ──────────────────────────
    const hoverLabel = document.createElement('div');
    hoverLabel.className = 'uib-label uib-label-hover';
    hoverLabel.style.display = 'none';
    const selectLabel = document.createElement('div');
    selectLabel.className = 'uib-label uib-label-select';
    selectLabel.style.display = 'none';
    const toolbar = document.createElement('div');
    toolbar.className = 'uib-toolbar';
    toolbar.style.display = 'none';
    const TB_BTNS = [
      { act: 'parent', title: 'Select parent', svg: '⌃' },
      { act: 'up', title: 'Move up', svg: '↑' },
      { act: 'down', title: 'Move down', svg: '↓' },
      { act: 'dup', title: 'Duplicate', svg: '⧉' },
      { sep: true },
      { act: 'delete', title: 'Delete', svg: '🗑', danger: true },
    ];
    TB_BTNS.forEach(b => {
      if (b.sep) { const s = document.createElement('span'); s.className = 'sep'; toolbar.appendChild(s); return; }
      const btn = document.createElement('button');
      btn.textContent = b.svg;
      btn.title = b.title;
      btn.setAttribute('data-act', b.act);
      if (b.danger) btn.className = 'danger';
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const el = selectedPath ? findElementByPath(selectedPath) : null;
        if (!el) return;
        if (b.act === 'parent') selectParentEl(el);
        else if (b.act === 'up') moveEl(el, 'up');
        else if (b.act === 'down') moveEl(el, 'down');
        else if (b.act === 'dup') duplicateEl(el);
        else if (b.act === 'delete') deleteEl(el);
      });
      toolbar.appendChild(btn);
    });
    function ensureChrome() {
      if (!hoverLabel.isConnected) document.body.appendChild(hoverLabel);
      if (!selectLabel.isConnected) document.body.appendChild(selectLabel);
      if (!toolbar.isConnected) document.body.appendChild(toolbar);
    }
    function positionLabel(label, el) {
      if (!el) { label.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      label.style.display = 'block';
      label.style.left = Math.max(2, r.left) + 'px';
      label.style.top = Math.max(12, r.top) + 'px';
      label.textContent = getElementLabel(el);
    }
    function positionToolbar(el) {
      if (!el) { toolbar.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      ensureChrome();
      // enable/disable move buttons by sibling position
      const sibs = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.nodeType === 1) : [];
      const idx = sibs.indexOf(el);
      toolbar.querySelector('[data-act="up"]').disabled = !(idx > 0);
      toolbar.querySelector('[data-act="down"]').disabled = !(idx >= 0 && idx < sibs.length - 1);
      toolbar.querySelector('[data-act="parent"]').disabled = !(el.parentElement && el.parentElement !== getDesignerRoot());
      toolbar.style.display = 'flex';
      const top = r.top > 30 ? r.top - 4 : r.bottom + 28;
      toolbar.style.left = Math.max(2, r.right - toolbar.offsetWidth) + 'px';
      toolbar.style.top = top + 'px';
    }
    function refreshOverlays() {
      ensureChrome();
      const sel = selectedPath ? findElementByPath(selectedPath) : null;
      positionLabel(selectLabel, sel);
      positionToolbar(sel);
      const hov = (hoveredPath && hoveredPath !== selectedPath) ? findElementByPath(hoveredPath) : null;
      positionLabel(hoverLabel, hov);
    }

    // Apply selection visuals only (no message to parent) — used when parent drives selection
    function applySelection(el) {
      document.querySelectorAll('.ui-selected').forEach(n => n.classList.remove('ui-selected'));
      if (el) {
        el.classList.add('ui-selected');
        el.classList.remove('ui-hovered');
        selectedPath = el.getAttribute('data-elements-path');
      } else {
        selectedPath = null;
      }
      refreshOverlays();
    }
    // Select + notify parent — used for in-iframe interactions
    function emitSelect(el) {
      applySelection(el);
      window.parent.postMessage({ type: 'select', element: el ? getElementInfo(el) : null }, '*');
    }

    // ─── Element operations ───────────────────────────────────────────────────
    function selectParentEl(el) {
      const parent = el && el.parentElement;
      if (parent && parent !== getDesignerRoot() && parent !== document.body) emitSelect(parent);
    }
    function moveEl(el, dir) {
      const parent = el && el.parentElement;
      if (!parent) return;
      if (dir === 'up' && el.previousElementSibling) {
        parent.insertBefore(el, el.previousElementSibling);
      } else if (dir === 'down' && el.nextElementSibling) {
        parent.insertBefore(el.nextElementSibling, el);
      } else return;
      initializeElements();
      emitSelect(el);
      emitHtmlUpdate();
    }
    function duplicateEl(el) {
      if (!el || !el.parentElement) return;
      const clone = el.cloneNode(true);
      clone.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging');
      el.parentElement.insertBefore(clone, el.nextSibling);
      initializeElements();
      emitSelect(clone);
      emitHtmlUpdate();
    }
    function deleteEl(el) {
      if (!el || el === document.body) return;
      el.remove();
      emitSelect(null);
      emitHtmlUpdate();
    }
    function startInlineEdit(el) {
      if (!el) return;
      // Only allow inline edit for leaf text-ish nodes
      const hasOnlyText = el.childNodes.length === 0 || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3);
      if (!hasOnlyText) return;
      editingElement = el;
      el.classList.add('ui-editing');
      el.setAttribute('contenteditable', 'true');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const selapi = window.getSelection();
      selapi.removeAllRanges();
      selapi.addRange(range);
      toolbar.style.display = 'none';
    }
    function endInlineEdit() {
      if (!editingElement) return;
      const el = editingElement;
      editingElement = null;
      el.classList.remove('ui-editing');
      el.removeAttribute('contenteditable');
      emitHtmlUpdate();
      window.parent.postMessage({ type: 'elementUpdated', element: getElementInfo(el) }, '*');
      refreshOverlays();
    }

    window.addEventListener('scroll', refreshOverlays, true);

    document.body.addEventListener('mousedown', (e) => {
      window.focus();
      if (e.target.closest('.uib-toolbar')) return;
      if (editingElement) return;
      const target = e.target.closest('[data-elements-path]');
      if (target && target.classList.contains('ui-selected')) {
        isDragging = true;
        draggedElement = target;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const style = window.getComputedStyle(target);
        const transform = style.transform;
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrix(transform);
          elementStartX = matrix.m41;
          elementStartY = matrix.m42;
        } else {
          elementStartX = 0;
          elementStartY = 0;
        }
        target.classList.add('ui-dragging');
        e.preventDefault();
      }
    });

    document.body.addEventListener('mousemove', (e) => {
      if (isDragging && draggedElement) {
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        const newX = elementStartX + deltaX;
        const newY = elementStartY + deltaY;
        const gridSize = ${gridSize};
        const snappedX = Math.round(newX / gridSize) * gridSize;
        const snappedY = Math.round(newY / gridSize) * gridSize;
        draggedElement.style.transform = 'translate(' + snappedX + 'px, ' + snappedY + 'px)';
        refreshOverlays();
        return;
      }
      if (e.target.closest('.uib-toolbar') || e.target.closest('.uib-label')) return;
      const target = e.target.closest('[data-elements-path]');
      const path = target ? target.getAttribute('data-elements-path') : null;
      if (path !== hoveredPath) {
        hoveredPath = path;
        document.querySelectorAll('.ui-hovered').forEach(n => n.classList.remove('ui-hovered'));
        if (target && path !== selectedPath) target.classList.add('ui-hovered');
        window.parent.postMessage({ type: 'hover', path }, '*');
        positionLabel(hoverLabel, (path && path !== selectedPath) ? target : null);
      }
    });

    document.body.addEventListener('mouseleave', () => {
      hoveredPath = null;
      document.querySelectorAll('.ui-hovered').forEach(n => n.classList.remove('ui-hovered'));
      hoverLabel.style.display = 'none';
    });

    document.body.addEventListener('mouseup', (e) => {
      if (isDragging && draggedElement) {
        draggedElement.classList.remove('ui-dragging');
        const info = getElementInfo(draggedElement);
        window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
        window.parent.postMessage({ type: 'positionChanged' }, '*');
        isDragging = false;
        draggedElement = null;
        refreshOverlays();
      }
    });

    document.addEventListener('keydown', (e) => {
      // Inline edit: commit on Enter (without shift), cancel on Escape
      if (editingElement) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endInlineEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); endInlineEdit(); }
        return;
      }
      const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
      if (typing) return;
      const el = selectedPath ? findElementByPath(selectedPath) : null;
      if ((e.key === 'Delete' || e.key === 'Backspace') && el && el !== document.body) {
        e.preventDefault();
        deleteEl(el);
      } else if (e.key === 'Escape') {
        emitSelect(null);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && el) {
        e.preventDefault();
        duplicateEl(el);
      } else if (e.key === 'Enter' && el) {
        e.preventDefault();
        startInlineEdit(el);
      }
    });

    document.body.addEventListener('click', (e) => {
      window.focus();
      if (e.target.closest('.uib-toolbar')) return;
      if (editingElement) return;
      if (isDragging) {
        isDragging = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest('[data-elements-path]');
      emitSelect(target || null);
    }, true);

    document.body.addEventListener('dblclick', (e) => {
      if (editingElement) return;
      const target = e.target.closest('[data-elements-path]');
      if (target) { e.preventDefault(); e.stopPropagation(); startInlineEdit(target); }
    }, true);

    window.addEventListener('message', (e) => {
      if (e.data.type === 'setSelected') {
        const el = e.data.path ? findElementByPath(e.data.path) : null;
        if (e.data.emit) emitSelect(el || null);
        else applySelection(el || null);
      } else if (e.data.type === 'selectParent') {
        const el = selectedPath ? findElementByPath(selectedPath) : null;
        if (el) selectParentEl(el);
      } else if (e.data.type === 'duplicateSelected') {
        const el = selectedPath ? findElementByPath(selectedPath) : null;
        if (el) duplicateEl(el);
      } else if (e.data.type === 'moveSelected') {
        const el = selectedPath ? findElementByPath(selectedPath) : null;
        if (el) moveEl(el, e.data.direction === 'down' ? 'down' : 'up');
      } else if (e.data.type === 'deleteSelected') {
        const el = selectedPath ? findElementByPath(selectedPath) : null;
        if (el && el !== document.body) deleteEl(el);
      } else if (e.data.type === 'updateElement') {
        const el = findElementByPath(e.data.path);
        if (el) {
          if (e.data.updates.textContent !== undefined) {
            el.textContent = e.data.updates.textContent;
          }
          if (e.data.updates.className !== undefined) {
            el.className = e.data.updates.className;
          }
          if (e.data.updates.style !== undefined) {
            el.style.cssText = e.data.updates.style;
          }
          if (e.data.updates.id !== undefined) {
            el.id = e.data.updates.id;
          }
          if (e.data.updates.attributes && typeof e.data.updates.attributes === 'object') {
            Object.entries(e.data.updates.attributes).forEach(([name, value]) => {
              if (!name || name.startsWith('data-elements')) return;
              if (value === undefined || value === null || value === '') {
                el.removeAttribute(name);
              } else {
                el.setAttribute(name, String(value));
              }
            });
          }
          initializeElements();
          selectedPath = el.getAttribute('data-elements-path');
          const info = getElementInfo(el);
          window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
          refreshOverlays();
        }
      } else if (e.data.type === 'getHtml') {
        emitHtmlUpdate();
      } else if (e.data.type === 'updateStyles') {
        let styleEl = document.getElementById('user-css');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'user-css';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = e.data.css || '';
      } else if (e.data.type === 'updateScript') {
        console.log('[Preview] Script updated - refresh for full effect');
      } else if (e.data.type === 'deleteElement') {
        const el = findElementByPath(e.data.path);
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
          selectedPath = null;
          document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
          emitHtmlUpdate();
        }
      } else if (e.data.type === 'insertHtmlAtPoint') {
        const point = e.data.point || {};
        if (typeof point.x !== 'number' || typeof point.y !== 'number') return;
        const root = getDesignerRoot();
        if (!root) return;
        const temp = document.createElement('div');
        temp.innerHTML = e.data.html || '';
        const nodes = Array.from(temp.childNodes);
        const rawTarget = document.elementFromPoint(point.x, point.y);
        const target = rawTarget ? rawTarget.closest('[data-elements-path]') : null;
        const containerTags = ['DIV', 'SECTION', 'MAIN', 'FORM', 'UL', 'OL', 'NAV', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER'];
        if (!target || target === document.body || target === document.documentElement) {
          nodes.forEach(node => root.appendChild(node));
        } else if (containerTags.includes(target.tagName)) {
          nodes.forEach(node => target.appendChild(node));
        } else {
          const rect = target.getBoundingClientRect();
          const insertBefore = point.y < rect.top + rect.height / 2;
          const parent = target.parentNode || root;
          nodes.forEach(node => {
            parent.insertBefore(node, insertBefore ? target : target.nextSibling);
          });
        }
        initializeElements();
        emitHtmlUpdate();
      } else if (e.data.type === 'appendHtml') {
        const root = getDesignerRoot();
        if (!root) return;
        const temp = document.createElement('div');
        temp.innerHTML = e.data.html || '';
        while (temp.firstChild) {
          root.appendChild(temp.firstChild);
        }
        initializeElements();
        emitHtmlUpdate();
      }
    });
    ` : ''}

    window.addEventListener('load', initializeElements);
    setTimeout(initializeElements, 100);
  </script>
  <script>
    // === User JS (separate script so parse errors don't block setup) ===
    // Pre-declare App so function assignment inside try{} escapes block scope
    var App;
    try {
      ${(js || '').replace(/^(\s*)function\s+App\s*\(/m, '$1App = function App(')}
    } catch(__jsErr) {
      console.error('[Preview] Script error:', __jsErr);
    }

    // If user JS defined a React App component, render it into .stuard-root
    if (typeof React !== 'undefined' && typeof ReactDOM !== 'undefined' && typeof App === 'function') {
      try {
        var __root = document.querySelector('.stuard-root');
        if (__root) {
          __root.innerHTML = ''; // Clear static HTML before React mount
          ReactDOM.render(React.createElement(App), __root);
          setTimeout(function() {
            if (typeof initializeElements === 'function') initializeElements();
          }, 50);
        }
      } catch(__renderErr) {
        console.error('[Preview] React render error:', __renderErr);
        var __errRoot = document.querySelector('.stuard-root');
        if (__errRoot) __errRoot.innerHTML = '<div style="padding:16px;color:#f87171;font-family:system-ui"><h3>Render Error</h3><pre style="font-size:12px;background:rgba(127,29,29,0.3);padding:12px;border-radius:8px;white-space:pre-wrap;max-height:200px;overflow:auto">' + String(__renderErr.message||__renderErr).replace(/</g,'&lt;') + '</pre></div>';
      }
    }
  </script>
</body>
</html>`;
  }, [html, css, js, backgroundColor, showGrid, gridSize, previewMode, prebuiltAssets]);

  const refreshIframe = useCallback(() => {
    if (iframeRef.current) {
      setIframeReady(false);
      iframeRef.current.srcdoc = generateIframeContent();
    }
  }, [generateIframeContent]);

  useImperativeHandle(ref, () => ({
    refresh: refreshIframe,
    updateElement: (path: string, updates: { textContent?: string; className?: string; style?: string; id?: string; attributes?: Record<string, string | undefined> }) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'updateElement', path, updates }, '*');
      }
    },
    deleteElement: (path: string) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'deleteElement', path }, '*');
      }
    },
    requestHtml: () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'getHtml' }, '*');
      }
    },
    appendHtml: (html: string) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'appendHtml', html }, '*');
      }
    },
    insertHtmlAtPoint: (html: string, point: { clientX: number; clientY: number }) => {
      if (iframeRef.current?.contentWindow) {
        const rect = iframeRef.current.getBoundingClientRect();
        const effectiveScale = Math.max(zoom * surfaceScale, 0.0001);
        const x = (point.clientX - rect.left) / effectiveScale;
        const y = (point.clientY - rect.top) / effectiveScale;
        iframeRef.current.contentWindow.postMessage({ type: 'insertHtmlAtPoint', html, point: { x, y } }, '*');
      }
    },
    selectPath: (path: string | null) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'setSelected', path, emit: true }, '*');
    },
    selectParent: () => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'selectParent' }, '*');
    },
    duplicateSelected: () => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'duplicateSelected' }, '*');
    },
    moveSelected: (direction: 'up' | 'down') => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'moveSelected', direction }, '*');
    },
    focus: () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.focus();
      }
    },
  }));

  useEffect(() => {
    refreshIframe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInternalHtmlChange.current) {
      isInternalHtmlChange.current = false;
      lastHtmlRef.current = html;
      return;
    }
    if (html !== lastHtmlRef.current) {
      lastHtmlRef.current = html;
      refreshIframe();
    }
  }, [html, refreshIframe]);

  const lastSettingsRef = useRef({ backgroundColor, showGrid, gridSize, previewMode });

  useEffect(() => {
    const settings = { backgroundColor, showGrid, gridSize, previewMode };
    const prev = lastSettingsRef.current;
    if (prev.backgroundColor !== backgroundColor ||
        prev.showGrid !== showGrid ||
        prev.gridSize !== gridSize ||
        prev.previewMode !== previewMode) {
      lastSettingsRef.current = settings;
      refreshIframe();
    }
  }, [backgroundColor, showGrid, gridSize, previewMode, refreshIframe]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow && iframeReady) {
      iframeRef.current.contentWindow.postMessage({ type: 'updateStyles', css }, '*');
    }
  }, [css, iframeReady]);

  const lastJsRef = useRef(js);
  useEffect(() => {
    // JS changes require a full iframe refresh (scripts can't be hot-swapped)
    if (js !== lastJsRef.current) {
      lastJsRef.current = js;
      refreshIframe();
    }
  }, [js, refreshIframe]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        setIframeReady(true);
        if (selectedPath && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'setSelected', path: selectedPath }, '*');
        }
      } else if (e.data.type === 'select') {
        onSelectElement(e.data.element);
      } else if (e.data.type === 'hover') {
        setHoveredPath(e.data.path);
        onHoverElement(e.data.path);
      } else if (e.data.type === 'elementUpdated') {
        onSelectElement(e.data.element);
      } else if (e.data.type === 'positionChanged') {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'getHtml' }, '*');
        }
      } else if (e.data.type === 'html') {
        isInternalHtmlChange.current = true;
        onHtmlChange?.(e.data.html);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedPath, onSelectElement, onHoverElement, onHtmlChange]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow && iframeReady) {
      iframeRef.current.contentWindow.postMessage({ type: 'setSelected', path: selectedPath }, '*');
    }
  }, [selectedPath, iframeReady]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const cw = Math.max(entry.contentRect.width - 24, 1);
      const ch = Math.max(entry.contentRect.height - 24, 1);
      const nextScale = Math.min(cw / PREVIEW_SURFACE_WIDTH, ch / PREVIEW_SURFACE_HEIGHT, 1);
      setSurfaceScale(nextScale);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ctrl/⌘ + wheel to zoom (parent owns the zoom value)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onZoomChange) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const next = zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
    onZoomChange(Math.max(0.25, Math.min(3, Math.round(next * 100) / 100)));
  }, [zoom, onZoomChange]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex-1 min-w-0 min-h-0 overflow-auto relative uib-surface-2 flex"
      onWheel={handleWheel}
    >
      {/* margin:auto centers when content fits and degrades gracefully (no clipping) when it overflows → pannable */}
      <div
        className="m-auto p-3"
        style={{
          width: PREVIEW_SURFACE_WIDTH * stageScale + 24,
          height: PREVIEW_SURFACE_HEIGHT * stageScale + 24,
        }}
      >
        <div
          className="relative uib-surface rounded-xl border uib-border shadow-inner overflow-hidden"
          style={{
            width: PREVIEW_SURFACE_WIDTH,
            height: PREVIEW_SURFACE_HEIGHT,
            transform: `scale(${stageScale})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(rgba(148, 163, 184, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          <div className="absolute top-3 right-3 px-2 py-1 rounded-md uib-surface text-[10px] font-mono uib-fg-muted border uib-border z-10">
            screen {PREVIEW_SURFACE_WIDTH}×{PREVIEW_SURFACE_HEIGHT}
          </div>

          {/* The rendered custom UI window */}
          <div
            className="absolute rounded-lg shadow-2xl overflow-hidden border uib-border"
            style={{
              left: windowOffset.x,
              top: windowOffset.y,
              width: scaledCanvasWidth,
              height: scaledCanvasHeight,
              background: backgroundColor || '#fff',
              borderRadius: borderRadiusProp > 0 ? borderRadiusProp : undefined,
            }}
          >
            <iframe
              ref={iframeRef}
              className="border-0 block"
              style={{
                width: safeCanvasWidth,
                height: safeCanvasHeight,
              }}
              sandbox="allow-scripts allow-same-origin"
              title="UI Preview"
            />

            {!iframeReady && (
              <div className="absolute inset-0 uib-surface flex items-center justify-center">
                <div className="uib-fg-faint text-sm">Loading preview...</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Size Indicator */}
      <div className="absolute bottom-4 left-4 px-3 py-1.5 uib-surface rounded-lg text-xs uib-fg-muted border uib-border shadow-sm z-20">
        <div>{safeCanvasWidth} × {safeCanvasHeight} @ {Math.round(zoom * 100)}%</div>
        <div className="text-[10px] uib-fg-muted">
          position: {windowPosition}{windowPosition === 'custom' ? ` (${customX ?? 50}%, ${customY ?? 50}%)` : ''}
        </div>
      </div>

      {/* Preview Mode Indicator */}
      {previewMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500/150 text-white text-xs font-semibold rounded-full shadow-lg z-50 pointer-events-none">
          Preview Mode — Interactions Enabled
        </div>
      )}

      {/* Empty state */}
      {!html && !js && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center uib-fg-faint uib-surface px-6 py-4 rounded-xl">
            <div className="text-lg font-medium mb-1">Empty Canvas</div>
            <div className="text-sm">Click components on the left to add them</div>
          </div>
        </div>
      )}
    </div>
  );
});
