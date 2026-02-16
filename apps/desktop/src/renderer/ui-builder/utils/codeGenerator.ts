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
// Custom UI Runtime — uses stuard API when available (runtime), falls back to console (preview)
(function() {
  const hasStuardApi = typeof window.stuard !== 'undefined';
  const formData = window.initialData ? { ...window.initialData } : {};

  // Collect form data from data-bind elements
  function collectFormData() {
    const data = { ...formData };
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

  // Initialize data bindings
  document.querySelectorAll('[data-bind]').forEach(el => {
    const key = el.getAttribute('data-bind');
    const val = formData[key];
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.type === 'checkbox') {
        el.checked = !!val;
        el.addEventListener('change', (e) => { formData[key] = e.target.checked; });
      } else {
        if (val !== undefined && val !== '') el.value = val;
        el.addEventListener('input', (e) => { formData[key] = e.target.value; });
      }
    } else if (val !== undefined) {
      if (el.hasAttribute('data-html')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    }
  });

  // Handle data-action buttons
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async function() {
      const action = this.getAttribute('data-action');
      const data = collectFormData();

      if (hasStuardApi) {
        if (action === 'submit') {
          window.stuard.submit(data);
        } else if (action === 'close' || action === 'cancel') {
          window.stuard.close(data);
        } else {
          window.stuard.action(action, data);
        }
      } else {
        console.log('[Preview] Action:', action, 'Data:', data);
      }
    });
  });

  // Enter key in inputs triggers submit
  document.querySelectorAll('input[data-bind]').forEach(el => {
    el.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const data = collectFormData();
        if (hasStuardApi) {
          window.stuard.submit(data);
        }
      }
    });
  });

  // Listen for data updates from workflow
  if (hasStuardApi) {
    window.stuard.onDataUpdate((newData) => {
      Object.assign(formData, newData);
      Object.entries(newData).forEach(([key, value]) => {
        document.querySelectorAll('[data-bind="' + key + '"]').forEach(el => {
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
    });
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

  // Generate full HTML document — matches runtime structure exactly
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html {
      background: ${design.canvas.backgroundColor || 'transparent'};
      -webkit-font-smoothing: antialiased;
      height: 100%;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${design.canvas.backgroundColor || 'transparent'};
      color: #1e293b;
      height: 100%;
      font-size: 14px;
      line-height: 1.5;
    }
    .stuard-root {
      height: 100%;
    }
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
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-ghost { background: transparent; color: #475569; }
    .btn-ghost:hover { background: #f1f5f9; color: #1e293b; }
    input[type="text"], input[type="email"], input[type="password"],
    input[type="number"], input[type="url"], input[type="tel"],
    textarea, select {
      width: 100%; padding: 8px 12px; font-size: 14px;
      border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; color: #1e293b;
      outline: none;
    }
    input:focus, textarea:focus, select:focus {
      border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
    }
    .card {
      background: white; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #475569; }
    .drag { -webkit-app-region: drag; }
    .no-drag { -webkit-app-region: no-drag; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.2); border-radius: 3px; }
${css}
  </style>
</head>
<body>
  <div class="stuard-root">${html}</div>
<script>
  window.initialData = {};
  window.stuard = {
    close: () => {}, submit: () => {}, action: () => {},
    emit: () => {}, on: () => () => {}, onDataUpdate: () => () => {},
    callTool: async () => ({ ok: false }), getData: async () => ({}),
    getWindowId: async () => 'preview', getFlowId: async () => null,
  };
${js}
<\/script>
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
  const wc = design.windowConfig;

  // Auto-wrap visual editor HTML into a Preact component since legacy mode is removed.
  // The runtime only supports Preact component mode now.
  const escapedHtml = code.html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const componentCode = `function App() {
  const [formData, setFormData] = useState({ ...initialData });
  return html\`<div dangerouslySetInnerHTML=\${{ __html: \`${escapedHtml}\` }} />\`;
}`;

  return {
    component: componentCode,
    css: code.css,
    title: wc.title || design.name,
    window: {
      width: wc.width,
      height: wc.height,
      position: wc.position,
      customX: wc.customX,
      customY: wc.customY,
      alwaysOnTop: wc.alwaysOnTop,
      frameless: wc.frameless !== false,
      transparent: wc.transparent,
      borderRadius: wc.borderRadius,
      resizable: wc.resizable,
      draggable: wc.draggable,
      backgroundColor: wc.backgroundColor || 'transparent',
      backgroundType: wc.backgroundType || 'color',
      gradient: wc.gradient,
      backgroundImage: wc.backgroundImage,
      shadow: wc.shadow,
      border: wc.border,
      animation: wc.animation,
      contentPadding: wc.contentPadding,
    },
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

// ═══════════════════════════════════════════════════════════════════════════════
// PREACT COMPONENT GENERATOR
// Converts visual builder HTML/CSS/JS into a Preact+htm component string
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert HTML string to htm template literal content.
 * Transforms data-bind, data-action, onclick, etc. into Preact equivalents.
 */
function htmlToHtm(html: string): string {
  if (!html) return '';

  let result = html;

  // Convert data-action="submit" buttons to onClick=${() => stuard.submit(formData)}
  result = result.replace(
    /<button([^>]*?)data-action="submit"([^>]*?)>([\s\S]*?)<\/button>/gi,
    (_, before, after, content) => {
      const cleanBefore = before.replace(/onclick="[^"]*"/gi, '');
      const cleanAfter = after.replace(/onclick="[^"]*"/gi, '');
      return `<button${cleanBefore}${cleanAfter} onClick=\${() => stuard.submit(formData)}>${content}</button>`;
    }
  );

  // Convert data-action="cancel" buttons to onClick=${() => stuard.close()}
  result = result.replace(
    /<button([^>]*?)data-action="cancel"([^>]*?)>([\s\S]*?)<\/button>/gi,
    (_, before, after, content) => {
      const cleanBefore = before.replace(/onclick="[^"]*"/gi, '');
      const cleanAfter = after.replace(/onclick="[^"]*"/gi, '');
      return `<button${cleanBefore}${cleanAfter} onClick=\${() => stuard.close()}>${content}</button>`;
    }
  );

  // Convert data-action="name" buttons to onClick handler
  result = result.replace(
    /<button([^>]*?)data-action="([^"]+)"([^>]*?)>([\s\S]*?)<\/button>/gi,
    (_, before, action, after, content) => {
      const cleanBefore = before.replace(/onclick="[^"]*"/gi, '');
      const cleanAfter = after.replace(/onclick="[^"]*"/gi, '');
      return `<button${cleanBefore}${cleanAfter} onClick=\${() => stuard.submit({ action: '${action}', ...formData })}>${content}</button>`;
    }
  );

  // Convert data-navigate="page" to onClick
  result = result.replace(
    /data-navigate="([^"]+)"/gi,
    (_, page) => `onClick=\${() => setPage('${page}')}`
  );

  // Convert data-bind inputs to controlled Preact inputs
  // Input elements: value=${formData.field} onInput=${e => setFormData({...formData, field: e.target.value})}
  result = result.replace(
    /<input([^>]*?)data-bind="([^"]+)"([^>]*?)\/?>/gi,
    (_, before, field, after) => {
      const isCheckbox = /type="checkbox"/i.test(before + after);
      if (isCheckbox) {
        return `<input${before}${after} checked=\${formData.${field} || false} onChange=\${e => setFormData({...formData, ${field}: e.target.checked})} />`;
      }
      return `<input${before}${after} value=\${formData.${field} || ''} onInput=\${e => setFormData({...formData, ${field}: e.target.value})} />`;
    }
  );

  // Convert data-bind textarea
  result = result.replace(
    /<textarea([^>]*?)data-bind="([^"]+)"([^>]*?)>([\s\S]*?)<\/textarea>/gi,
    (_, before, field, after, _content) => {
      return `<textarea${before}${after} value=\${formData.${field} || ''} onInput=\${e => setFormData({...formData, ${field}: e.target.value})}></textarea>`;
    }
  );

  // Convert data-bind select
  result = result.replace(
    /<select([^>]*?)data-bind="([^"]+)"([^>]*?)>/gi,
    (_, before, field, after) => {
      return `<select${before}${after} value=\${formData.${field} || ''} onChange=\${e => setFormData({...formData, ${field}: e.target.value})}>`;
    }
  );

  // Convert data-bind on display elements to ${formData.field}
  result = result.replace(
    /<(span|div|p|h[1-6])([^>]*?)data-bind="([^"]+)"([^>]*?)>([\s\S]*?)<\/\1>/gi,
    (_, tag, before, field, after, _content) => {
      return `<${tag}${before}${after}>\${formData.${field} || ''}</${tag}>`;
    }
  );

  // Convert remaining onclick="..." to onClick=${() => { ... }}
  result = result.replace(
    /onclick="([^"]+)"/gi,
    (_, code) => {
      // Handle stuard.callTool calls
      const decoded = code.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return `onClick=\${() => { ${decoded} }}`;
    }
  );

  // Clean up leftover data-bind, data-action, data-html attributes
  result = result.replace(/\s*data-bind="[^"]*"/gi, '');
  result = result.replace(/\s*data-action="[^"]*"/gi, '');
  result = result.replace(/\s*data-html(?:="[^"]*")?/gi, '');
  result = result.replace(/\s*data-element-id="[^"]*"/gi, '');

  return result;
}

