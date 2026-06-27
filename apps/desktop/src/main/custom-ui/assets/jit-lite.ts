/**
 * Runtime Tailwind "JIT-lite" for Custom UI Windows
 *
 * The prebuilt Tailwind CSS (tailwind-prebuilt.ts) is a static safelist build —
 * it cannot contain color opacity modifiers beyond black/white (bg-zinc-900/95),
 * arbitrary values (text-[12px], max-w-[180px]) or state variants (hover:scale-125).
 * Components written with modern Tailwind habits silently lose their backgrounds,
 * sizes and hover states.
 *
 * This script runs inside the custom UI window, watches the DOM for class names
 * the loaded stylesheets don't cover, and synthesizes the missing rules at runtime:
 *
 *  - `X/<alpha>` where `.X` exists        → clones the rule, bakes the alpha into
 *                                           the rgb(... / var(--tw-*-opacity)) slot
 *  - color utils for any palette shade    → rgb triple recovered from .bg-/.text- rules
 *  - arbitrary values `prop-[value]`      → property table (underscores become spaces)
 *  - variants hover:/focus:/active:/disabled:/dark:/group-hover: of any of the
 *    above or of any class already present in the stylesheets
 *
 * Kept dependency-free and ES5-compatible; injected as an inline <script> by html.ts
 * and shared with the UI builder preview / chat genui via customUi:getPrebuiltAssets.
 */

