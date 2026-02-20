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
  focus: () => void;
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
}

interface UIBuilderCanvasProps {
  html: string;
  css: string;
  js: string;
  canvasWidth: number;
  canvasHeight: number;
  windowPosition?: 'center' | 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'bottomcenter' | 'mouse' | 'cursor' | 'custom';
  customX?: number;
  customY?: number;
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
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [surfaceScale, setSurfaceScale] = useState(1);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  // Prebuilt assets (React UMD + Tailwind CSS) loaded from main process — no CDN
  const [prebuiltAssets, setPrebuiltAssets] = useState<{
    reactUmd?: string; reactDomUmd?: string; tailwindCss?: string; extraCss?: string;
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
          tailwindCss: res.tailwindCss,
          extraCss: res.extraCss,
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

  const scaledCanvasWidth = safeCanvasWidth * zoom;
  const scaledCanvasHeight = safeCanvasHeight * zoom;

  const windowOffset = useMemo(() => {
    const centeredX = (PREVIEW_SURFACE_WIDTH - scaledCanvasWidth) / 2;
    const centeredY = (PREVIEW_SURFACE_HEIGHT - scaledCanvasHeight) / 2;
    const pos = String(windowPosition || 'center').toLowerCase().replace(/[_-]/g, '');

    switch (pos) {
      case 'topleft':
        return { x: PREVIEW_WINDOW_MARGIN, y: PREVIEW_WINDOW_MARGIN };
      case 'top':
      case 'topcenter':
        return { x: centeredX, y: PREVIEW_WINDOW_MARGIN };
      case 'topright':
        return { x: PREVIEW_SURFACE_WIDTH - PREVIEW_WINDOW_MARGIN - scaledCanvasWidth, y: PREVIEW_WINDOW_MARGIN };
      case 'left':
      case 'centerleft':
        return { x: PREVIEW_WINDOW_MARGIN, y: centeredY };
      case 'right':
      case 'centerright':
        return { x: PREVIEW_SURFACE_WIDTH - PREVIEW_WINDOW_MARGIN - scaledCanvasWidth, y: centeredY };
      case 'bottomleft':
        return { x: PREVIEW_WINDOW_MARGIN, y: PREVIEW_SURFACE_HEIGHT - PREVIEW_WINDOW_MARGIN - scaledCanvasHeight };
      case 'bottom':
      case 'bottomcenter':
        return { x: centeredX, y: PREVIEW_SURFACE_HEIGHT - PREVIEW_WINDOW_MARGIN - scaledCanvasHeight };
      case 'bottomright':
        return {
          x: PREVIEW_SURFACE_WIDTH - PREVIEW_WINDOW_MARGIN - scaledCanvasWidth,
          y: PREVIEW_SURFACE_HEIGHT - PREVIEW_WINDOW_MARGIN - scaledCanvasHeight,
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
  }, [windowPosition, customX, customY, scaledCanvasWidth, scaledCanvasHeight]);

  const generateIframeContent = useCallback(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  ${prebuiltAssets.reactUmd ? `<script>${prebuiltAssets.reactUmd}</script>` : '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>'}
  ${prebuiltAssets.reactDomUmd ? `<script>${prebuiltAssets.reactDomUmd}</script>` : '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>'}
  ${prebuiltAssets.tailwindCss ? `<style>${prebuiltAssets.tailwindCss}</style>` : '<script src="https://cdn.tailwindcss.com"></script>'}
  ${prebuiltAssets.extraCss ? `<style>${prebuiltAssets.extraCss}</style>` : ''}
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
    [data-elements-path]:hover {
      outline: 2px dashed rgba(99, 102, 241, 0.6) !important;
      outline-offset: 1px;
    }
    [data-elements-path].ui-selected {
      outline: 2px solid #6366f1 !important;
      outline-offset: 1px;
      cursor: move !important;
    }
    [data-elements-path].ui-hovered {
      outline: 2px dashed rgba(99, 102, 241, 0.6) !important;
      outline-offset: 1px;
    }
    [data-elements-path].ui-dragging {
      opacity: 0.8;
      z-index: 9999 !important;
      position: relative;
    }
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
      getScreenInfo: async () => ({ width: 1920, height: 1080, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    };
    window.$stuard = {
      tool: window.stuard.callTool,
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
        el.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging');
      });
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

    document.body.addEventListener('mousedown', (e) => {
      window.focus();
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
        return;
      }
      const target = e.target.closest('[data-elements-path]');
      const path = target ? target.getAttribute('data-elements-path') : null;
      if (path !== hoveredPath) {
        hoveredPath = path;
        window.parent.postMessage({ type: 'hover', path }, '*');
      }
    });

    document.body.addEventListener('mouseup', (e) => {
      if (isDragging && draggedElement) {
        draggedElement.classList.remove('ui-dragging');
        const info = getElementInfo(draggedElement);
        window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
        window.parent.postMessage({ type: 'positionChanged' }, '*');
        isDragging = false;
        draggedElement = null;
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPath) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
          return;
        }
        const el = findElementByPath(selectedPath);
        if (el && el !== document.body) {
          e.preventDefault();
          el.remove();
          selectedPath = null;
          document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
          window.parent.postMessage({ type: 'select', element: null }, '*');
          emitHtmlUpdate();
        }
      }
    });

    document.body.addEventListener('click', (e) => {
      window.focus();
      if (isDragging) {
        isDragging = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest('[data-elements-path]');
      if (target) {
        document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
        target.classList.add('ui-selected');
        selectedPath = target.getAttribute('data-elements-path');
        const info = getElementInfo(target);
        window.parent.postMessage({ type: 'select', element: info }, '*');
      } else {
        document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
        selectedPath = null;
        window.parent.postMessage({ type: 'select', element: null }, '*');
      }
    }, true);

    window.addEventListener('message', (e) => {
      if (e.data.type === 'setSelected') {
        document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
        if (e.data.path) {
          const el = findElementByPath(e.data.path);
          if (el) {
            el.classList.add('ui-selected');
            selectedPath = e.data.path;
          }
        }
      } else if (e.data.type === 'deleteSelected') {
        if (selectedPath) {
          const el = findElementByPath(selectedPath);
          if (el && el !== document.body) {
            el.remove();
            selectedPath = null;
            document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));
            window.parent.postMessage({ type: 'select', element: null }, '*');
            emitHtmlUpdate();
          }
        }
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
          const info = getElementInfo(el);
          window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
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

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex-1 min-w-0 min-h-0 overflow-hidden relative bg-slate-100"
    >
      <div className="w-full h-full flex items-center justify-center p-3">
        <div
          className="relative flex-shrink-0"
          style={{
            width: PREVIEW_SURFACE_WIDTH * surfaceScale,
            height: PREVIEW_SURFACE_HEIGHT * surfaceScale,
          }}
        >
          <div
            className="relative bg-white rounded-xl border border-slate-300 shadow-inner overflow-hidden"
            style={{
              width: PREVIEW_SURFACE_WIDTH,
              height: PREVIEW_SURFACE_HEIGHT,
              transform: `scale(${surfaceScale})`,
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

            <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-white/90 text-[10px] font-mono text-slate-500 border border-slate-200 z-10">
              preview surface {PREVIEW_SURFACE_WIDTH}×{PREVIEW_SURFACE_HEIGHT}
            </div>

            {/* The rendered custom UI window */}
            <div
              className="absolute rounded-lg shadow-2xl overflow-hidden border border-slate-300"
              style={{
                left: windowOffset.x,
                top: windowOffset.y,
                width: scaledCanvasWidth,
                height: scaledCanvasHeight,
                background: backgroundColor || '#fff',
                borderRadius: borderRadiusProp > 0 ? borderRadiusProp * zoom : undefined,
              }}
            >
              <iframe
                ref={iframeRef}
                className="border-0 block"
                style={{
                  width: safeCanvasWidth,
                  height: safeCanvasHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
                sandbox="allow-scripts allow-same-origin"
                title="UI Preview"
              />

              {!iframeReady && (
                <div className="absolute inset-0 bg-white flex items-center justify-center">
                  <div className="text-slate-400 text-sm">Loading preview...</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Canvas Size Indicator */}
      <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-white rounded-lg text-xs text-slate-600 border border-slate-200 shadow-sm z-20">
        <div>{safeCanvasWidth} × {safeCanvasHeight} @ {Math.round(zoom * 100)}%</div>
        <div className="text-[10px] text-slate-500">
          position: {windowPosition}{windowPosition === 'custom' ? ` (${customX ?? 50}%, ${customY ?? 50}%)` : ''}
        </div>
      </div>

      {/* Preview Mode Indicator */}
      {previewMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-full shadow-lg z-50 pointer-events-none">
          Preview Mode — Interactions Enabled
        </div>
      )}

      {/* Empty state */}
      {!html && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center text-slate-400 bg-white/80 px-6 py-4 rounded-xl">
            <div className="text-lg font-medium mb-1">Empty Canvas</div>
            <div className="text-sm">Click components on the left to add them</div>
          </div>
        </div>
      )}
    </div>
  );
});