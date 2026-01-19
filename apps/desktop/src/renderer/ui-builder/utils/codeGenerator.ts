/**
 * Code Generator
 * Converts UIDesign to HTML/CSS/JS for the custom_ui tool
 */

import type { UIDesign, UIElement, UIElementStyle, GeneratedCode, ButtonVariant, LayoutMode } from '../types';
import { SHADOWS, HEADING_SIZES, BUTTON_VARIANTS, paddingToCSS, createEmptyDesign } from './defaultStyles';

// === HTML Generation ===

/**
 * Generate HTML attributes string from element bindings
 */
function generateDataAttributes(element: UIElement): string {
  const attrs: string[] = [];

  if (element.bindings.dataBind) {
    attrs.push(`data-bind="${escapeHtml(element.bindings.dataBind)}"`);
  }
  if (element.bindings.dataAction) {
    attrs.push(`data-action="${escapeHtml(element.bindings.dataAction)}"`);
  }
  if (element.bindings.dataHtml) {
    attrs.push('data-html="true"');
  }
  if (element.props.disabled) {
    attrs.push('disabled');
  }
  if (element.props.required) {
    attrs.push('required');
  }

  return attrs.join(' ');
}

/**
 * Generate inline style string from element style
 */
function generateInlineStyle(element: UIElement, parentLayout?: LayoutMode): string {
  const styles: string[] = [];
  const s = element.style;

  const shouldUseFreePositioning = !parentLayout || parentLayout === 'free';

  if (element.props.hidden) {
    styles.push('display: none');
  }

  if (shouldUseFreePositioning) {
    styles.push('position: absolute');
    styles.push(`left: ${element.x}px`);
    styles.push(`top: ${element.y}px`);
    if (typeof element.zIndex === 'number') {
      styles.push(`z-index: ${element.zIndex}`);
    }
  } else if (element.layout === 'free') {
    styles.push('position: relative');
  }

  // Position and size
  if (typeof element.width === 'number') {
    styles.push(`width: ${element.width}px`);
  } else if (element.width === 'full') {
    styles.push('width: 100%');
  }

  if (typeof element.height === 'number') {
    styles.push(`height: ${element.height}px`);
  }

  // Background
  if (s.backgroundColor) {
    styles.push(`background-color: ${s.backgroundColor}`);
  }

  // Text
  if (s.textColor) {
    styles.push(`color: ${s.textColor}`);
  }
  if (s.fontSize) {
    styles.push(`font-size: ${s.fontSize}px`);
  }
  if (s.fontWeight) {
    const weights: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };
    styles.push(`font-weight: ${weights[s.fontWeight] || 400}`);
  }
  if (s.textAlign) {
    styles.push(`text-align: ${s.textAlign}`);
  }

  // Border
  if (s.borderRadius !== undefined) {
    styles.push(`border-radius: ${s.borderRadius}px`);
  }
  if (s.borderWidth && s.borderColor) {
    styles.push(`border: ${s.borderWidth}px solid ${s.borderColor}`);
  }

  // Spacing
  if (s.padding !== undefined) {
    styles.push(`padding: ${paddingToCSS(s.padding)}`);
  }
  if (s.margin !== undefined) {
    styles.push(`margin: ${paddingToCSS(s.margin)}`);
  }

  // Shadow
  if (s.shadow && s.shadow !== 'none') {
    styles.push(`box-shadow: ${SHADOWS[s.shadow]}`);
  }

  // Opacity
  if (s.opacity !== undefined && s.opacity !== 1) {
    styles.push(`opacity: ${s.opacity}`);
  }

  // Container layout
  if (element.layout) {
    if (element.layout === 'flex-row') {
      styles.push('display: flex; flex-direction: row');
    } else if (element.layout === 'flex-col') {
      styles.push('display: flex; flex-direction: column');
    } else if (element.layout === 'grid') {
      const cols = element.gridCols || element.props.columns || 3;
      styles.push(`display: grid; grid-template-columns: repeat(${cols}, 1fr)`);
    }

    if (element.gap) {
      styles.push(`gap: ${element.gap}px`);
    }
    if (element.alignItems) {
      const alignMap: Record<string, string> = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        stretch: 'stretch',
      };
      styles.push(`align-items: ${alignMap[element.alignItems] || element.alignItems}`);
    }
    if (element.justifyContent) {
      const justifyMap: Record<string, string> = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        between: 'space-between',
        around: 'space-around',
        evenly: 'space-evenly',
      };
      styles.push(`justify-content: ${justifyMap[element.justifyContent] || element.justifyContent}`);
    }
  }

  return styles.length > 0 ? `style="${styles.join('; ')}"` : '';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Process text for {{data.field}} interpolation
 */