export const JIT_LITE_JS = String.raw`
(function () {
  'use strict';
  if (window.__stuardJitLite) return;
  window.__stuardJitLite = true;

  var styleEl = document.createElement('style');
  styleEl.id = 'stuard-jit-lite';
  (document.head || document.documentElement).appendChild(styleEl);

  var known = null; // class name -> declaration block (from already-loaded stylesheets)
  var processed = Object.create(null);

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function buildIndex() {
    known = Object.create(null);
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].ownerNode === styleEl) continue;
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        var sel = r.selectorText;
        if (!sel || sel.charCodeAt(0) !== 46) continue;
        // Single-class selectors only (".foo", possibly with escaped chars)
        var m = sel.match(/^\.((?:\\.|[A-Za-z0-9_-])+)$/);
        if (!m) continue;
        var name = m[1].replace(/\\(.)/g, '$1');
        if (name in known) continue;
        var text = r.cssText;
        var a = text.indexOf('{');
        var b = text.lastIndexOf('}');
        if (a === -1 || b <= a) continue;
        known[name] = text.slice(a + 1, b).trim();
      }
    }
  }

  function isColorValue(v) {
    return /^(#|rgb|rgba|hsl|hsla|oklch|oklab|color\(|color-mix|var\(|currentColor|transparent)/i.test(v);
  }

  // Recover the "R G B" triple for a palette color (e.g. "zinc-900") from any
  // already-generated rule, so we never need to embed the palette itself.
  function paletteTriple(colorName) {
    if (colorName === 'white') return '255 255 255';
    if (colorName === 'black') return '0 0 0';
    var src = known['bg-' + colorName] || known['text-' + colorName] || known['border-' + colorName];
    if (!src) return null;
    var m = src.match(/rgb\(\s*([0-9.]+[, ]+[0-9.]+[, ]+[0-9.]+)\s*[\/)]/);
    return m ? m[1].replace(/,/g, ' ') : null;
  }

  var COLOR_PROPS = {
    'bg': 'background-color',
    'text': 'color',
    'border': 'border-color',
    'border-t': 'border-top-color',
    'border-r': 'border-right-color',
    'border-b': 'border-bottom-color',
    'border-l': 'border-left-color',
    'ring': '--tw-ring-color',
    'fill': 'fill',
    'stroke': 'stroke',
    'outline': 'outline-color',
    'accent': 'accent-color',
    'caret': 'caret-color'
  };

  var ARBITRARY_PROPS = {
    'w': ['width'], 'h': ['height'], 'size': ['width', 'height'],
    'min-w': ['min-width'], 'max-w': ['max-width'],
    'min-h': ['min-height'], 'max-h': ['max-height'],
    'p': ['padding'], 'px': ['padding-left', 'padding-right'], 'py': ['padding-top', 'padding-bottom'],
    'pt': ['padding-top'], 'pr': ['padding-right'], 'pb': ['padding-bottom'], 'pl': ['padding-left'],
    'm': ['margin'], 'mx': ['margin-left', 'margin-right'], 'my': ['margin-top', 'margin-bottom'],
    'mt': ['margin-top'], 'mr': ['margin-right'], 'mb': ['margin-bottom'], 'ml': ['margin-left'],
    'top': ['top'], 'right': ['right'], 'bottom': ['bottom'], 'left': ['left'], 'inset': ['inset'],
    'gap': ['gap'], 'gap-x': ['column-gap'], 'gap-y': ['row-gap'],
    'z': ['z-index'], 'leading': ['line-height'], 'tracking': ['letter-spacing'], 'opacity': ['opacity'],
    'rounded': ['border-radius'],
    'rounded-t': ['border-top-left-radius', 'border-top-right-radius'],
    'rounded-b': ['border-bottom-left-radius', 'border-bottom-right-radius'],
    'rounded-l': ['border-top-left-radius', 'border-bottom-left-radius'],
    'rounded-r': ['border-top-right-radius', 'border-bottom-right-radius'],
    'rounded-tl': ['border-top-left-radius'], 'rounded-tr': ['border-top-right-radius'],
    'rounded-bl': ['border-bottom-left-radius'], 'rounded-br': ['border-bottom-right-radius'],
    'grid-cols': ['grid-template-columns'], 'grid-rows': ['grid-template-rows'],
    'duration': ['transition-duration'], 'delay': ['transition-delay'],
    'basis': ['flex-basis'], 'flex': ['flex'], 'order': ['order'],
    'font': ['font-family']
  };

  function declsFor(props, value) {
    var out = [];
    for (var i = 0; i < props.length; i++) out.push(props[i] + ': ' + value);
    return out.join('; ');
  }

  function synthesize(base) {
    // 1) "<known-class>/<alpha>" — clone the rule and bake in the alpha
    var am = base.match(/^(.*)\/(\d{1,3})$/);
    if (am && known[am[1]]) {
      var alpha = Math.min(100, parseInt(am[2], 10)) / 100;
      var src = known[am[1]];
      if (src.indexOf('-opacity') !== -1) {
        return src.replace(/var\(--tw-[a-z-]+-opacity(?:\s*,[^)]*)?\)/g, String(alpha));
      }
    }

    // 2) color utilities — palette or arbitrary color, optional /alpha
    var cm = base.match(/^(bg|text|border|border-[trbl]|ring|fill|stroke|outline|accent|caret)-(.+?)(?:\/(\d{1,3}))?$/);
    if (cm && COLOR_PROPS[cm[1]]) {
      var prop = COLOR_PROPS[cm[1]];
      var alphaPct = cm[3] ? Math.min(100, parseInt(cm[3], 10)) : null;
      var ab = cm[2].match(/^\[(.+)\]$/);
      if (ab) {
        var raw = ab[1].replace(/_/g, ' ');
        if (isColorValue(raw)) {
          var v = alphaPct === null ? raw : 'color-mix(in srgb, ' + raw + ' ' + alphaPct + '%, transparent)';
          return prop + ': ' + v;
        }
      } else {
        var triple = paletteTriple(cm[2]);
        if (triple) {
          return prop + ': rgb(' + triple + ' / ' + (alphaPct === null ? 1 : alphaPct / 100) + ')';
        }
      }
    }

    // 3) arbitrary values: prop-[value]
    var ar = base.match(/^(-?)([a-z-]+)-\[([^\]]+)\]$/);
    if (ar) {
      var value = ar[3].replace(/_/g, ' ');
      var key = ar[2];
      if (ar[1] === '-' && /^[0-9.]/.test(value)) value = '-' + value;
      if (key === 'text') return isColorValue(value) ? 'color: ' + value : 'font-size: ' + value;
      if (key === 'bg') return isColorValue(value) ? 'background-color: ' + value : 'background: ' + value;
      if (key === 'border') return isColorValue(value) ? 'border-color: ' + value : 'border-width: ' + value;
      var props = ARBITRARY_PROPS[key];
      if (props) return declsFor(props, value);
    }

    return null;
  }

  var PSEUDO = {
    'hover': ':hover', 'focus': ':focus', 'focus-within': ':focus-within',
    'focus-visible': ':focus-visible', 'active': ':active', 'visited': ':visited',
    'disabled': ':disabled', 'first': ':first-child', 'last': ':last-child',
    'odd': ':nth-child(odd)', 'even': ':nth-child(even)'
  };

  function processClass(cls) {
    if (processed[cls]) return;
    processed[cls] = true;
    if (!cls || known[cls]) return;

    var parts = cls.split(':');
    var base = parts.pop();
    if (parts.length === 0 && known[base]) return;
    var decls = known[base] || synthesize(base);
    if (!decls) return;

    var selector = '.' + cssEscape(cls);
    var prefix = '';
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i];
      if (v === 'dark') prefix = '.dark ' + prefix;
      else if (v === 'group-hover') prefix = prefix + '.group:hover ';
      else if (PSEUDO[v]) selector += PSEUDO[v];
      else return; // unsupported variant (responsive breakpoints etc.)
    }
    try {
      styleEl.sheet.insertRule(prefix + selector + ' { ' + decls + ' }', styleEl.sheet.cssRules.length);
    } catch (e) { /* synthesized rule was invalid — skip */ }
  }

  function scanElement(el) {
    if (!el || !el.classList) return;
    for (var i = 0; i < el.classList.length; i++) processClass(el.classList[i]);
  }

  function scanTree(root) {
    if (!known) buildIndex();
    scanElement(root);
    if (root.querySelectorAll) {
      var els = root.querySelectorAll('[class]');
      for (var i = 0; i < els.length; i++) scanElement(els[i]);
    }
  }

  new MutationObserver(function (muts) {
    if (!known) buildIndex();
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'attributes') {
        scanElement(m.target);
      } else if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) scanTree(n);
        }
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scanTree(document.documentElement); });
  } else {
    scanTree(document.documentElement);
  }
})();
`;
