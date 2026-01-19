/**
 * UIBuilderCanvas - Real-time HTML/CSS renderer using iframe
 * Renders actual custom_ui output and allows selecting/editing any element
 */

import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface UIBuilderCanvasRef {
  refresh: () => void;
  updateElement: (path: string, updates: { textContent?: string; className?: string; style?: string }) => void;
  requestHtml: () => void;
  appendHtml: (html: string) => void;
  insertHtmlAtPoint: (html: string, point: { clientX: number; clientY: number }) => void;
}

export interface SelectedElementInfo {
  path: string;           // Unique path to element (for re-selection)
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
  backgroundColor: string;
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
  backgroundColor,
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
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  // Track if HTML change is from iframe sync (don't refresh) vs external (need refresh)
  const isInternalHtmlChange = useRef(false);
  const lastHtmlRef = useRef(html);

  // Generate the iframe content with selection support
  const generateIframeContent = useCallback(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: auto;
      margin: 0;
      padding: 0;
      background: ${backgroundColor || '#ffffff'};
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Button variants */
    .btn { display: inline-flex; align-items: center; justify-content: center; font-weight: 500; transition: all 0.15s; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }

    /* User CSS */
    ${css || ''}

    /* Design mode element highlighting */
    ${!previewMode ? `
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
  ${html || ''}
  <script>
    // Mock stuard API for preview
    window.stuard = {
      close: () => console.log('[Preview] stuard.close()'),
      pickFolder: async () => ({ canceled: true, filePaths: [] }),
      callTool: async (name, args) => {
        console.log('[Preview] stuard.callTool:', name, args);
        return { ok: false, error: 'Preview mode - tools disabled' };
      },
      send: (data) => console.log('[Preview] stuard.send:', data),
    };

    // Generate unique path for an element
    function getElementPath(el) {
      if (!el || el === document.body || el === document.documentElement) return null;

      const parts = [];
      let current = el;

      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
          selector += '#' + current.id;
          parts.unshift(selector);
          break; // ID is unique, no need to go further
        } else {
          // Add nth-child for uniqueness
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(current) + 1;
            selector += ':nth-child(' + index + ')';
          }
          parts.unshift(selector);
        }

        current = current.parentElement;
      }

      return parts.join(' > ');
    }

    // Get element info for parent
    function getElementInfo(el) {
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);

      // Get relevant computed styles
      const styles = {};
      const relevantProps = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'padding', 'margin', 'borderRadius', 'display', 'flexDirection', 'gap', 'alignItems', 'justifyContent'];
      relevantProps.forEach(prop => {
        styles[prop] = computed[prop];
      });

      // Get attributes
      const attributes = {};
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('data-elements')) {
          attributes[attr.name] = attr.value;
        }
      }

      // Handle className which could be SVGAnimatedString for SVG elements
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

    // Add data-elements-path to all elements for selection
    function initializeElements() {
      const elements = document.body.querySelectorAll('*');
      elements.forEach(el => {
        const path = getElementPath(el);
        if (path) {
          el.setAttribute('data-elements-path', path);
        }
      });
      window.parent.postMessage({ type: 'ready' }, '*');
    }

    // Find element by path
    function findElementByPath(path) {
      if (!path) return null;
      try {
        return document.querySelector('[data-elements-path="' + path.replace(/"/g, '\\\\"') + '"]');
      } catch(e) {
        return null;
      }
    }

    // Design mode event handlers
    ${!previewMode ? `
    let selectedPath = null;
    let hoveredPath = null;
    let isDragging = false;
    let draggedElement = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let elementStartX = 0;
    let elementStartY = 0;

    // Handle mousedown for drag start
    document.body.addEventListener('mousedown', (e) => {
      const target = e.target.closest('[data-elements-path]');
      if (target && target.classList.contains('ui-selected')) {
        // Start dragging the selected element
        isDragging = true;
        draggedElement = target;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        // Get current transform or position
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

    // Handle mousemove for dragging
    document.body.addEventListener('mousemove', (e) => {
      if (isDragging && draggedElement) {
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        const newX = elementStartX + deltaX;
        const newY = elementStartY + deltaY;

        // Snap to grid (8px)
        const gridSize = ${gridSize};
        const snappedX = Math.round(newX / gridSize) * gridSize;
        const snappedY = Math.round(newY / gridSize) * gridSize;

        draggedElement.style.transform = 'translate(' + snappedX + 'px, ' + snappedY + 'px)';
        return;
      }

      // Hover handling
      const target = e.target.closest('[data-elements-path]');
      const path = target ? target.getAttribute('data-elements-path') : null;

      if (path !== hoveredPath) {
        hoveredPath = path;
        window.parent.postMessage({ type: 'hover', path }, '*');
      }
    });

    // Handle mouseup for drag end
    document.body.addEventListener('mouseup', (e) => {
      if (isDragging && draggedElement) {
        draggedElement.classList.remove('ui-dragging');

        // Notify parent about the change
        const info = getElementInfo(draggedElement);
        window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
        window.parent.postMessage({ type: 'positionChanged' }, '*');

        isDragging = false;
        draggedElement = null;
      }
    });

    // Handle click for selection
    document.body.addEventListener('click', (e) => {
      // Don't process click if we just finished dragging
      if (isDragging) {
        isDragging = false;
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const target = e.target.closest('[data-elements-path]');
      if (target) {
        // Clear previous selection
        document.querySelectorAll('.ui-selected').forEach(el => el.classList.remove('ui-selected'));

        // Set new selection
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

    // Listen for commands from parent
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
          // Re-init paths since DOM changed
          initializeElements();
          // Send back updated element info
          const info = getElementInfo(el);
          window.parent.postMessage({ type: 'elementUpdated', element: info }, '*');
        }
      } else if (e.data.type === 'getHtml') {
        // Return the current HTML (without our data-elements-path attributes)
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[data-elements-path]').forEach(el => {
          el.removeAttribute('data-elements-path');
          el.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging');
        });
        window.parent.postMessage({ type: 'html', html: clone.innerHTML }, '*');
      } else if (e.data.type === 'updateStyles') {
        // Update CSS without full reload
        let styleEl = document.getElementById('user-css');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'user-css';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = e.data.css || '';
      } else if (e.data.type === 'updateScript') {
        // Scripts cannot be hot-reloaded safely, just log for now
        console.log('[Preview] Script updated - refresh for full effect');
      } else if (e.data.type === 'insertHtmlAtPoint') {
        const point = e.data.point || {};
        if (typeof point.x !== 'number' || typeof point.y !== 'number') {
          return;
        }
        const temp = document.createElement('div');
        temp.innerHTML = e.data.html || '';
        const nodes = Array.from(temp.childNodes);
        const rawTarget = document.elementFromPoint(point.x, point.y);
        const target = rawTarget ? rawTarget.closest('[data-elements-path]') : null;
        const containerTags = ['DIV', 'SECTION', 'MAIN', 'FORM', 'UL', 'OL', 'NAV', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER'];

        if (!target || target === document.body || target === document.documentElement) {
          nodes.forEach(node => document.body.appendChild(node));
        } else if (containerTags.includes(target.tagName)) {
          nodes.forEach(node => target.appendChild(node));
        } else {
          const rect = target.getBoundingClientRect();
          const insertBefore = point.y < rect.top + rect.height / 2;
          const parent = target.parentNode || document.body;
          nodes.forEach(node => {
            parent.insertBefore(node, insertBefore ? target : target.nextSibling);
          });
        }
        initializeElements();
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[data-elements-path]').forEach(el => {
          el.removeAttribute('data-elements-path');
          el.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging');
        });
        window.parent.postMessage({ type: 'html', html: clone.innerHTML }, '*');
      } else if (e.data.type === 'appendHtml') {
        // Append HTML to body without full refresh
        const temp = document.createElement('div');
        temp.innerHTML = e.data.html || '';
        while (temp.firstChild) {
          document.body.appendChild(temp.firstChild);
        }
        // Re-init paths for new elements
        initializeElements();
        // Request HTML sync back to parent
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[data-elements-path]').forEach(el => {
          el.removeAttribute('data-elements-path');
          el.classList.remove('ui-selected', 'ui-hovered', 'ui-dragging');
        });
        window.parent.postMessage({ type: 'html', html: clone.innerHTML }, '*');
      }
    });
    ` : ''}

    // Initialize on load
    window.addEventListener('load', initializeElements);
    setTimeout(initializeElements, 100);

    // User JavaScript (run after setup)
    try {
      ${js || ''}
    } catch(e) {
      console.error('[Preview] Script error:', e);
    }
  </script>
</body>
</html>`;
  }, [html, css, js, backgroundColor, showGrid, gridSize, previewMode]);

  // Refresh iframe content
  const refreshIframe = useCallback(() => {
    if (iframeRef.current) {
      setIframeReady(false);
      iframeRef.current.srcdoc = generateIframeContent();
    }
  }, [generateIframeContent]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    refresh: refreshIframe,
    updateElement: (path: string, updates: { textContent?: string; className?: string; style?: string; id?: string }) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'updateElement', path, updates }, '*');
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
        const x = (point.clientX - rect.left) / zoom;
        const y = (point.clientY - rect.top) / zoom;
        iframeRef.current.contentWindow.postMessage({ type: 'insertHtmlAtPoint', html, point: { x, y } }, '*');
      }
    },
  }));

  // Initial mount - load the iframe content
  useEffect(() => {
    refreshIframe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update iframe when content changes (but not for internal HTML syncs)
  useEffect(() => {
    // Skip refresh if this HTML change came from iframe sync
    if (isInternalHtmlChange.current) {
      isInternalHtmlChange.current = false;
      lastHtmlRef.current = html;
      return;
    }

    // Only refresh if html actually changed from external source
    if (html !== lastHtmlRef.current) {
      lastHtmlRef.current = html;
      refreshIframe();
    }
  }, [html, refreshIframe]);

  // Only refresh for settings changes that require iframe reload, NOT for content updates
  // CSS/JS content updates are handled via postMessage to avoid full reload
  const lastSettingsRef = useRef({ backgroundColor, showGrid, gridSize, previewMode });

  useEffect(() => {
    const settings = { backgroundColor, showGrid, gridSize, previewMode };
    const prev = lastSettingsRef.current;

    // Only refresh if visual settings actually changed (not content)
    if (prev.backgroundColor !== backgroundColor ||
        prev.showGrid !== showGrid ||
        prev.gridSize !== gridSize ||
        prev.previewMode !== previewMode) {
      lastSettingsRef.current = settings;
      refreshIframe();
    }
  }, [backgroundColor, showGrid, gridSize, previewMode, refreshIframe]);

  // Send CSS/JS updates via postMessage to avoid full refresh
  useEffect(() => {
    if (iframeRef.current?.contentWindow && iframeReady) {
      iframeRef.current.contentWindow.postMessage({ type: 'updateStyles', css }, '*');
    }
  }, [css, iframeReady]);

  useEffect(() => {
    if (iframeRef.current?.contentWindow && iframeReady) {
      iframeRef.current.contentWindow.postMessage({ type: 'updateScript', js }, '*');
    }
  }, [js, iframeReady]);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        setIframeReady(true);
        // Re-apply selection if any
        if (selectedPath && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'setSelected', path: selectedPath }, '*');
        }
      } else if (e.data.type === 'select') {
        onSelectElement(e.data.element);
      } else if (e.data.type === 'hover') {
        setHoveredPath(e.data.path);
        onHoverElement(e.data.path);
      } else if (e.data.type === 'elementUpdated') {
        // Element was updated, notify parent
        onSelectElement(e.data.element);
      } else if (e.data.type === 'positionChanged') {
        // Position was changed via drag, request HTML to sync
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'getHtml' }, '*');
        }
      } else if (e.data.type === 'html') {
        // HTML was requested, send to parent
        // Mark as internal change so we don't refresh the iframe
        isInternalHtmlChange.current = true;
        onHtmlChange?.(e.data.html);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedPath, onSelectElement, onHoverElement, onHtmlChange]);

  // Update selection in iframe when selectedPath changes
  useEffect(() => {
    if (iframeRef.current?.contentWindow && iframeReady) {
      iframeRef.current.contentWindow.postMessage({ type: 'setSelected', path: selectedPath }, '*');
    }
  }, [selectedPath, iframeReady]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto relative bg-slate-100"
      style={{ minHeight: '100%' }}
    >
      {/* Canvas Container - centers the preview */}
      <div
        className="flex items-center justify-center p-8"
        style={{ minHeight: '100%' }}
      >
        {/* The rendered UI in iframe */}
        <div
          className="relative bg-white rounded-lg shadow-2xl overflow-hidden"
          style={{
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
          }}
        >
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
            sandbox="allow-scripts allow-same-origin"
            title="UI Preview"
          />

          {/* Loading overlay */}
          {!iframeReady && (
            <div className="absolute inset-0 bg-white flex items-center justify-center">
              <div className="text-slate-400 text-sm">Loading preview...</div>
            </div>
          )}
        </div>
      </div>

      {/* Canvas Size Indicator */}
      <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-white rounded-lg text-xs text-slate-600 border border-slate-200 shadow-sm">
        {canvasWidth} x {canvasHeight} @ {Math.round(zoom * 100)}%
      </div>

      {/* Preview Mode Indicator */}
      {previewMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-full shadow-lg z-50">
          Preview Mode - Interactions Enabled
        </div>
      )}

      {/* Empty state */}
      {!html && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-slate-400 bg-white/80 px-6 py-4 rounded-xl">
            <div className="text-lg font-medium mb-1">Empty Canvas</div>
            <div className="text-sm">Click components on the left to add them</div>
          </div>
        </div>
      )}
    </div>
  );
});
