import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { transform } from 'sucrase';

// ---------- Design Scheme ----------

interface DesignScheme {
  mode: 'dark' | 'light';
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    primary: string;
    primaryForeground: string;
    muted: string;
    mutedForeground: string;
    border: string;
    input: string;
  };
}

function getDesignScheme(): DesignScheme {
  const root = document.documentElement;
  const theme = root.getAttribute('data-stuard-theme') || 'dark';
  const isDark = theme !== 'light';

  if (isDark) {
    return {
      mode: 'dark',
      colors: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        card: '#1e293b',
        cardForeground: '#e2e8f0',
        primary: '#6366f1',
        primaryForeground: '#ffffff',
        muted: '#334155',
        mutedForeground: '#94a3b8',
        border: '#334155',
        input: '#1e293b',
      },
    };
  }

  return {
    mode: 'light',
    colors: {
      background: '#ffffff',
      foreground: '#0f172a',
      card: '#f8fafc',
      cardForeground: '#0f172a',
      primary: '#4f46e5',
      primaryForeground: '#ffffff',
      muted: '#f1f5f9',
      mutedForeground: '#64748b',
      border: '#e2e8f0',
      input: '#ffffff',
    },
  };
}

// ---------- JSX Transform ----------

function transformJsx(code: string): string {
  // Detect if code contains JSX
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{)|\$\{[^}]*\})*`/g, '``');

  const hasJsx = [
    /return\s*\(\s*<[A-Za-z]/,
    /return\s+<[A-Za-z]/,
    /=>\s*\(\s*<[A-Za-z]/,
    /=>\s*<[A-Za-z]/,
    /<[A-Z][A-Za-z]*[\s/>]/,
    /<[a-z]+\s+[a-zA-Z]+=\{/,
    /<\/[A-Za-z]+>/,
  ].some((r) => r.test(stripped));

  if (!hasJsx) return code;

  const result = transform(code, {
    transforms: ['jsx', 'typescript'],
    jsxRuntime: 'classic',
    jsxPragma: 'React.createElement',
    jsxFragmentPragma: 'React.Fragment',
    production: true,
  });
  return result.code;
}

// ---------- HTML Generation ----------

function generateSrcdoc(
  component: string,
  data: Record<string, any>,
  css: string,
  scheme: DesignScheme,
): string {
  let transformedCode: string;
  try {
    transformedCode = transformJsx(component);
  } catch (e: any) {
    transformedCode = `function App() {
      return React.createElement('div', {
        className: 'p-4 text-red-400 font-mono text-xs whitespace-pre-wrap'
      }, 'JSX Error: ' + ${JSON.stringify(String(e?.message || e))});
    }`;
  }

  const darkClass = scheme.mode === 'dark' ? 'dark' : '';
  const sc = scheme.colors;

  return `<!DOCTYPE html>