function processText(text: string): string {
  // Convert {{field}} to <span data-bind="field"></span>
  return text.replace(/\{\{([^}]+)\}\}/g, (_, field) => {
    return `<span data-bind="${escapeHtml(field.trim())}"></span>`;
  });
}

/**
 * Generate HTML for a single element
 */
function generateElementHTML(element: UIElement, indent: string = '', parentLayout?: LayoutMode): string {
  const attrs = generateDataAttributes(element);
  const style = generateInlineStyle(element, parentLayout);
  const elementId = `data-element-id="${element.id}"`;
  const attrStr = [elementId, attrs, style].filter(Boolean).join(' ');

  switch (element.type) {
    case 'button': {
      const variant = element.props.variant || 'primary';
      const variantClass = `btn btn-${variant}`;
      const text = element.props.text || 'Button';
      return `${indent}<button class="${variantClass}" ${attrStr}>${escapeHtml(text)}</button>`;
    }

    case 'input': {
      const type = element.props.inputType || 'text';
      const placeholder = element.props.placeholder || '';
      return `${indent}<input type="${type}" placeholder="${escapeHtml(placeholder)}" ${attrStr} />`;
    }

    case 'textarea': {
      const placeholder = element.props.placeholder || '';
      return `${indent}<textarea placeholder="${escapeHtml(placeholder)}" ${attrStr}></textarea>`;
    }

    case 'text': {
      const text = element.props.text || '';
      const processedText = processText(text);
      return `${indent}<span ${attrStr}>${processedText}</span>`;
    }

    case 'heading': {
      const level = element.props.level || 2;
      const text = element.props.text || 'Heading';
      return `${indent}<h${level} ${attrStr}>${escapeHtml(text)}</h${level}>`;
    }

    case 'image': {
      const src = element.props.src || '';
      const alt = element.props.alt || '';
      const fit = element.props.objectFit || 'cover';
      return `${indent}<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="object-fit: ${fit};" ${attrStr} />`;
    }

    case 'icon': {
      const icon = element.props.icon || 'Star';
      return `${indent}<span class="icon icon-${icon.toLowerCase()}" ${attrStr}></span>`;
    }

    case 'checkbox': {
      const text = element.props.text || '';
      const checkId = `${element.id}-check`;
      return `${indent}<label ${attrStr}><input type="checkbox" id="${checkId}" ${element.bindings.dataBind ? `data-bind="${element.bindings.dataBind}"` : ''} />${escapeHtml(text)}</label>`;
    }

    case 'select': {
      const options = element.props.options || [];
      const optionsHtml = options.map(opt =>
        `  <option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`
      ).join('\n' + indent);
      return `${indent}<select ${attrStr}>\n${indent}${optionsHtml}\n${indent}</select>`;
    }

    case 'slider': {
      const min = element.props.min ?? 0;
      const max = element.props.max ?? 100;
      const step = element.props.step ?? 1;
      return `${indent}<input type="range" min="${min}" max="${max}" step="${step}" ${attrStr} />`;
    }

    case 'badge': {
      const text = element.props.text || 'Badge';
      const color = element.props.color || 'blue';
      return `${indent}<span class="badge badge-${color}" ${attrStr}>${escapeHtml(text)}</span>`;
    }

    case 'progress': {
      const value = element.props.value || 0;
      return `${indent}<div class="progress" ${attrStr}><div class="progress-bar" style="width: ${value}%;"></div></div>`;
    }

    case 'divider':
      return `${indent}<hr ${attrStr} />`;

    case 'spacer':
      return `${indent}<div class="spacer" ${attrStr}></div>`;

    case 'container':
    case 'row':
    case 'column':
    case 'grid':
    case 'card': {
      const children = element.children || [];
      const childrenHtml = children.map(c => generateElementHTML(c, indent + '  ', element.layout)).join('\n');
      const tag = element.type === 'card' ? 'div' : 'div';
      const className = element.type === 'card' ? 'class="card"' : '';
      return `${indent}<${tag} ${className} ${attrStr}>\n${childrenHtml}\n${indent}</${tag}>`;
    }

    case 'thumbnail-grid': {
      return `${indent}<div class="thumbnail-grid" ${attrStr}></div>`;
    }

    case 'file-list': {
      return `${indent}<div class="file-list" ${attrStr}></div>`;
    }

    case 'data-table': {
      const headers = element.props.headers || [];
      const data = element.props.data || [];
      const headersHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
      const rowsHtml = data.map(row =>
        `<tr>${row.map((cell: any) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`
      ).join('\n' + indent + '    ');
      return `${indent}<table class="data-table" ${attrStr}>
${indent}  <thead><tr>${headersHtml}</tr></thead>
${indent}  <tbody>
${indent}    ${rowsHtml}
${indent}  </tbody>
${indent}</table>`;
    }

    case 'code-block': {
      const code = element.props.text || '';
      const lang = element.props.language || 'text';
      return `${indent}<pre class="code-block" data-language="${lang}" ${attrStr}><code>${escapeHtml(code)}</code></pre>`;
    }

    default:
      return `${indent}<div ${attrStr}></div>`;
  }
}