/**
 * Extract HTML template and JS logic from a Preact component string.
 * Returns { html, js } where html is the content inside html`...` and
 * js is the component logic (state hooks, effects, etc.) outside the return.
 *
 * Also converts Preact-specific patterns back to HTML data attributes:
 *   onClick=${() => stuard.submit(formData)} → data-action="submit"
 *   onClick=${() => stuard.close()} → data-action="cancel"
 *   value=${formData.field} onInput=${...} → data-bind="field"
 */
export function extractHtmlFromPreactComponent(component: string): { html: string; js: string } {
  if (!component || !component.trim()) return { html: '', js: '' };

  // Some saved specs contain double-escaped component text (literal "\\n", "\\t", "\\\"").
  // Runtime already normalizes this before executing the component; do the same here so
  // UI Builder preview/parsing behaves like runtime rendering.
  let normalizedComponent = component;
  const hasLiteralEscapes =
    normalizedComponent.includes('\\n') ||
    normalizedComponent.includes('\\t') ||
    normalizedComponent.includes('\\"');

  if (hasLiteralEscapes) {
    const hasLiteralBackslashes = normalizedComponent.includes('\\\\');
    if (hasLiteralBackslashes) {
      normalizedComponent = normalizedComponent.replace(/\\\\/g, '\x00BACKSLASH\x00');
    }
    normalizedComponent = normalizedComponent
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
    if (hasLiteralBackslashes) {
      normalizedComponent = normalizedComponent.replace(/\x00BACKSLASH\x00/g, '\\');
    }
  }

  // Find the html`...` template literal
  // Handle both:  return html`...`;  and  return html`...`
  const templateMatch = normalizedComponent.match(/return\s+html\s*`([\s\S]*?)`\s*;?\s*\}?\s*$/m);
  if (!templateMatch) {
    // Try a broader match - find any html`...` in the component
    const broaderMatch = normalizedComponent.match(/html\s*`([\s\S]*?)`/);
    if (!broaderMatch) return { html: '', js: '' };
    return { html: cleanHtmToHtml(broaderMatch[1].trim()), js: '' };
  }

  const rawTemplate = templateMatch[1].trim();

  // Extract JS logic: everything between function App() { and the return statement
  const jsMatch = normalizedComponent.match(/function\s+App\s*\(\)\s*\{([\s\S]*?)(?=\n\s*return\s+html)/);
  const jsLogic = jsMatch ? jsMatch[1].trim() : '';

  return { html: cleanHtmToHtml(rawTemplate), js: jsLogic };
}