<html class="${darkClass}">
<head>
<meta charset="utf-8">
<script src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>
tailwind.config = { darkMode: 'class' };
<\/script>
<style>
:root {
  --background: ${sc.background};
  --foreground: ${sc.foreground};
  --card: ${sc.card};
  --card-foreground: ${sc.cardForeground};
  --primary: ${sc.primary};
  --primary-foreground: ${sc.primaryForeground};
  --muted: ${sc.muted};
  --muted-foreground: ${sc.mutedForeground};
  --border: ${sc.border};
  --input: ${sc.input};
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: auto; overflow: hidden; }
body {
  background: ${sc.background};
  color: ${sc.foreground};
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
#root { min-height: 0; }
button { cursor: pointer; user-select: none; transition: all 0.15s ease; }
button:active { transform: scale(0.98); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input, textarea, select {
  background: ${sc.input}; border: 1px solid ${sc.border}; color: ${sc.foreground};
  border-radius: 6px; padding: 6px 10px; width: 100%; outline: none;
  font-size: 14px; transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus { border-color: ${sc.primary}; box-shadow: 0 0 0 2px ${sc.primary}33; }
input::placeholder, textarea::placeholder { color: ${sc.mutedForeground}; }
${css}
</style>
</head>
<body class="${darkClass}">
<div id="root"></div>
<script>
(function() {
  'use strict';
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;
  var useReducer = React.useReducer;
  var useContext = React.useContext;

  var initialData = ${JSON.stringify(data)};
  var designScheme = ${JSON.stringify(scheme)};

  var stuard = {
    submit: function(data) { window.parent.postMessage({ type: 'stuard:submit', data: data || {} }, '*'); },
    close: function() { window.parent.postMessage({ type: 'stuard:close' }, '*'); },
  };

  // Observe content height changes and notify parent for auto-resize
  var _lastH = 0;
  function _notifyHeight() {
    var h = document.body.scrollHeight;
    if (h !== _lastH) {
      _lastH = h;
      window.parent.postMessage({ type: 'stuard:resize', height: h }, '*');
    }
  }

  try {
    ${transformedCode}

    if (typeof App === 'function') {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    }
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<div style="padding:12px;color:#f87171;font-family:monospace;font-size:12px;white-space:pre-wrap">' +
      'Render Error: ' + String(e) + '</div>';
  }

  // Start height observer after render
  setTimeout(_notifyHeight, 50);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(_notifyHeight).observe(document.body);
  } else {
    setInterval(_notifyHeight, 200);
  }
})();
<\/script>
</body>
</html>`;
}

// ---------- Component ----------

export interface ChatUIRendererProps {
  component: string;
  data?: Record<string, any>;
  css?: string;
  height?: number;
  title?: string;
  onResult: (result: any) => void;
  isCompleted?: boolean;
  result?: any;
}

const MAX_HEIGHT = 500;
const DEFAULT_MIN_HEIGHT = 60;

export const ChatUIRenderer: React.FC<ChatUIRendererProps> = ({
  component,
  data,
  css,
  height: fixedHeight,
  title,
  onResult,
  isCompleted,
  result,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [hasResponded, setHasResponded] = useState(false);
  const [autoHeight, setAutoHeight] = useState(fixedHeight || DEFAULT_MIN_HEIGHT);
  const scheme = useMemo(getDesignScheme, []);

  const srcdoc = useMemo(
    () => generateSrcdoc(component, data || {}, css || '', scheme),
    [component, data, css, scheme],
  );

  // Listen for postMessage from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'stuard:submit':
          if (!hasResponded && !isCompleted) {
            setHasResponded(true);
            onResult({ submitted: true, ...(msg.data || {}) });
          }
          break;
        case 'stuard:close':
          if (!hasResponded && !isCompleted) {
            setHasResponded(true);
            onResult({ closed: true });
          }
          break;
        case 'stuard:resize':
          if (!fixedHeight && typeof msg.height === 'number') {
            setAutoHeight(Math.min(Math.max(msg.height, DEFAULT_MIN_HEIGHT), MAX_HEIGHT));
          }
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onResult, hasResponded, isCompleted, fixedHeight]);

  const isDone = isCompleted || hasResponded;
  const frameHeight = fixedHeight ? Math.min(fixedHeight, MAX_HEIGHT) : autoHeight;

  const borderColor = scheme.mode === 'dark'
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.08)';

  const headerBg = scheme.mode === 'dark'
    ? 'rgba(30,41,59,0.6)'
    : 'rgba(241,245,249,0.8)';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: '8px 0',
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${borderColor}`,
        opacity: isDone ? 0.85 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {title && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            background: headerBg,
            borderBottom: `1px solid ${borderColor}`,
            color: scheme.colors.mutedForeground,
          }}
        >
          {title}
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        style={{
          width: '100%',
          height: frameHeight,
          border: 'none',
          display: 'block',
          transition: 'height 0.15s ease',
        }}
      />
      {isDone && result && (
        <div
          style={{
            padding: '4px 12px',
            fontSize: 11,
            color: scheme.colors.mutedForeground,
            background: headerBg,
            borderTop: `1px solid ${borderColor}`,
          }}
        >
          {result.submitted ? 'Submitted' : result.closed ? 'Dismissed' : 'Displayed'}
        </div>
      )}
    </div>
  );
};