// === CSS Generation ===

/**
 * Generate base CSS styles
 */
function generateBaseCSS(): string {
  return `
/* Base Styles */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1e293b;
}

/* Button Styles */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-primary {
  background-color: #4f46e5;
  color: white;
}
.btn-primary:hover {
  background-color: #4338ca;
}

.btn-secondary {
  background-color: #f1f5f9;
  color: #475569;
}
.btn-secondary:hover {
  background-color: #e2e8f0;
}

.btn-danger {
  background-color: #ef4444;
  color: white;
}
.btn-danger:hover {
  background-color: #dc2626;
}

.btn-ghost {
  background-color: transparent;
  color: #475569;
}
.btn-ghost:hover {
  background-color: #f1f5f9;
}

.btn-outline {
  background-color: transparent;
  color: #4f46e5;
  border: 1px solid #4f46e5;
}
.btn-outline:hover {
  background-color: #eef2ff;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Input Styles */
input[type="text"],
input[type="email"],
input[type="password"],
input[type="number"],
input[type="url"],
input[type="tel"],
textarea,
select {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background-color: white;
  color: #1e293b;
  transition: border-color 0.15s, box-shadow 0.15s;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

input::placeholder,
textarea::placeholder {
  color: #94a3b8;
}

/* Checkbox Styles */
label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

/* Badge Styles */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 9999px;
}

.badge-gray { background-color: #f1f5f9; color: #475569; }
.badge-red { background-color: #fee2e2; color: #b91c1c; }
.badge-yellow { background-color: #fef3c7; color: #a16207; }
.badge-green { background-color: #dcfce7; color: #15803d; }
.badge-blue { background-color: #dbeafe; color: #1d4ed8; }
.badge-indigo { background-color: #e0e7ff; color: #4338ca; }
.badge-purple { background-color: #ede9fe; color: #6d28d9; }
.badge-pink { background-color: #fce7f3; color: #be185d; }

/* Progress Bar */
.progress {
  width: 100%;
  height: 8px;
  background-color: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: #4f46e5;
  transition: width 0.3s ease;
}

/* Card */
.card {
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 16px;
}

/* Divider */
hr {
  border: none;
  height: 1px;
  background-color: #e2e8f0;
  margin: 16px 0;
}

/* Spacer */
.spacer {
  flex: 1;
}

/* Code Block */
.code-block {
  background-color: #1e293b;
  color: #e2e8f0;
  padding: 16px;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  overflow-x: auto;
}

/* Data Table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
}

.data-table th {
  background-color: #f8fafc;
  font-weight: 600;
  color: #475569;
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:hover {
  background-color: #f8fafc;
}

/* Thumbnail Grid */
.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 8px;
}

.thumbnail-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.thumbnail-grid img:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* File List */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.file-list-item:hover {
  background-color: #f8fafc;
}
`.trim();
}