/**
 * Convert HTM template expressions back to editable HTML with data attributes.
 * Reverses the htmlToHtm() transformation.
 */
function cleanHtmToHtml(htm: string): string {
  if (!htm) return '';
  let result = htm;

  // Convert onClick=${() => stuard.submit(formData)} → data-action="submit"
  result = result.replace(/onClick=\$\{[^}]*stuard\.submit\s*\(\s*formData\s*\)[^}]*\}/gi, 'data-action="submit"');

  // Convert onClick=${() => stuard.close()} → data-action="cancel"
  result = result.replace(/onClick=\$\{[^}]*stuard\.close\s*\(\)[^}]*\}/gi, 'data-action="cancel"');

  // Convert onClick=${() => stuard.submit({ action: 'name', ...formData })} → data-action="name"
  result = result.replace(/onClick=\$\{[^}]*stuard\.submit\s*\(\s*\{\s*action:\s*'([^']+)'[^}]*\}\s*\)[^}]*\}/gi,
    (_, action) => `data-action="${action}"`);

  // Convert onClick=${() => setPage('name')} → data-navigate="name"
  result = result.replace(/onClick=\$\{[^}]*setPage\s*\(\s*'([^']+)'\s*\)[^}]*\}/gi,
    (_, page) => `data-navigate="${page}"`);

  // Convert controlled inputs back to data-bind:
  // value=${formData.field} onInput=${e => setFormData({...formData, field: e.target.value})}
  // → data-bind="field"
  result = result.replace(
    /value=\$\{formData\.(\w+)[^}]*\}\s*onInput=\$\{[^}]*\}/gi,
    (_, field) => `data-bind="${field}"`
  );

  // Convert checked=${formData.field} onChange=${...} → data-bind="field"
  result = result.replace(
    /checked=\$\{formData\.(\w+)[^}]*\}\s*onChange=\$\{[^}]*\}/gi,
    (_, field) => `data-bind="${field}"`
  );

  // Convert ${formData.field || ''} display bindings → data-bind text
  result = result.replace(
    /\$\{formData\.(\w+)\s*\|\|\s*''\}/gi,
    (_, field) => `<span data-bind="${field}">{{${field}}}</span>`
  );

  // Convert onClick=${() => { ... }} → onclick="..."
  result = result.replace(
    /onClick=\$\{\(\)\s*=>\s*\{\s*([\s\S]*?)\s*\}\s*\}/gi,
    (_, code) => `onclick="${code.replace(/"/g, '&quot;')}"`
  );

  // Clean up any remaining ${...} expressions by removing them (they can't be represented in static HTML)
  result = result.replace(/\$\{[^}]*\}/g, '');

  // Trim each line's leading whitespace (htm template is often indented)
  result = result.split('\n').map(line => {
    // Remove up to 4 leading spaces (typical template indentation)
    return line.replace(/^    /, '');
  }).join('\n').trim();

  return result;
}

