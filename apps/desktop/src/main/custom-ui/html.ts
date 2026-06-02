import type { CustomUiHtmlOptions } from './types';
import { getReactRuntime } from './assets/react-runtime';
import { EXTRA_CSS } from './assets/utility-css';
import { prepareComponentCode } from './jsx-transform';

let tailwindPrebuiltCssCache: string | null = null;

function getTailwindPrebuiltCss(): string {
  if (tailwindPrebuiltCssCache !== null) {
    return tailwindPrebuiltCssCache;
  }

  try {
    const mod = require('./assets/tailwind-prebuilt') as { TAILWIND_PREBUILT_CSS?: string };
    tailwindPrebuiltCssCache = typeof mod?.TAILWIND_PREBUILT_CSS === 'string' ? mod.TAILWIND_PREBUILT_CSS : '';
  } catch {
    tailwindPrebuiltCssCache = '';
  }

  return tailwindPrebuiltCssCache;
}

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
    case 'translucent':
      // Translucent is handled via translucentCss in buildThemeCss
      backgroundCss = '';
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
  overflow: string;
  shadowCss: string;
  borderCss: string;
  backgroundCss: string;
  backgroundOverlayCss: string;
  animationCss: string;
  translucentCss: string;
}): string {
  const {
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding, overflow,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
    translucentCss,
  } = options;

  const radiusStyle = borderRadius > 0 ? `border-radius: ${borderRadius}px;` : '';
  const overflowStyle = overflow ? `overflow: ${overflow};` : (borderRadius > 0 ? 'overflow: hidden;' : '');
  const bgValue = transparentBg ? 'transparent' : (backgroundType === 'color' ? backgroundColor : 'transparent');

  // When borderRadius > 0 the Electron window is transparent so rounded corners
  // are visible. html must stay transparent; only the inner containers (which have
  // border-radius + overflow:hidden) should carry the background color.
  const htmlBg = borderRadius > 0 ? 'transparent' : bgValue;
  const bodyBg = borderRadius > 0 ? 'transparent' : bgValue;
  const containerBg = bgValue; // inner container always gets the real background

  return `
    html { background: ${htmlBg}; -webkit-font-smoothing: antialiased; height: 100%; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${bodyBg}; color: #1e293b; height: 100%;
      margin: 0; padding: 0;
      font-size: 14px; line-height: 1.5;
      ${borderRadius > 0 ? `${radiusStyle} ${overflowStyle}` : ''}
      ${animationCss}
    }
    .overlay-container, .root, .stuard-root {
      background: ${containerBg}; ${radiusStyle} ${shadowCss} ${borderCss} ${overflowStyle}
      height: 100%; ${contentPadding ? `padding: ${contentPadding}px;` : ''}
    }
    ${backgroundType !== 'color' && !transparentBg ? `
    .stuard-background { position: fixed; inset: 0; ${backgroundCss} ${backgroundOverlayCss} z-index: -1; }` : ''}
    ${backgroundType === 'translucent' ? `
    html, body { background: transparent !important; }
    .stuard-root, .root, .overlay-container { ${translucentCss} }` : ''}
    ${transparentBg && backgroundType !== 'translucent' ? `
    html, body, .dark, .stuard-root, .root, .overlay-container, body > div, body > div > div {
      background: transparent !important; background-color: transparent !important;
    }` : ''}

    /* === Component Defaults === */
    /* Use .btn class for opinionated button styling; bare <button> stays neutral
       so Tailwind utility classes (bg-*, text-*, p-*) are not overridden. */
    button {
      cursor: pointer; user-select: none; border: none; background: transparent;
      color: inherit; font: inherit; padding: 0; transition: all 0.15s ease;
    }
    button:active { transform: scale(0.98); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 8px 16px; border: none; background: #f1f5f9;
      color: #475569; border-radius: 8px; font-weight: 500; font-size: 13px;
      transition: all 0.15s ease; gap: 8px; cursor: pointer; user-select: none;
    }
    .btn:hover { background: #e2e8f0; }
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
    /* Use inherit so parent Tailwind text-* classes flow through to rendered elements */
    h1, h2, h3, h4, h5, h6 { color: inherit; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: inherit; }
    strong { color: inherit; font-weight: 700; }
    em { color: inherit; }
    li { color: inherit; }
    blockquote { color: inherit; }
    label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }

    /* Prose helper: when no Tailwind text-* is set, fall back to sensible defaults */
    .prose:not([class*="text-"]) { color: #475569; }
    .prose:not([class*="text-"]) h1, .prose:not([class*="text-"]) h2,
    .prose:not([class*="text-"]) h3, .prose:not([class*="text-"]) h4,
    .prose:not([class*="text-"]) h5, .prose:not([class*="text-"]) h6 { color: #0f172a; }

    /* Dark mode - add class="dark" to body or html */
    body.dark, .dark body { background: #0f172a; color: #e2e8f0; }
    body.dark .card, .dark .card { background: rgba(30,41,59,0.5); border-color: rgba(255,255,255,0.05); }
    body.dark input, body.dark textarea, body.dark select,
    .dark input, .dark textarea, .dark select {
      background: rgba(15,23,42,0.6); border-color: rgba(148,163,184,0.1); color: #f1f5f9;
    }
    body.dark .btn, .dark .btn { background: #334155; color: white; }
    body.dark .btn:hover, .dark .btn:hover { background: #475569; }
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
    translucent,
    shadow,
    border,
    animation,
    contentPadding = 0,
    draggable = true,
    uiPackagesJs = '',
    uiPackagesCss = '',
    uiPackagesModules,
  } = options;

  // Build sub-CSS pieces
  const { backgroundCss, backgroundOverlayCss } = buildBackgroundCss(backgroundType, backgroundColor, gradient, backgroundImage);

  // Build translucent CSS
  let translucentCss = '';
  if (backgroundType === 'translucent') {
    const tColor = translucent?.color || '#1a1a2e';
    const tOpacity = Math.max(0, Math.min(1, translucent?.opacity ?? 0.7));
    const tBlur = translucent?.blur ?? 12;
    // Convert hex to rgba
    const r = parseInt(tColor.slice(1, 3), 16) || 0;
    const g = parseInt(tColor.slice(3, 5), 16) || 0;
    const b = parseInt(tColor.slice(5, 7), 16) || 0;
    translucentCss = `background-color: rgba(${r}, ${g}, ${b}, ${tOpacity}) !important;`;
    if (tBlur > 0) {
      translucentCss += ` backdrop-filter: blur(${tBlur}px); -webkit-backdrop-filter: blur(${tBlur}px);`;
    }
  }
  const shadowCss = shadow?.enabled
    ? `box-shadow: ${shadow.x || 0}px ${shadow.y || 4}px ${shadow.blur || 12}px ${shadow.spread || 0}px ${shadow.color || '#00000040'};`
    : '';
  const borderCss = border?.enabled
    ? `border: ${border.width || 1}px ${border.style || 'solid'} ${border.color || '#ffffff20'};`
    : '';
  const { animationCss, animationKeyframes } = buildAnimationCss(animation);

  const overflow = options.overflow || '';
  const themeCss = buildThemeCss({
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding, overflow,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
    translucentCss,
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

  const { code: processedComponent, diagnostics } = prepareComponentCode(rawCode, { availableModules: uiPackagesModules });

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
    id, flowId, data, processedComponent, diagnostics,
  });

  return `<!DOCTYPE html>
<html${(transparentBg || borderRadius > 0) ? ' style="background:transparent!important"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: file:; img-src * data: blob: local-file: file:; media-src * data: blob: local-file: file:; font-src * data:;">
  <title>${escapeHtml(title)}</title>
  <style>${getTailwindPrebuiltCss()}</style>
  <style>${EXTRA_CSS}</style>
  ${uiPackagesCss ? `<style>${uiPackagesCss}</style>` : ''}
  <style>${themeCss}\n${css || ''}\n${animationKeyframes}</style>
  <script>${reactRuntime}<\/script>
  ${uiPackagesJs ? `<script>${uiPackagesJs}<\/script>` : ''}
</head>
<body${(transparentBg || borderRadius > 0) ? ' style="background:transparent!important"' : ''}>
  ${bgOverlay}
  <div class="stuard-root${draggable ? ' drag' : ''}" id="stuard-root"></div>
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
  diagnostics?: import('./jsx-transform').ComponentDiagnostic[];
}): string {
  const { id, flowId, data, processedComponent, diagnostics } = options;

  return `
    // === Stuard Custom UI Runtime (React + JSX) ===
    (function() {
      'use strict';

      var CUSTOM_UI_ID = ${JSON.stringify(id)};
      var FLOW_ID = ${JSON.stringify(flowId)};

      // Convert raw filesystem paths to file:// URLs so <img src> etc. can load them
      // Uses String.fromCharCode(92) for backslash to avoid template-literal escaping issues
      function toFileUrl(val) {
        if (typeof val !== 'string') return val;
        var bs = String.fromCharCode(92); // backslash
        // Windows absolute path: C:\ or C:/
        if (val.length > 2 && /^[A-Za-z]$/.test(val[0]) && val[1] === ':' && (val[2] === bs || val[2] === '/')) {
          return 'file:///' + val.split(bs).join('/');
        }
        // Unix absolute path with file extension
        if (val[0] === '/' && val[1] !== '/' && val.lastIndexOf('.') > val.lastIndexOf('/')) {
          return 'file://' + val;
        }
        return val;
      }
      function convertDataPaths(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        var out = {};
        for (var k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) {
            out[k] = toFileUrl(obj[k]);
          }
        }
        return out;
      }

      window.initialData = convertDataPaths(${JSON.stringify(data)});
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

      // === UI Packages Require Shim ===
      // Component imports are rewritten to these helpers. Packages are bundled
      // into window.__stuardUiPackages.modules at install time (see ui-packages service).
      function __stuardRequire(name) {
        var reg = window.__stuardUiPackages;
        if (!reg || !reg.modules || !Object.prototype.hasOwnProperty.call(reg.modules, name)) {
          throw new Error('Package "' + name + '" is not installed for this custom_ui. ' +
            'Install it with the ui_packages_install tool (or pass uiPackages), then set uiPackageSet on this custom_ui.');
        }
        return reg.modules[name];
      }
      function __stuardImportDefault(name) {
        var mod = __stuardRequire(name);
        return (mod && mod.default !== undefined) ? mod.default : mod;
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

      // === Framer Motion globals ===
      var motion = (window.Motion && window.Motion.motion) ? window.Motion.motion : undefined;
      var AnimatePresence = (window.Motion && window.Motion.AnimatePresence) ? window.Motion.AnimatePresence : undefined;
      var useAnimation = (window.Motion && window.Motion.useAnimation) ? window.Motion.useAnimation : undefined;
      var useMotionValue = (window.Motion && window.Motion.useMotionValue) ? window.Motion.useMotionValue : undefined;
      var useTransform = (window.Motion && window.Motion.useTransform) ? window.Motion.useTransform : undefined;
      var useSpring = (window.Motion && window.Motion.useSpring) ? window.Motion.useSpring : undefined;

      // === React-Markdown globals ===
      var ReactMarkdown = window.ReactMarkdown || undefined;
      var Markdown = ReactMarkdown;
      var remarkGfm = window.remarkGfm || undefined;
      var remarkMath = window.remarkMath || undefined;
      var rehypeKatex = window.rehypeKatex || undefined;

      // === Built-in utility components ===
      var Badge = function Badge(props) {
        var variant = props.variant || 'default';
        var colors = {
          default: { background: '#334155', color: '#e2e8f0' },
          success: { background: '#065f46', color: '#6ee7b7' },
          warning: { background: '#78350f', color: '#fcd34d' },
          error: { background: '#7f1d1d', color: '#fca5a5' },
          info: { background: '#1e3a5f', color: '#93c5fd' },
          primary: { background: '#3730a3', color: '#a5b4fc' },
        };
        var base = colors[variant] || colors['default'];
        var style = { background: base.background, color: base.color, display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: '500', lineHeight: '1.5', whiteSpace: 'nowrap' };
        return React.createElement('span', { style: style, className: props.className }, props.children);
      };

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

      // === useStyles Hook ===
      // Injects dynamic CSS into the document head. Auto-cleans on unmount.
      function useStyles(cssString) {
        var idRef = React.useRef(null);
        React.useEffect(function() {
          if (!cssString) return;
          // Reuse existing style element if present (HMR-safe)
          if (idRef.current) {
            var existing = document.getElementById(idRef.current);
            if (existing) { existing.textContent = cssString; return; }
          }
          var id = 'useStyles-' + Math.random().toString(36).substr(2, 9);
          idRef.current = id;
          var style = document.createElement('style');
          style.id = id;
          style.textContent = cssString;
          document.head.appendChild(style);
          return function() {
            var el = document.getElementById(id);
            if (el) el.remove();
          };
        }, [cssString]);
      }

      // === useInterval Hook ===
      function useInterval(callback, delay) {
        var savedCallback = React.useRef(callback);
        React.useEffect(function() { savedCallback.current = callback; });
        React.useEffect(function() {
          if (delay === null || delay === undefined) return;
          var id = setInterval(function() { savedCallback.current(); }, delay);
          return function() { clearInterval(id); };
        }, [delay]);
      }

      // === useTimeout Hook ===
      function useTimeout(callback, delay) {
        var savedCallback = React.useRef(callback);
        React.useEffect(function() { savedCallback.current = callback; });
        React.useEffect(function() {
          if (delay === null || delay === undefined) return;
          var id = setTimeout(function() { savedCallback.current(); }, delay);
          return function() { clearTimeout(id); };
        }, [delay]);
      }

      // === useLocalStorage Hook ===
      function useLocalStorage(key, initialValue) {
        var state = React.useState(function() {
          try {
            var item = localStorage.getItem(key);
            return item !== null ? JSON.parse(item) : initialValue;
          } catch(e) { return initialValue; }
        });
        var storedValue = state[0], setStoredValue = state[1];
        var setValue = React.useCallback(function(newValue) {
          setStoredValue(newValue);
          try { localStorage.setItem(key, JSON.stringify(newValue)); } catch(e) {}
        }, [key]);
        return [storedValue, setValue];
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
          var cancelled = false;
          setChunk(null);
          setIndex(-1);
          setDone(false);
          setFullText('');

          window.stuard.subscribeStream(streamId, function(evt) {
            if (cancelled) return;
            if (evt.closed || evt.index === -1) { setDone(true); return; }
            setChunk(evt.data);
            setIndex(evt.index);
            if (typeof evt.data === 'string') {
              setFullText(function(prev) { return prev + evt.data; });
            }
          }).then(function(res) {
            if (!res.ok) return;
            if (cancelled) {
              window.stuard.unsubscribeStream(streamId, res.subscriberId);
              return;
            }
            subRef.current = res.subscriberId;
          });

          return function() {
            cancelled = true;
            if (subRef.current) {
              window.stuard.unsubscribeStream(streamId, subRef.current);
              subRef.current = null;
            }
          };
        }, [streamId]);

        return {
          chunk: chunk, frame: chunk,
          text: typeof chunk === 'string' ? chunk : null,
          fullText: fullText, index: index, done: done,
        };
      }

      // === Pre-render Diagnostics ===
      var __diagnostics = ${JSON.stringify(diagnostics || [])};
      if (__diagnostics.length > 0) {
        console.warn('[stuard] Component validation issues:');
        __diagnostics.forEach(function(d) {
          var method = d.severity === 'error' ? 'error' : 'warn';
          console[method]('  Line ' + d.line + ': [' + d.severity + '] ' + d.message);
        });
      }

      // === Component Source (for error display) ===
      var __componentSource = ${JSON.stringify(processedComponent)};

      // Build line-numbered source display with optional highlighted lines
      function __buildSourceDisplay(errorMsg) {
        var lines = __componentSource.split('\\n');
        var highlightLines = {};

        // Identify error lines: check for "X is not defined" and highlight references
        var undefMatch = errorMsg && errorMsg.match(/(\\w+) is not defined/);
        if (undefMatch) {
          var ident = undefMatch[1];
          lines.forEach(function(line, i) {
            if (line.indexOf(ident) !== -1) highlightLines[i] = true;
          });
        }

        return lines.map(function(line, i) {
          var num = String(i + 1);
          while (num.length < 3) num = ' ' + num;
          var isErr = highlightLines[i] === true;
          var arrow = isErr ? '>>>' : '   ';
          var bg = isErr ? 'background:#451a03;display:inline-block;width:100%' : '';
          var color = isErr ? 'color:#fbbf24;font-weight:bold' : 'color:#94a3b8';
          return '<span style="' + color + ';' + bg + '">' + arrow + ' ' + num + ' | ' +
            line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
        }).join('\\n');
      }

      function __showComponentError(title, error, hint) {
        var root = document.getElementById('stuard-root');
        var msg = error && error.message ? error.message : String(error);
        var sourceHtml = __buildSourceDisplay(msg);
        root.innerHTML =
          '<div style="padding:20px;color:#f87171;font-family:system-ui;height:100%;overflow:auto;background:#0f0f0f">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
          '<span style="background:#dc2626;color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold">ERROR</span>' +
          '<span style="font-size:16px;font-weight:bold;color:#fca5a5">' + title + '</span></div>' +
          '<pre style="font-size:12px;background:#1c1c1c;padding:12px;border-radius:8px;white-space:pre-wrap;overflow:auto;max-height:120px;margin-bottom:12px;border:1px solid #7f1d1d">' +
          msg.replace(/</g, '&lt;') + '</pre>' +
          '<div style="font-size:11px;color:#6b7280;margin-bottom:8px;font-weight:600">COMPONENT SOURCE</div>' +
          '<pre style="font-size:11px;line-height:1.6;background:#1a1a1a;padding:12px;border-radius:8px;overflow:auto;max-height:300px;border:1px solid #333;font-family:Consolas,Monaco,monospace">' +
          sourceHtml + '</pre>' +
          (hint ? '<p style="color:#6b7280;font-size:12px;margin-top:12px">' + hint + '</p>' : '') +
          '<button onclick="if(window.stuard)stuard.close()" style="margin-top:12px;padding:6px 16px;background:#333;color:#ccc;border:none;border-radius:6px;cursor:pointer;font-size:12px">Close</button>' +
          '</div>';
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
          __showComponentError('Component Definition Error', __compDefError,
            'The component code threw an error while being defined. Check for syntax errors or undefined references.');
          return null;
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
        __showComponentError('Render Error', __renderError,
          'The component defined an App function but it failed to render.');
      }
    })();
  `;
}