// === JavaScript Generation ===

/**
 * Generate JavaScript for custom behaviors
 */
function generateBaseJS(): string {
  return `
// Custom UI Runtime
(function() {
  // Handle data-action buttons
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async function() {
      const action = this.getAttribute('data-action');
      const data = collectFormData();

      // Send action to parent
      if (window.customUIBridge) {
        window.customUIBridge.sendAction(action, data);
      } else {
        console.log('Action:', action, 'Data:', data);
      }
    });
  });

  // Collect form data from data-bind elements
  function collectFormData() {
    const data = {};
    document.querySelectorAll('[data-bind]').forEach(el => {
      const key = el.getAttribute('data-bind');
      if (el.tagName === 'INPUT') {
        if (el.type === 'checkbox') {
          data[key] = el.checked;
        } else {
          data[key] = el.value;
        }
      } else if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        data[key] = el.value;
      }
    });
    return data;
  }

  // Expose for external data binding
  window.customUI = {
    setData: function(data) {
      Object.entries(data).forEach(([key, value]) => {
        document.querySelectorAll(\`[data-bind="\${key}"]\`).forEach(el => {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            if (el.type === 'checkbox') {
              el.checked = Boolean(value);
            } else {
              el.value = value;
            }
          } else if (el.hasAttribute('data-html')) {
            el.innerHTML = value;
          } else {
            el.textContent = value;
          }
        });
      });
    },
    getData: collectFormData
  };
})();
`.trim();
}

// === Main Generator ===

/**
 * Generate complete code from a UI design
 */
export function generateCode(design: UIDesign): GeneratedCode {
  // Generate HTML for all elements
  const elementsHtml = design.elements
    .map(el => generateElementHTML(el, '  '))
    .join('\n');

  const html = `<div class="custom-ui-root" style="width: 100%; height: 100%; padding: ${design.canvas.padding || 16}px; background-color: ${design.canvas.backgroundColor};">
  <div class="custom-ui-canvas" style="position: relative; width: 100%; height: 100%;">
${elementsHtml}
  </div>
</div>`;

  // Generate CSS
  const baseCSS = generateBaseCSS();
  const customCSS = design.customCss || '';
  const css = customCSS ? `${baseCSS}\n\n/* Custom Styles */\n${customCSS}` : baseCSS;

  // Generate JS
  const baseJS = generateBaseJS();
  const customJS = design.customScript || '';
  const js = customJS ? `${baseJS}\n\n/* Custom Scripts */\n${customJS}` : baseJS;

  // Generate full HTML document
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(design.name)}</title>
  <style>
${css}
  </style>