/**
 * Generate a Preact+htm component string from visual builder HTML/CSS/JS.
 * This is the main entry point for converting builder output to component mode.
 */
export function generatePreactComponent(html: string, css: string, js: string): string {
  const htmContent = htmlToHtm(html);
  const indent = '  ';

  // Check if js already contains component logic (from extracted component round-trip)
  const jsHasFormData = js && /\bformData\b/.test(js) && /\bsetFormData\b/.test(js);
  const jsHasSetPage = js && /\bsetPage\b/.test(js);

  // Extract data-bind field names to generate initial formData state
  const bindFields = new Set<string>();
  const bindRegex = /data-bind="([^"]+)"/gi;
  let match;
  while ((match = bindRegex.exec(html)) !== null) {
    bindFields.add(match[1]);
  }

  // Build the component
  const lines: string[] = [];
  lines.push('function App() {');

  // If js already contains extracted component logic, use it directly
  if (jsHasFormData) {
    // Preserved logic from existing component - include as-is
    for (const line of js.split('\n')) {
      if (line.trim()) lines.push(`${indent}${line}`);
    }
  } else {
    // Generate fresh state for form data
    if (bindFields.size > 0) {
      const defaults = Array.from(bindFields).map(f => `${f}: initialData.${f} || ''`).join(', ');
      lines.push(`${indent}const [formData, setFormData] = useState({ ${defaults} });`);
    } else {
      lines.push(`${indent}const [formData, setFormData] = useState({ ...initialData });`);
    }

    // Add page navigation state if we detect data-navigate
    if (/data-navigate/i.test(html) && !jsHasSetPage) {
      lines.push(`${indent}const [page, setPage] = useState('main');`);
    }

    // Add any custom JS as useEffect or inline
    if (js && js.trim()) {
      lines.push('');
      lines.push(`${indent}// Custom logic`);
      if (/document\.|addEventListener|querySelector|setInterval|setTimeout/i.test(js)) {
        lines.push(`${indent}useEffect(() => {`);
        for (const line of js.split('\n')) {
          if (line.trim()) lines.push(`${indent}${indent}${line}`);
        }
        lines.push(`${indent}}, []);`);
      } else {
        for (const line of js.split('\n')) {
          if (line.trim()) lines.push(`${indent}${line}`);
        }
      }
    }
  }

  lines.push('');
  lines.push(`${indent}return html\``);

  // Indent the htm content
  for (const line of htmContent.split('\n')) {
    lines.push(`${indent}${indent}${line}`);
  }

  lines.push(`${indent}\`;`);
  lines.push('}');

  return lines.join('\n');
}
