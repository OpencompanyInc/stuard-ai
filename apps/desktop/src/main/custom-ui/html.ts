import type { CustomUiHtmlOptions } from './types';
import { getReactRuntime } from './assets/react-runtime';
import { EXTRA_CSS } from './assets/utility-css';
import { TAILWIND_PREBUILT_CSS } from './assets/tailwind-prebuilt';
import { prepareComponentCode } from './jsx-transform';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build background CSS from window config options.
 */
function buildBackgroundCss(
  backgroundType: string,
  backgroundColor: string,
  gradient: any,
  backgroundImage: any,
): { backgroundCss: string; backgroundOverlayCss: string } {
  let backgroundCss = '';
  let backgroundOverlayCss = '';

  switch (backgroundType) {
    case 'gradient':
      if (gradient && gradient.stops?.length > 0) {
        const sortedStops = [...gradient.stops].sort((a: any, b: any) => a.position - b.position);
        const stopString = sortedStops.map((s: any) => `${s.color} ${s.position}%`).join(', ');
        if (gradient.type === 'linear') {
          backgroundCss = `background: linear-gradient(${gradient.angle || 135}deg, ${stopString});`;
        } else if (gradient.type === 'radial') {
          backgroundCss = `background: radial-gradient(circle at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        } else if (gradient.type === 'conic') {
          backgroundCss = `background: conic-gradient(from 0deg at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        }
      }
      break;
    case 'image':
      if (backgroundImage?.url) {
        const fit = backgroundImage.fit || 'cover';
        const position = backgroundImage.position || 'center';
        const repeat = backgroundImage.repeat || 'no-repeat';
        backgroundCss = `background-image: url('${backgroundImage.url}'); background-size: ${fit}; background-position: ${position}; background-repeat: ${repeat};`;
        if (backgroundImage.opacity !== undefined && backgroundImage.opacity < 1) {
          backgroundOverlayCss = `opacity: ${backgroundImage.opacity};`;
        }
      }
      break;
    case 'color':
    default:
      backgroundCss = `background-color: ${backgroundColor};`;
      break;
  }

  return { backgroundCss, backgroundOverlayCss };
}

/**
 * Build open-animation CSS from config.
 */
function buildAnimationCss(animation: any): { animationCss: string; animationKeyframes: string } {
  let animationCss = '';
  let animationKeyframes = '';
  if (animation?.open && animation.open !== 'none') {
    const duration = animation.duration || 300;
    const easing = animation.easing || 'ease-out';
    const keyframeName = `open-${animation.open}`;
    animationCss = `animation: ${keyframeName} ${duration}ms ${easing};`;
    switch (animation.open) {
      case 'fade':
        animationKeyframes = `@keyframes ${keyframeName} { from { opacity: 0; } to { opacity: 1; } }`;
        break;
      case 'slide-up':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'slide-down':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'scale':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }`;
        break;
    }
  }
  return { animationCss, animationKeyframes };
}

/**
 * Build the base/theme CSS for a custom UI window.
 */
function buildThemeCss(options: {
  transparentBg: boolean;
  backgroundType: string;
  backgroundColor: string;
  borderRadius: number;
  contentPadding: number;
  shadowCss: string;
  borderCss: string;
  backgroundCss: string;
  backgroundOverlayCss: string;
  animationCss: string;
}): string {
  const {
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
  } = options;

  const radiusStyle = borderRadius > 0 ? `border-radius: ${borderRadius}px;` : '';
  const clipStyle = borderRadius > 0 ? 'overflow: hidden;' : '';
  const bgValue = transparentBg ? 'transparent' : (backgroundType === 'color' ? backgroundColor : 'transparent');

  return `
    html { background: ${bgValue}; -webkit-font-smoothing: antialiased; height: 100%; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${bgValue}; color: #1e293b; height: 100%;
      font-size: 14px; line-height: 1.5;
      ${borderRadius > 0 ? `${radiusStyle} ${clipStyle}` : ''}
      ${animationCss}
    }
    .overlay-container, .root, .stuard-root {
      background: ${bgValue}; ${radiusStyle} ${shadowCss} ${borderCss} ${clipStyle}
      height: 100%; ${contentPadding ? `padding: ${contentPadding}px;` : ''}
    }
    ${backgroundType !== 'color' && !transparentBg ? `
    .stuard-background { position: fixed; inset: 0; ${backgroundCss} ${backgroundOverlayCss} z-index: -1; }` : ''}
    ${transparentBg ? `
    html, body, .dark, .stuard-root, .root, .overlay-container, body > div, body > div > div {
      background: transparent !important; background-color: transparent !important;
    }` : ''}

    /* === Component Defaults === */
    button, .btn {
      cursor: pointer; user-select: none; display: inline-flex; align-items: center;
      justify-content: center; padding: 8px 16px; border: none; background: #f1f5f9;
      color: #475569; border-radius: 8px; font-weight: 500; font-size: 13px;
      transition: all 0.15s ease; gap: 8px;
    }
    button:hover { background: #e2e8f0; } button:active { transform: scale(0.98); }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-ghost { background: transparent; color: #475569; border: none; box-shadow: none; }
    .btn-ghost:hover { background: #f1f5f9; color: #1e293b; }
    .btn-outline { background: transparent; color: #4f46e5; border: 1px solid #4f46e5; }
    .btn-outline:hover { background: #eef2ff; }
    button:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    input[type="text"], input[type="email"], input[type="password"], input[type="number"],
    input[type="url"], input[type="tel"], textarea, select {
      background: white; border: 1px solid #e2e8f0; color: #1e293b;
      border-radius: 8px; padding: 8px 12px; width: 100%; outline: none;
      font-size: 14px; transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus, textarea:focus, select:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    input::placeholder, textarea::placeholder { color: #94a3b8; }

    .glass { background: rgba(255,255,255,0.7)!important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(0,0,0,0.08); }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #475569; }
    label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }

    /* Dark mode - add class="dark" to body or html */
    body.dark, .dark body { background: #0f172a; color: #e2e8f0; }
    body.dark .card, .dark .card { background: rgba(30,41,59,0.5); border-color: rgba(255,255,255,0.05); }
    body.dark input, body.dark textarea, body.dark select,
    .dark input, .dark textarea, .dark select {
      background: rgba(15,23,42,0.6); border-color: rgba(148,163,184,0.1); color: #f1f5f9;
    }
    body.dark h1, body.dark h2, body.dark h3, body.dark h4, body.dark h5, body.dark h6,
    .dark h1, .dark h2, .dark h3, .dark h4, .dark h5, .dark h6 { color: #f8fafc; }
    body.dark p, .dark p { color: #cbd5e1; }
    body.dark button, .dark button { background: #334155; color: white; }
    body.dark button:hover, .dark button:hover { background: #475569; }
    body.dark .btn-secondary, .dark .btn-secondary { background: #334155; color: white; }
    body.dark .btn-ghost, .dark .btn-ghost { color: #94a3b8; }
    body.dark .btn-ghost:hover, .dark .btn-ghost:hover { background: rgba(255,255,255,0.05); color: #f8fafc; }
    body.dark .glass, .dark .glass { background: rgba(15,23,42,0.7)!important; border-color: rgba(255,255,255,0.08); }
  `;
}

export function generateEnhancedCustomUiHtml(options: CustomUiHtmlOptions): string {
  const {
    id,
    title,
    css,
    data,
    rawHtml,
    borderRadius = 0,
    flowId,
    transparentBg,
    component,
    backgroundType = 'color',
    backgroundColor = 'transparent',
    gradient,
    backgroundImage,
    shadow,
    border,
    animation,
    contentPadding = 0,
  } = options;

  // Build sub-CSS pieces
  const { backgroundCss, backgroundOverlayCss } = buildBackgroundCss(backgroundType, backgroundColor, gradient, backgroundImage);
  const shadowCss = shadow?.enabled
    ? `box-shadow: ${shadow.x || 0}px ${shadow.y || 4}px ${shadow.blur || 12}px ${shadow.spread || 0}px ${shadow.color || '#00000040'};`
    : '';
  const borderCss = border?.enabled
    ? `border: ${border.width || 1}px ${border.style || 'solid'} ${border.color || '#ffffff20'};`
    : '';
  const { animationCss, animationKeyframes } = buildAnimationCss(animation);

  const themeCss = buildThemeCss({
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
  });

  // === Prepare component code ===
  let rawCode: string;
  if (component) {
    rawCode = component;
  } else if (rawHtml) {
    // Wrap raw HTML in a React component
    const escapedHtml = JSON.stringify(rawHtml);
    rawCode = `function App() {
      const [formData, setFormData] = React.useState({ ...initialData });
      return React.createElement('div', { dangerouslySetInnerHTML: { __html: ${escapedHtml} } });
    }`;
  } else {
    rawCode = `function App() {
      return React.createElement('div', {
        className: 'flex items-center justify-center h-full text-slate-400 text-sm'
      }, 'No component defined');
    }`;
  }

  const { code: processedComponent } = prepareComponentCode(rawCode);

  // Load bundled React runtime (offline)
  let reactRuntime: string;
  try {
    reactRuntime = getReactRuntime();
  } catch (err: any) {
    console.error('[custom-ui] Failed to load React runtime:', err);
    reactRuntime = '// React runtime failed to load: ' + String(err?.message || err);
  }

  const bgOverlay = backgroundType !== 'color' && !transparentBg ? '<div class="stuard-background"></div>' : '';

  // Build the runtime script for the custom UI window
  const runtimeScript = buildRuntimeScript({
    id, flowId, data, processedComponent,
  });

  return `<!DOCTYPE html>
<html${transparentBg ? ' style="background:transparent!important"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: file:; img-src * data: blob: local-file: file:; media-src * data: blob: local-file: file:; font-src * data:;">
  <title>${escapeHtml(title)}</title>
  <style>${TAILWIND_PREBUILT_CSS}</style>
  <style>${EXTRA_CSS}</style>
  <style>${themeCss}\n${css || ''}\n${animationKeyframes}</style>
  <script>${reactRuntime}<\/script>
</head>
<body${transparentBg ? ' style="background:transparent!important"' : ''}>
  ${bgOverlay}
  <div class="stuard-root" id="stuard-root"></div>
  <script>${runtimeScript}<\/script>
</body>
</html>`;
}

/**
 * Build the client-side runtime JavaScript that boots React,
 * defines hooks (useVar, useStream), and renders the user component.
 */
function buildRuntimeScript(options: {
  id: string;
  flowId: string;
  data: any;
  processedComponent: string;
}): string {
  const { id, flowId, data, processedComponent } = options;

  return `
    // === Stuard Custom UI Runtime (React + JSX) ===
    (function() {
      'use strict';

      var CUSTOM_UI_ID = ${JSON.stringify(id)};
      var FLOW_ID = ${JSON.stringify(flowId)};
      window.initialData = ${JSON.stringify(data)};
      var initialData = window.initialData;
      var formData = Object.assign({}, initialData, { flowId: FLOW_ID });
      var hasStuardApi = typeof window.stuard !== 'undefined';

      // === Legacy Fallback: provide basic stuard API when preload is unavailable ===
      if (!hasStuardApi) {
        window.stuard = {
          submit: function(data) {
            // Signal submit via title, then close window
            try { document.title = '__stuard_submit__' + JSON.stringify(data || formData); } catch(e) {}
            window.close();
          },
          close: function(data) {
            try { document.title = '__stuard_close__' + JSON.stringify(data || {}); } catch(e) {}
            window.close();
          },
          action: function(name, data) {
            try { document.title = '__stuard_action__' + JSON.stringify({ action: name, data: data }); } catch(e) {}
          },
          emit: function() {},
          on: function() { return function() {}; },
          getData: function() { return Promise.resolve(initialData); },
          getFlowId: function() { return Promise.resolve(FLOW_ID); },
          getWindowId: function() { return Promise.resolve(CUSTOM_UI_ID); },
          updateData: function(updates) {
            Object.assign(formData, updates);
            Object.assign(initialData, updates);
            return Promise.resolve();
          },
          getVar: function(name) {
            var val = initialData[name];
            return Promise.resolve({ ok: val !== undefined, name: name, value: val });
          },
          setVar: function(name, value) {
            initialData[name] = value;
            formData[name] = value;
            // Notify local listeners
            if (window.__varListeners && window.__varListeners[name]) {
              window.__varListeners[name].forEach(function(cb) { try { cb(value); } catch(e) {} });
            }
            return Promise.resolve({ ok: true, name: name, value: value, type: typeof value });
          },
          subscribeVars: function() { return Promise.resolve(); },
          onVarUpdate: function() { return function() {}; },
          subscribeStream: function() { return Promise.resolve({ ok: false }); },
          unsubscribeStream: function() { return Promise.resolve(); },
          navigate: function() {},
          getCurrentPage: function() { return Promise.resolve(null); },
          onPageChange: function() { return function() {}; },
          log: function(msg) { console.log('[stuard]', msg); },
          copyToClipboard: function(text) { try { navigator.clipboard.writeText(text); } catch(e) {} return Promise.resolve(); },
          notify: function() {},
          setAlwaysOnTop: function() {},
          resize: function() {},
          center: function() {},
        };
        hasStuardApi = true;
      }

      // === Verify React loaded ===
      if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        document.getElementById('stuard-root').innerHTML =
          '<div style="padding:24px;color:#f87171;font-family:system-ui">' +
          '<h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">React Runtime Error</h2>' +
          '<p style="color:#94a3b8;font-size:13px">React or ReactDOM failed to initialize. This is a bug.</p></div>';
        return;
      }

      // === React Hooks (global scope for component code) ===
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useMemo = React.useMemo;
      var useCallback = React.useCallback;
      var useReducer = React.useReducer;
      var useContext = React.useContext;
      var useLayoutEffect = React.useLayoutEffect;
      var Fragment = React.Fragment;
      var createElement = React.createElement;

      // === Variable Subscription ===
      window.__varListeners = {};
      if (hasStuardApi) {
        window.stuard.subscribeVars(['*']);
        window.stuard.onVarUpdate(function(info) {
          var matchNames = [info.name, info.shortName];
          for (var i = 0; i < matchNames.length; i++) {
            var mn = matchNames[i];
            if (window.__varListeners[mn]) {
              window.__varListeners[mn].forEach(function(cb) {
                try { cb(info.value); } catch(e) { console.error('[useVar] listener error:', e); }
              });
            }
          }
        });
      }

      // === useVar Hook ===
      // Seeds from initialData if the variable name matches a data key
      function useVar(varName, defaultValue) {
        var ref = React.useRef({ initialized: false });
        var initVal = (initialData && initialData[varName] !== undefined) ? initialData[varName] : defaultValue;
        var state = React.useState(initVal);
        var value = state[0], _setValue = state[1];

        React.useEffect(function() {
          if (!hasStuardApi) return;

          window.stuard.getVar(varName).then(function(res) {
            if (res.ok && res.value !== undefined && res.value !== null) {
              _setValue(res.value);
            } else if (initVal !== undefined && !ref.current.initialized) {
              // Seed variable store from initialData (or default)
              window.stuard.setVar(varName, initVal);
            }
            ref.current.initialized = true;
          });

          var handler = function(newVal) { _setValue(newVal); };
          if (!window.__varListeners[varName]) window.__varListeners[varName] = [];
          window.__varListeners[varName].push(handler);

          return function() {
            var arr = window.__varListeners[varName];
            if (arr) {
              var idx = arr.indexOf(handler);
              if (idx >= 0) arr.splice(idx, 1);
            }
          };
        }, []);

        var setVar = React.useCallback(function(newVal) {
          _setValue(newVal);
          if (hasStuardApi) window.stuard.setVar(varName, newVal);
        }, [varName]);

        return [value, setVar];
      }

      // === useStream Hook ===
      function useStream(streamId) {
        var chunkState = React.useState(null);
        var chunk = chunkState[0], setChunk = chunkState[1];
        var indexState = React.useState(-1);
        var index = indexState[0], setIndex = indexState[1];
        var doneState = React.useState(false);
        var done = doneState[0], setDone = doneState[1];
        var fullTextState = React.useState('');
        var fullText = fullTextState[0], setFullText = fullTextState[1];
        var subRef = React.useRef(null);

        React.useEffect(function() {
          if (!hasStuardApi || !streamId) return;

          window.stuard.subscribeStream(streamId, function(evt) {
            if (evt.closed || evt.index === -1) { setDone(true); return; }
            setChunk(evt.data);
            setIndex(evt.index);
            if (typeof evt.data === 'string') {
              setFullText(function(prev) { return prev + evt.data; });
            }
          }).then(function(res) {
            if (res.ok) subRef.current = res.subscriberId;
          });

          return function() {
            if (subRef.current) {
              window.stuard.unsubscribeStream(streamId, subRef.current);
            }
          };
        }, [streamId]);

        return {
          chunk: chunk, frame: chunk,
          text: typeof chunk === 'string' ? chunk : null,
          fullText: fullText, index: index, done: done,
        };
      }

      // === User Component ===
      // NOTE: In strict mode, function declarations inside blocks (try/catch)
      // are block-scoped. We convert "function App(" to "App = function App("
      // so the assignment reaches the outer var App.
      var App;
      try {
        ${processedComponent.replace(/^(\s*)function\s+App\s*\(/m, '$1App = function App(')}
      } catch (__compDefError) {
        console.error('[stuard] Component definition error:', __compDefError);
        App = function ErrorApp() {
          return React.createElement('div', { className: 'p-6 space-y-3' },
            React.createElement('h2', { className: 'text-red-500 font-bold text-lg' }, 'Component Error'),
            React.createElement('pre', {
              className: 'text-xs text-red-400 bg-red-50 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap'
            }, String(__compDefError && __compDefError.message || __compDefError)),
            React.createElement('p', { className: 'text-slate-500 text-sm' }, 'Check the component code for syntax errors.'),
            React.createElement('button', {
              onClick: function() { if (hasStuardApi) stuard.close(); },
              className: 'btn-secondary mt-2'
            }, 'Close')
          );
        };
      }

      // === Render ===
      try {
        var root = document.getElementById('stuard-root');
        var AppComponent = typeof App === 'function' ? App : function() {
          return React.createElement('div', { className: 'p-4 text-red-400' },
            'No App component defined. Your component must define a function named App.'
          );
        };
        ReactDOM.render(React.createElement(AppComponent), root);
      } catch (__renderError) {
        console.error('[stuard] Render error:', __renderError);
        document.getElementById('stuard-root').innerHTML =
          '<div style="padding:24px;color:#f87171;font-family:monospace">' +
          '<h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">Render Error</h2>' +
          '<pre style="font-size:12px;background:#fef2f2;padding:12px;border-radius:8px;white-space:pre-wrap;overflow:auto;max-height:300px">' +
          String(__renderError && __renderError.message || __renderError).replace(/</g, '&lt;') +
          '</pre><p style="color:#94a3b8;font-size:13px;margin-top:12px">The component defined an App function but it failed to render.</p></div>';
      }
    })();
  `;
}