</head>
<body>
${html}
<script>
${js}
</script>
</body>
</html>`;

  return {
    html,
    css,
    js,
    fullHtml,
  };
}

/**
 * Generate custom_ui tool arguments from a design
 */
export function generateCustomUIArgs(design: UIDesign): Record<string, any> {
  const code = generateCode(design);

  return {
    html: code.html,
    css: code.css,
    js: code.js,
    width: design.windowConfig.width,
    height: design.windowConfig.height,
    position: design.windowConfig.position,
    alwaysOnTop: design.windowConfig.alwaysOnTop,
    frameless: design.windowConfig.frameless,
    transparent: design.windowConfig.transparent,
    borderRadius: design.windowConfig.borderRadius,
    title: design.windowConfig.title || design.name,
    // Store the design for editing later
    _uiDesign: design,
  };
}

/**
 * Parse existing custom_ui args back into a UIDesign
 * Supports both stored design data and raw HTML/CSS preview
 */
export function parseCustomUIArgs(args: Record<string, any>): UIDesign | null {
  // If we have stored design data, use it (preferred)
  if (args._uiDesign && typeof args._uiDesign === 'object') {
    return args._uiDesign as UIDesign;
  }

  // Otherwise, create a design that stores raw HTML for preview
  // Don't try to parse into elements - just show it as-is
  if (args.html) {
    const design = createEmptyDesign('Imported Design');

    // Store raw content for iframe preview
    (design as any)._rawHtml = args.html || '';
    (design as any)._rawCss = args.css || '';
    (design as any)._rawScript = args.script || args.js || '';

    // Update canvas/window config from args
    const windowConfig = args.window || {};
    design.canvas.width = windowConfig.width || args.width || 480;
    design.canvas.height = windowConfig.height || args.height || 360;
    design.canvas.backgroundColor = windowConfig.backgroundColor || args.backgroundColor || '#ffffff';

    design.windowConfig.width = design.canvas.width;
    design.windowConfig.height = design.canvas.height;
    design.windowConfig.position = windowConfig.position || args.position || 'center';
    design.windowConfig.alwaysOnTop = windowConfig.alwaysOnTop ?? args.alwaysOnTop ?? false;
    design.windowConfig.frameless = windowConfig.frameless ?? args.frameless ?? false;
    design.windowConfig.transparent = windowConfig.transparent ?? args.transparent ?? false;
    design.windowConfig.borderRadius = windowConfig.borderRadius ?? args.borderRadius ?? 8;
    design.windowConfig.title = args.title || 'Custom UI';

    return design;
  }

  return null;
}

/**
 * Parse raw HTML/CSS into a UIDesign
 */
function parseHtmlToDesign(args: Record<string, any>): UIDesign {
  const design = createEmptyDesign('Imported Design');

  // Update canvas/window config from args
  if (args.width) {
    design.canvas.width = args.width;
    design.windowConfig.width = args.width;
  }
  if (args.height) {
    design.canvas.height = args.height;
    design.windowConfig.height = args.height;
  }
  if (args.position) design.windowConfig.position = args.position;
  if (args.alwaysOnTop !== undefined) design.windowConfig.alwaysOnTop = args.alwaysOnTop;
  if (args.frameless !== undefined) design.windowConfig.frameless = args.frameless;
  if (args.transparent !== undefined) design.windowConfig.transparent = args.transparent;
  if (args.borderRadius !== undefined) design.windowConfig.borderRadius = args.borderRadius;
  if (args.title) design.windowConfig.title = args.title;

  // Parse HTML into elements
  const html = args.html || '';
  const css = args.css || '';

  // Parse CSS into a style map
  const styleMap = parseCssToStyleMap(css);

  // Parse HTML into elements
  design.elements = parseHtmlElements(html, styleMap);

  return design;
}

/**
 * Parse CSS string into a map of class/id to styles
 */
function parseCssToStyleMap(css: string): Map<string, Record<string, string>> {
  const styleMap = new Map<string, Record<string, string>>();

  if (!css) return styleMap;

  // Simple CSS parser - matches selectors and their rules
  const ruleRegex = /([.#]?[\w-]+)\s*\{([^}]*)\}/g;
  let match;

  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const rules = match[2].trim();
    const styleObj: Record<string, string> = {};

    // Parse individual rules
    rules.split(';').forEach(rule => {
      const [prop, value] = rule.split(':').map(s => s.trim());
      if (prop && value) {
        // Convert kebab-case to camelCase
        const camelProp = prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        styleObj[camelProp] = value;
      }
    });

    styleMap.set(selector, styleObj);
  }

  return styleMap;
}

/**
 * Parse HTML string into UIElement array
 */
function parseHtmlElements(html: string, styleMap: Map<string, Record<string, string>>): UIElement[] {
  const elements: UIElement[] = [];

  // Create a temporary DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstChild as HTMLElement;

  if (!container) return elements;

  let yOffset = 0;

  // Parse each child element
  Array.from(container.children).forEach((child, index) => {
    const element = parseHtmlNode(child as HTMLElement, styleMap, { x: 0, y: yOffset }, index);
    if (element) {
      elements.push(element);
      // Stack elements vertically with some spacing
      const height = typeof element.height === 'number' ? element.height : 40;
      yOffset += height + 12;
    }
  });

  return elements;
}

/**
 * Parse a single HTML node into a UIElement
 */
function parseHtmlNode(
  node: HTMLElement,
  styleMap: Map<string, Record<string, string>>,
  position: { x: number; y: number },
  index: number
): UIElement | null {
  const tagName = node.tagName.toLowerCase();
  const id = node.id || `el_${Date.now().toString(36)}_${index}`;
  const className = node.className;

  // Get inline styles
  const inlineStyles = parseInlineStyle(node.getAttribute('style') || '');

  // Get styles from CSS classes
  let cssStyles: Record<string, string> = {};
  if (className) {
    className.split(/\s+/).forEach(cls => {
      const classStyles = styleMap.get(`.${cls}`);
      if (classStyles) {
        cssStyles = { ...cssStyles, ...classStyles };
      }
    });
  }

  // Merge styles (inline takes precedence)
  const mergedStyles = { ...cssStyles, ...inlineStyles };

  // Convert to UIElementStyle
  const style = convertToUIStyle(mergedStyles);

  // Determine element type and create UIElement
  const baseElement: Partial<UIElement> = {
    id,
    x: position.x,
    y: position.y,
    style,
    bindings: {},
  };

  // Parse based on tag type
  switch (tagName) {
    case 'button':
      return {
        ...baseElement,
        type: 'button',
        width: parseSize(mergedStyles.width) || 120,
        height: parseSize(mergedStyles.height) || 40,
        props: {
          text: node.textContent?.trim() || 'Button',
          variant: detectButtonVariant(mergedStyles),
        },
      } as UIElement;

    case 'input':
      const inputType = node.getAttribute('type') || 'text';
      if (inputType === 'checkbox') {
        return {
          ...baseElement,
          type: 'checkbox',
          width: 'auto',
          height: 'auto',
          props: {
            text: node.getAttribute('placeholder') || 'Checkbox',
          },
        } as UIElement;
      }
      if (inputType === 'range') {
        return {
          ...baseElement,
          type: 'slider',
          width: parseSize(mergedStyles.width) || 200,
          height: 24,
          props: {
            min: parseInt(node.getAttribute('min') || '0'),
            max: parseInt(node.getAttribute('max') || '100'),
            step: parseInt(node.getAttribute('step') || '1'),
          },
        } as UIElement;
      }
      return {
        ...baseElement,
        type: 'input',
        width: parseSize(mergedStyles.width) || 'full',
        height: parseSize(mergedStyles.height) || 40,
        props: {
          placeholder: node.getAttribute('placeholder') || '',
          inputType: inputType as any,
        },
      } as UIElement;

    case 'textarea':
      return {
        ...baseElement,
        type: 'textarea',
        width: parseSize(mergedStyles.width) || 'full',
        height: parseSize(mergedStyles.height) || 100,
        props: {
          placeholder: node.getAttribute('placeholder') || '',
          rows: parseInt(node.getAttribute('rows') || '4'),
        },
      } as UIElement;

    case 'select':
      const options: { value: string; label: string }[] = [];
      node.querySelectorAll('option').forEach(opt => {
        options.push({
          value: opt.getAttribute('value') || opt.textContent || '',
          label: opt.textContent || '',
        });
      });
      return {
        ...baseElement,
        type: 'select',
        width: parseSize(mergedStyles.width) || 'full',
        height: parseSize(mergedStyles.height) || 40,
        props: { options },
      } as UIElement;

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return {
        ...baseElement,
        type: 'heading',
        width: 'full',
        height: 'auto',
        props: {
          text: node.textContent?.trim() || 'Heading',
          level: parseInt(tagName[1]),
        },
      } as UIElement;

    case 'p':
    case 'span':
    case 'label':
      return {
        ...baseElement,
        type: 'text',
        width: parseSize(mergedStyles.width) || 'auto',
        height: 'auto',
        props: {
          text: node.textContent?.trim() || 'Text',
        },
      } as UIElement;

    case 'img':
      return {
        ...baseElement,
        type: 'image',
        width: parseSize(mergedStyles.width) || 200,
        height: parseSize(mergedStyles.height) || 150,
        props: {
          src: node.getAttribute('src') || '',
          alt: node.getAttribute('alt') || '',
        },
      } as UIElement;

    case 'hr':
      return {
        ...baseElement,
        type: 'divider',
        width: 'full',
        height: 1,
        props: {},
      } as UIElement;

    case 'pre':
    case 'code':
      return {
        ...baseElement,
        type: 'code-block',
        width: parseSize(mergedStyles.width) || 'full',
        height: parseSize(mergedStyles.height) || 100,
        props: {
          text: node.textContent?.trim() || '',
          language: 'javascript',
        },
      } as UIElement;

    case 'progress':
      return {
        ...baseElement,
        type: 'progress',
        width: parseSize(mergedStyles.width) || 'full',
        height: 8,
        props: {
          value: parseInt(node.getAttribute('value') || '0'),
          max: parseInt(node.getAttribute('max') || '100'),
        },
      } as UIElement;

    case 'div':
    case 'section':
    case 'article':
    case 'form':
      // Check if it's a flex/grid container
      const layout = detectLayout(mergedStyles);
      const children: UIElement[] = [];
      let childY = 0;

      Array.from(node.children).forEach((child, childIndex) => {
        const childElement = parseHtmlNode(child as HTMLElement, styleMap, { x: 0, y: childY }, childIndex);
        if (childElement) {
          children.push(childElement);
          const height = typeof childElement.height === 'number' ? childElement.height : 40;
          childY += height + 8;
        }
      });

      // If no children but has text content, treat as text
      if (children.length === 0 && node.textContent?.trim()) {
        return {
          ...baseElement,
          type: 'text',
          width: parseSize(mergedStyles.width) || 'auto',
          height: 'auto',
          props: {
            text: node.textContent.trim(),
          },
        } as UIElement;
      }

      return {
        ...baseElement,
        type: 'container',
        width: parseSize(mergedStyles.width) || 'full',
        height: parseSize(mergedStyles.height) || Math.max(childY, 100),
        layout,
        props: {},
        children,
      } as UIElement;

    default:
      // For unknown elements, try to render as container or text
      if (node.children.length > 0) {
        const children: UIElement[] = [];
        let childY = 0;
        Array.from(node.children).forEach((child, childIndex) => {
          const childElement = parseHtmlNode(child as HTMLElement, styleMap, { x: 0, y: childY }, childIndex);
          if (childElement) {
            children.push(childElement);
            const height = typeof childElement.height === 'number' ? childElement.height : 40;
            childY += height + 8;
          }
        });
        return {
          ...baseElement,
          type: 'container',
          width: parseSize(mergedStyles.width) || 'full',
          height: parseSize(mergedStyles.height) || Math.max(childY, 50),
          props: {},
          children,
        } as UIElement;
      }

      if (node.textContent?.trim()) {
        return {
          ...baseElement,
          type: 'text',
          width: 'auto',
          height: 'auto',
          props: {
            text: node.textContent.trim(),
          },
        } as UIElement;
      }

      return null;
  }
}

/**
 * Parse inline style string to object
 */
function parseInlineStyle(styleStr: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleStr) return styles;

  styleStr.split(';').forEach(rule => {
    const [prop, value] = rule.split(':').map(s => s.trim());
    if (prop && value) {
      const camelProp = prop.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      styles[camelProp] = value;
    }
  });

  return styles;
}

/**
 * Convert CSS styles to UIElementStyle
 */
function convertToUIStyle(styles: Record<string, string>): UIElementStyle {
  const uiStyle: UIElementStyle = {};

  if (styles.backgroundColor) uiStyle.backgroundColor = styles.backgroundColor;
  if (styles.color) uiStyle.textColor = styles.color;
  if (styles.fontSize) uiStyle.fontSize = parseInt(styles.fontSize);
  if (styles.fontWeight) {
    const weight = styles.fontWeight;
    if (weight === '700' || weight === 'bold') uiStyle.fontWeight = 'bold';
    else if (weight === '600') uiStyle.fontWeight = 'semibold';
    else if (weight === '500') uiStyle.fontWeight = 'medium';
    else uiStyle.fontWeight = 'normal';
  }
  if (styles.textAlign) uiStyle.textAlign = styles.textAlign as any;
  if (styles.borderRadius) uiStyle.borderRadius = parseInt(styles.borderRadius);
  if (styles.borderWidth) uiStyle.borderWidth = parseInt(styles.borderWidth);
  if (styles.borderColor) uiStyle.borderColor = styles.borderColor;
  if (styles.padding) uiStyle.padding = parseInt(styles.padding);
  if (styles.margin) uiStyle.margin = parseInt(styles.margin);
  if (styles.opacity) uiStyle.opacity = parseFloat(styles.opacity);
  if (styles.boxShadow) {
    if (styles.boxShadow.includes('25px') || styles.boxShadow.includes('20px')) uiStyle.shadow = 'xl';
    else if (styles.boxShadow.includes('15px') || styles.boxShadow.includes('10px')) uiStyle.shadow = 'lg';
    else if (styles.boxShadow.includes('6px') || styles.boxShadow.includes('4px')) uiStyle.shadow = 'md';
    else uiStyle.shadow = 'sm';
  }

  return uiStyle;
}

/**
 * Parse size value (px, %, etc.) to number or 'full'/'auto'
 */
function parseSize(value: string | undefined): number | 'full' | 'auto' | undefined {
  if (!value) return undefined;
  if (value === '100%') return 'full';
  if (value === 'auto') return 'auto';
  const num = parseInt(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Detect button variant from styles
 */
function detectButtonVariant(styles: Record<string, string>): string {
  const bg = styles.backgroundColor?.toLowerCase() || '';
  const border = styles.border || styles.borderColor || '';

  if (bg.includes('transparent') && border) return 'outline';
  if (bg.includes('transparent')) return 'ghost';
  if (bg.includes('ef4444') || bg.includes('red') || bg.includes('dc2626')) return 'danger';
  if (bg.includes('f1f5f9') || bg.includes('e2e8f0') || bg.includes('gray')) return 'secondary';
  return 'primary';
}

/**
 * Detect layout type from styles
 */
function detectLayout(styles: Record<string, string>): 'flex-row' | 'flex-col' | 'grid' | undefined {
  const display = styles.display?.toLowerCase();
  const flexDir = styles.flexDirection?.toLowerCase();

  if (display === 'grid') return 'grid';
  if (display === 'flex') {
    if (flexDir === 'column' || flexDir === 'col') return 'flex-col';
    return 'flex-row';
  }
  return undefined;
}
