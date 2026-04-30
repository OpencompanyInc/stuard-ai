/**
 * EnhancedUIBuilderModal - Complete UI builder with window properties and page flow
 * Integrates visual design, window configuration, and page flow management
 * 
 * Features:
 * - Visual WYSIWYG canvas with drag-and-drop components
 * - Comprehensive element property editor (data-bind, data-action, data-navigate, styling)
 * - Multi-page SPA system with page tabs and flow designer
 * - Window properties (size, background, effects, animation)
 * - Rich component palette with workflow-specific templates
 * - Code editor for HTML/CSS/JS
 * - Live preview mode
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import {
  X, Eye, Grid3x3, ZoomIn, ZoomOut, Code2, Type, Square, MousePointer2,
  Image, ToggleLeft, List, Minus, LayoutGrid, Plus, FileText, Trash2, Settings,
  Layers, GitBranch, Monitor, ChevronLeft, ChevronRight, Palette, Link2, Database,
  ArrowRight, FormInput, Table2, AlertCircle, CheckSquare, SlidersHorizontal,
  Columns, Rows, CreditCard, Navigation, BarChart3, Star, Copy, Undo2, Redo2,
  AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, PanelLeft, PanelRight,
  Smartphone, Tablet, MonitorIcon, Hash, Paintbrush, Move, Sparkles, Play,
} from 'lucide-react';
import { UIBuilderCanvas, type UIBuilderCanvasRef, type SelectedElementInfo } from './UIBuilderCanvas';
import { WindowPropertiesPanel } from './components/WindowPropertiesPanel';
import { PageFlowBuilder } from './components/PageFlowBuilder';
import type { UIWindowConfig, UIPage, PageFlowDesign } from './types';
import { generateReactComponent } from './utils/codeGenerator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rgbToHex(rgb: string | undefined): string {
  if (!rgb) return '#ffffff';
  if (rgb.startsWith('#')) return rgb;
  if (rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return rgb.startsWith('#') ? rgb : '#ffffff';
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function extractCssValue(styles: Record<string, string>, prop: string): string {
  return styles[prop] || '';
}

function parsePixelValue(val: string): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ─── Component Palette ───────────────────────────────────────────────────────

interface ComponentTemplate {
  id: string;
  name: string;
  icon: any;
  category: 'basic' | 'input' | 'layout' | 'navigation' | 'display' | 'workflow';
  html: string;
  description?: string;
}

const COMPONENT_TEMPLATES: ComponentTemplate[] = [
  // Basic
  { id: 'heading', name: 'Heading', icon: Type, category: 'basic', html: '<h2 class="text-2xl font-bold text-slate-800">Heading</h2>' },
  { id: 'text', name: 'Text', icon: Type, category: 'basic', html: '<p class="text-slate-600">Text paragraph</p>' },
  { id: 'button', name: 'Button', icon: MousePointer2, category: 'basic', html: '<button class="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors font-medium">Button</button>' },
  { id: 'image', name: 'Image', icon: Image, category: 'basic', html: '<img src="https://via.placeholder.com/300x200/e2e8f0/64748b?text=Image" class="rounded-lg w-full" alt="Placeholder" />' },
  { id: 'divider', name: 'Divider', icon: Minus, category: 'basic', html: '<hr class="border-slate-200 my-4" />' },
  { id: 'badge', name: 'Badge', icon: Star, category: 'basic', html: '<span class="px-2.5 py-1 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-full">Badge</span>' },

  // Input
  { id: 'input', name: 'Text Input', icon: FormInput, category: 'input', html: '<input type="text" data-bind="field_name" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" placeholder="Enter text..." />' },
  { id: 'input-label', name: 'Labeled Input', icon: FormInput, category: 'input', html: '<div class="space-y-1.5">\n  <label class="text-sm font-medium text-slate-700">Label</label>\n  <input type="text" data-bind="field_name" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="Enter text..." />\n</div>' },
  { id: 'textarea', name: 'Text Area', icon: FormInput, category: 'input', html: '<textarea data-bind="message" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none" rows="3" placeholder="Enter message..."></textarea>' },
  { id: 'checkbox', name: 'Checkbox', icon: CheckSquare, category: 'input', html: '<label class="flex items-center gap-2.5 cursor-pointer">\n  <input type="checkbox" data-bind="is_checked" class="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />\n  <span class="text-sm text-slate-700">Checkbox label</span>\n</label>' },
  { id: 'select', name: 'Dropdown', icon: List, category: 'input', html: '<select data-bind="selection" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200">\n  <option value="">Select...</option>\n  <option value="opt1">Option 1</option>\n  <option value="opt2">Option 2</option>\n</select>' },
  { id: 'slider', name: 'Slider', icon: SlidersHorizontal, category: 'input', html: '<div class="space-y-1.5">\n  <div class="flex justify-between text-sm"><span class="text-slate-600">Value</span><span class="font-medium text-slate-800" data-bind="slider_val">50</span></div>\n  <input type="range" data-bind="slider_val" min="0" max="100" value="50" class="w-full accent-indigo-500" />\n</div>' },
  { id: 'file-picker', name: 'File Picker', icon: FileText, category: 'input', html: '<div class="flex gap-2">\n  <input type="text" data-bind="file_path" class="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="No file selected" readonly />\n  <button data-action="pick_file" data-target="file_path" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors">Browse</button>\n</div>', description: 'Native file picker' },

  // Layout
  { id: 'container', name: 'Container', icon: Square, category: 'layout', html: '<div class="p-4 bg-slate-50 rounded-lg border border-slate-200">\n  Container content\n</div>' },
  { id: 'card', name: 'Card', icon: CreditCard, category: 'layout', html: '<div class="p-5 bg-white rounded-xl shadow-md border border-slate-100">\n  <h3 class="font-semibold text-slate-800 mb-2">Card Title</h3>\n  <p class="text-sm text-slate-600">Card content goes here.</p>\n</div>' },
  { id: 'row', name: 'Row', icon: Columns, category: 'layout', html: '<div class="flex gap-4 items-center">\n  <div class="flex-1 p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">Column 1</div>\n  <div class="flex-1 p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">Column 2</div>\n</div>' },
  { id: 'column', name: 'Stack', icon: Rows, category: 'layout', html: '<div class="flex flex-col gap-3">\n  <div class="p-3 bg-slate-50 rounded-lg text-sm text-slate-500">Item 1</div>\n  <div class="p-3 bg-slate-50 rounded-lg text-sm text-slate-500">Item 2</div>\n</div>' },
  { id: 'grid', name: 'Grid', icon: LayoutGrid, category: 'layout', html: '<div class="grid grid-cols-2 gap-3">\n  <div class="p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">1</div>\n  <div class="p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">2</div>\n  <div class="p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">3</div>\n  <div class="p-3 bg-slate-50 rounded-lg text-center text-sm text-slate-500">4</div>\n</div>' },

  // Navigation
  { id: 'submit-btn', name: 'Submit', icon: ArrowRight, category: 'navigation', html: '<button data-action="submit" class="w-full px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg font-medium hover:shadow-lg transition-all">Submit</button>', description: 'Submits form data & closes window' },
  { id: 'cancel-btn', name: 'Cancel', icon: X, category: 'navigation', html: '<button data-action="cancel" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors">Cancel</button>', description: 'Closes window' },
  { id: 'navigate-btn', name: 'Next Page', icon: ChevronRight, category: 'navigation', html: '<button data-navigate="page_name" class="px-4 py-2 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 transition-colors flex items-center gap-2">Next <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></button>', description: 'Navigate to another page' },
  { id: 'back-btn', name: 'Back', icon: ChevronLeft, category: 'navigation', html: '<button onclick="goBack()" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>Back</button>', description: 'Go to previous page' },
  { id: 'action-btn', name: 'Custom Action', icon: Play, category: 'navigation', html: '<button data-action="my_action" class="px-4 py-2 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-colors">Run Action</button>', description: 'Triggers a named action' },
  { id: 'button-row', name: 'Button Row', icon: Columns, category: 'navigation', html: '<div class="flex gap-3 justify-end pt-4 border-t border-slate-200">\n  <button data-action="cancel" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors">Cancel</button>\n  <button data-action="submit" class="px-4 py-2 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 transition-colors">Submit</button>\n</div>' },

  // Display
  { id: 'data-text', name: 'Data Text', icon: Database, category: 'display', html: '<span data-bind="variable_name" class="text-slate-800 font-medium">{{variable_name}}</span>', description: 'Shows workflow data' },
  { id: 'data-html', name: 'Rich Data', icon: Database, category: 'display', html: '<div data-bind="html_content" data-html class="prose prose-sm text-slate-700">{{{html_content}}}</div>', description: 'Renders HTML from data' },
  { id: 'progress-bar', name: 'Progress', icon: BarChart3, category: 'display', html: '<div class="space-y-1.5">\n  <div class="flex justify-between text-sm"><span class="text-slate-600">Progress</span><span class="font-medium" data-bind="progress">0%</span></div>\n  <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div class="h-full bg-indigo-500 rounded-full transition-all" style="width: 60%"></div></div>\n</div>' },
  { id: 'alert', name: 'Alert', icon: AlertCircle, category: 'display', html: '<div class="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">\n  <svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>\n  <div><div class="font-medium text-amber-800">Warning</div><div class="text-sm text-amber-700 mt-0.5">Alert message here.</div></div>\n</div>' },
  { id: 'list-display', name: 'List', icon: List, category: 'display', html: '<ul class="space-y-2">\n  <li class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50"><span class="w-2 h-2 bg-indigo-500 rounded-full shrink-0"></span><span class="text-sm text-slate-700">Item 1</span></li>\n  <li class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50"><span class="w-2 h-2 bg-indigo-500 rounded-full shrink-0"></span><span class="text-sm text-slate-700">Item 2</span></li>\n  <li class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50"><span class="w-2 h-2 bg-indigo-500 rounded-full shrink-0"></span><span class="text-sm text-slate-700">Item 3</span></li>\n</ul>' },
  { id: 'table', name: 'Table', icon: Table2, category: 'display', html: '<table class="w-full text-sm">\n  <thead><tr class="border-b border-slate-200"><th class="text-left py-2 px-3 font-semibold text-slate-700">Name</th><th class="text-left py-2 px-3 font-semibold text-slate-700">Value</th></tr></thead>\n  <tbody>\n    <tr class="border-b border-slate-100"><td class="py-2 px-3 text-slate-600">Row 1</td><td class="py-2 px-3 text-slate-800">Value</td></tr>\n    <tr class="border-b border-slate-100"><td class="py-2 px-3 text-slate-600">Row 2</td><td class="py-2 px-3 text-slate-800">Value</td></tr>\n  </tbody>\n</table>' },

  // Workflow-specific
  { id: 'form-group', name: 'Form', icon: FormInput, category: 'workflow', html: '<div class="space-y-4">\n  <div class="space-y-1.5">\n    <label class="text-sm font-medium text-slate-700">Name</label>\n    <input type="text" data-bind="name" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="Enter name" />\n  </div>\n  <div class="space-y-1.5">\n    <label class="text-sm font-medium text-slate-700">Email</label>\n    <input type="email" data-bind="email" class="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="Enter email" />\n  </div>\n  <button data-action="submit" class="w-full px-4 py-2.5 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 transition-colors">Submit</button>\n</div>', description: 'Complete form with data bindings' },
  { id: 'status-panel', name: 'Status Panel', icon: BarChart3, category: 'workflow', html: '<div class="space-y-4">\n  <div class="flex items-center gap-3">\n    <div class="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>\n    <div><div class="font-semibold text-slate-800" data-bind="status_title">Status</div><div class="text-sm text-slate-500" data-bind="status_message">Everything is running smoothly</div></div>\n  </div>\n  <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div class="h-full bg-emerald-500 rounded-full" style="width: 100%"></div></div>\n</div>', description: 'Shows workflow status' },
  { id: 'wizard-page', name: 'Wizard Page', icon: Navigation, category: 'workflow', html: '<div class="flex flex-col h-full">\n  <div class="flex-1 space-y-4">\n    <h2 class="text-xl font-bold text-slate-800">Step Title</h2>\n    <p class="text-slate-600">Instructions for this step.</p>\n    <div class="space-y-3">\n      <div class="space-y-1.5">\n        <label class="text-sm font-medium text-slate-700">Field</label>\n        <input type="text" data-bind="field" class="w-full px-3 py-2 border border-slate-300 rounded-lg" placeholder="Enter value" />\n      </div>\n    </div>\n  </div>\n  <div class="flex gap-3 justify-between pt-4 border-t border-slate-200 mt-auto">\n    <button onclick="goBack()" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200">Back</button>\n    <button data-navigate="next_step" class="px-4 py-2 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600">Continue</button>\n  </div>\n</div>', description: 'Multi-step wizard page template' },
  { id: 'node-call-btn', name: 'Node Call', icon: Sparkles, category: 'workflow', html: '<button onclick="stuard.callNode(\'Worker Node\', {}).then(r => console.log(r))" class="px-4 py-2 bg-violet-500 text-white rounded-lg font-medium hover:bg-violet-600 transition-colors flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Call Node</button>', description: 'Calls a sibling workflow node via stuard.callNode()' },
];

const PALETTE_CATEGORIES = [
  { id: 'basic', label: 'Basic', icon: Type },
  { id: 'input', label: 'Input', icon: FormInput },
  { id: 'layout', label: 'Layout', icon: LayoutGrid },
  { id: 'navigation', label: 'Actions', icon: ArrowRight },
  { id: 'display', label: 'Display', icon: BarChart3 },
  { id: 'workflow', label: 'Workflow', icon: Sparkles },
] as const;

// View modes
type ViewMode = 'design' | 'preview' | 'window' | 'flow';
type RightPanelTab = 'properties' | 'code';

interface EnhancedUIBuilderModalProps {
  html: string;
  css: string;
  js: string;
  pages?: Record<string, any>;
  startPage?: string;
  mode?: 'create' | 'update';
  outputMode?: 'html' | 'react';
  windowConfig: UIWindowConfig;
  /** Original component source — preserved on save when user makes no visual edits */
  originalComponent?: string;
  onSave: (args: { html: string; css: string; js: string; window: any; pages?: Record<string, any>; startPage?: string }) => void;
  onSaveComponent?: (args: { component: string; css: string; window: any }) => void;
  onClose: () => void;
}

// ─── Element Property Editor Sub-Component ──────────────────────────────────

function ElementPropertyEditor({
  element,
  onUpdateProperty,
  onUpdateAttribute,
  onUpdateStyle,
  pages,
}: {
  element: SelectedElementInfo;
  onUpdateProperty: (updates: { textContent?: string; className?: string; id?: string }) => void;
  onUpdateAttribute: (name: string, value: string) => void;
  onUpdateStyle: (property: string, value: string) => void;
  pages?: Record<string, any>;
}) {
  const [activeSection, setActiveSection] = useState<string>('content');

  const attrs = element.attributes || {};
  const hasDataBind = 'data-bind' in attrs;
  const hasDataAction = 'data-action' in attrs;
  const hasDataNavigate = 'data-navigate' in attrs;
  const hasDataHtml = 'data-html' in attrs || 'data-render-html' in attrs;

  // Parse current class for quick toggles
  const currentClass = element.className || '';

  const updateAttribute = (name: string, value: string) => {
    onUpdateAttribute(name, value);
  };

  const sections = [
    { id: 'content', label: 'Content', icon: Type },
    { id: 'bindings', label: 'Data & Actions', icon: Database },
    { id: 'style', label: 'Style', icon: Paintbrush },
    { id: 'layout', label: 'Layout', icon: LayoutGrid },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Element Header */}
      <div className="p-3 border-b border-slate-200 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-[11px] font-semibold rounded-full capitalize">
              {element.tagName}
            </span>
            {element.id && (
              <span className="text-[10px] font-mono text-slate-400">#{element.id}</span>
            )}
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {Math.round(element.rect.width)}×{Math.round(element.rect.height)}
          </span>
        </div>

        {/* Quick info badges */}
        <div className="flex flex-wrap gap-1">
          {hasDataBind && (
            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[9px] font-medium rounded flex items-center gap-1">
              <Database className="w-2.5 h-2.5" /> {attrs['data-bind']}
            </span>
          )}
          {hasDataAction && (
            <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-medium rounded flex items-center gap-1">
              <Play className="w-2.5 h-2.5" /> {attrs['data-action']}
            </span>
          )}
          {hasDataNavigate && (
            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[9px] font-medium rounded flex items-center gap-1">
              <ArrowRight className="w-2.5 h-2.5" /> {attrs['data-navigate']}
            </span>
          )}
          {currentClass.includes('drag') && (
            <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[9px] font-medium rounded flex items-center gap-1">
              <Move className="w-2.5 h-2.5" /> Drag Handle
            </span>
          )}
        </div>
        
        {/* Delete Button */}
        <button
          onClick={() => {
            // Send delete command to canvas
            const iframe = document.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'deleteSelected' }, '*');
            }
          }}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors mt-2"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Element
        </button>
      </div>

      {/* Section Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50/50">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-all border-b-2 ${
              activeSection === s.id
                ? 'text-indigo-700 border-indigo-500 bg-white'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            <s.icon className="w-3 h-3" />
            {s.label}
          </button>
        ))}
      </div>

      {/* Section Content */}
      <div className="flex-1 overflow-auto scrollbar-minimal p-3 space-y-4">
        {/* ─── Content Section ─── */}
        {activeSection === 'content' && (
          <>
            {/* Text Content */}
            {element.textContent && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Text Content</label>
                <input
                  type="text"
                  value={element.textContent}
                  onChange={(e) => onUpdateProperty({ textContent: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>
            )}

            {/* Element ID */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Element ID</label>
              <div className="relative">
                <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={element.id || ''}
                  onChange={(e) => onUpdateProperty({ id: e.target.value })}
                  className="w-full pl-8 pr-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                  placeholder="element-id"
                />
              </div>
            </div>

            {/* CSS Classes */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">CSS Classes</label>
              <textarea
                value={currentClass}
                onChange={(e) => onUpdateProperty({ className: e.target.value })}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none"
                rows={2}
                placeholder="tailwind classes..."
              />
              {/* Quick class toggles */}
              <div className="flex flex-wrap gap-1 mt-2">
                {['font-bold', 'text-center', 'w-full', 'rounded-lg', 'shadow-md', 'p-4', 'hidden'].map(cls => (
                  <button
                    key={cls}
                    onClick={() => {
                      const classes = currentClass.split(/\s+/).filter(Boolean);
                      const newClasses = classes.includes(cls)
                        ? classes.filter(c => c !== cls)
                        : [...classes, cls];
                      onUpdateProperty({ className: newClasses.join(' ') });
                    }}
                    className={`px-1.5 py-0.5 text-[9px] font-mono rounded transition-all ${
                      currentClass.split(/\s+/).includes(cls)
                        ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            </div>

            {/* Placeholder (for inputs) */}
            {(element.tagName === 'input' || element.tagName === 'textarea') && attrs.placeholder !== undefined && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Placeholder</label>
                <input
                  type="text"
                  value={attrs.placeholder || ''}
                  readOnly
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-500"
                  title="Edit in HTML code panel"
                />
                <p className="text-[9px] text-slate-400 mt-1">Edit placeholder in Code panel</p>
              </div>
            )}
          </>
        )}

        {/* ─── Data & Actions Section ─── */}
        {activeSection === 'bindings' && (
          <>
            {/* Data Binding */}
            <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 space-y-2">
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                <label className="text-[11px] font-semibold text-blue-800">Data Binding</label>
              </div>
              <p className="text-[10px] text-blue-600">
                Bind this element to a workflow data field. The value syncs automatically.
              </p>
              <input
                type="text"
                value={attrs['data-bind'] || ''}
                onChange={(e) => updateAttribute('data-bind', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-blue-200 rounded-lg text-blue-700"
                placeholder="field_name"
              />
              {hasDataHtml && (
                <div className="flex items-center gap-1.5 text-[10px] text-blue-600">
                  <CheckSquare className="w-3 h-3" />
                  Renders as HTML (data-html)
                </div>
              )}
              <p className="text-[9px] text-blue-500">
                Use <code className="bg-blue-100 px-1 rounded">data-bind="field"</code> in HTML to bind.
                Access via <code className="bg-blue-100 px-1 rounded">{'{{field}}'}</code> in templates.
              </p>
            </div>

            {/* Action */}
            <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100 space-y-2">
              <div className="flex items-center gap-2">
                <Play className="w-3.5 h-3.5 text-emerald-600" />
                <label className="text-[11px] font-semibold text-emerald-800">Action</label>
              </div>
              <p className="text-[10px] text-emerald-600">
                Trigger an action when clicked. Built-in: submit, cancel, close, pick_file, pick_folder.
              </p>
              <input
                type="text"
                value={attrs['data-action'] || ''}
                onChange={(e) => updateAttribute('data-action', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-emerald-200 rounded-lg text-emerald-700"
                placeholder="action_name"
              />
              <div className="flex flex-wrap gap-1">
                {['submit', 'cancel', 'close', 'pick_file', 'pick_folder'].map(a => (
                  <span key={a} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-mono rounded">
                    {a}
                  </span>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-2">
              <div className="flex items-center gap-2">
                <ArrowRight className="w-3.5 h-3.5 text-purple-600" />
                <label className="text-[11px] font-semibold text-purple-800">Page Navigation</label>
              </div>
              <p className="text-[10px] text-purple-600">
                Navigate to another page in the multi-page SPA.
              </p>
              <input
                type="text"
                value={attrs['data-navigate'] || ''}
                onChange={(e) => updateAttribute('data-navigate', e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-purple-200 rounded-lg text-purple-700"
                placeholder="page_name"
              />
              {pages && Object.keys(pages).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] text-purple-500 font-medium">Available pages:</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(pages).map(p => (
                      <span key={p} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[9px] font-mono rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[9px] text-purple-500">
                Use <code className="bg-purple-100 px-1 rounded">data-navigate="page"</code> or call <code className="bg-purple-100 px-1 rounded">navigateTo('page')</code> in JS.
              </p>
            </div>

            {/* Stuard API Reference */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
              <div className="text-[11px] font-semibold text-slate-700">Stuard API Reference</div>
              <div className="space-y-1 text-[9px] font-mono text-slate-600">
                <div><code className="bg-slate-100 px-1 rounded">stuard.submit(formData)</code> - Submit & close</div>
                <div><code className="bg-slate-100 px-1 rounded">stuard.close()</code> - Close window</div>
                <div><code className="bg-slate-100 px-1 rounded">stuard.callNode(idOrLabel, data)</code> - Call a visible sibling workflow node</div>
                <div><code className="bg-slate-100 px-1 rounded">stuard.navigate(page, data)</code> - Navigate</div>
                <div><code className="bg-slate-100 px-1 rounded">stuard.pickFile(opts)</code> - File picker</div>
                <div><code className="bg-slate-100 px-1 rounded">stuard.notify(opts)</code> - Show notification</div>
              </div>
            </div>
          </>
        )}

        {/* ─── Style Section ─── */}
        {activeSection === 'style' && (
          <>
            {/* Colors */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-2">Colors</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={rgbToHex(element.styles.backgroundColor)}
                    onChange={(e) => onUpdateStyle('backgroundColor', e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border-2 border-slate-200 shrink-0"
                  />
                  <div>
                    <div className="text-[10px] text-slate-500">Background</div>
                    <div className="text-[9px] font-mono text-slate-400">{rgbToHex(element.styles.backgroundColor)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={rgbToHex(element.styles.color)}
                    onChange={(e) => onUpdateStyle('color', e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border-2 border-slate-200 shrink-0"
                  />
                  <div>
                    <div className="text-[10px] text-slate-500">Text</div>
                    <div className="text-[9px] font-mono text-slate-400">{rgbToHex(element.styles.color)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Size */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-2">Size</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Width</label>
                  <input
                    type="number"
                    value={Math.round(element.rect.width)}
                    onChange={(e) => onUpdateStyle('width', e.target.value + 'px')}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Height</label>
                  <input
                    type="number"
                    value={Math.round(element.rect.height)}
                    onChange={(e) => onUpdateStyle('height', e.target.value + 'px')}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>
            </div>

            {/* Typography */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-2">Typography</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Font Size</label>
                  <input
                    type="number"
                    value={parsePixelValue(element.styles.fontSize)}
                    onChange={(e) => onUpdateStyle('fontSize', e.target.value + 'px')}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Font Weight</label>
                  <select
                    value={element.styles.fontWeight || '400'}
                    onChange={(e) => onUpdateStyle('fontWeight', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="300">Light</option>
                    <option value="400">Normal</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Spacing */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-2">Spacing</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Padding</label>
                  <input
                    type="text"
                    value={element.styles.padding || ''}
                    onChange={(e) => onUpdateStyle('padding', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="8px"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Margin</label>
                  <input
                    type="text"
                    value={element.styles.margin || ''}
                    onChange={(e) => onUpdateStyle('margin', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="0px"
                  />
                </div>
              </div>
            </div>

            {/* Border Radius */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">
                Border Radius: {parseInt(element.styles.borderRadius) || 0}px
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={parseInt(element.styles.borderRadius) || 0}
                onChange={(e) => onUpdateStyle('borderRadius', e.target.value + 'px')}
                className="w-full accent-indigo-500"
              />
            </div>
          </>
        )}

        {/* ─── Layout Section ─── */}
        {activeSection === 'layout' && (
          <>
            {/* Window Drag Handle */}
            <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100 mb-2">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Move className="w-3.5 h-3.5 text-amber-600" />
                  <div>
                    <div className="text-[11px] font-semibold text-amber-800">Window Drag Handle</div>
                    <div className="text-[9px] text-amber-600">Allow dragging the window via this element</div>
                  </div>
                </div>
                <div className={`w-8 h-4 rounded-full transition-colors relative ${currentClass.includes('drag') ? 'bg-amber-500' : 'bg-slate-200'}`}>
                  <input
                    type="checkbox"
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
                    checked={currentClass.includes('drag')}
                    onChange={(e) => {
                      const classes = currentClass.split(/\s+/).filter(Boolean);
                      const newClasses = e.target.checked
                        ? [...classes, 'drag']
                        : classes.filter(c => c !== 'drag');
                      onUpdateProperty({ className: newClasses.join(' ') });
                    }}
                  />
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${currentClass.includes('drag') ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </label>
            </div>

            {/* Display */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-2">Display</label>
              <div className="grid grid-cols-3 gap-1.5">
                {['block', 'flex', 'grid', 'inline', 'inline-flex', 'none'].map(d => (
                  <button
                    key={d}
                    onClick={() => onUpdateStyle('display', d)}
                    className={`px-2 py-1.5 text-[10px] font-medium rounded-md border transition-all ${
                      element.styles.display === d
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-indigo-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Flex Properties (shown when display is flex) */}
            {(element.styles.display === 'flex' || element.styles.display === 'inline-flex') && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-2">Direction</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {['row', 'column', 'row-reverse', 'column-reverse'].map(d => (
                      <button
                        key={d}
                        onClick={() => onUpdateStyle('flexDirection', d)}
                        className={`px-2 py-1.5 text-[10px] font-medium rounded-md border transition-all ${
                          element.styles.flexDirection === d
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:border-indigo-200'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-2">Align Items</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['flex-start', 'center', 'flex-end', 'stretch', 'baseline'].map(a => (
                      <button
                        key={a}
                        onClick={() => onUpdateStyle('alignItems', a)}
                        className={`px-2 py-1.5 text-[10px] font-medium rounded-md border transition-all ${
                          element.styles.alignItems === a
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:border-indigo-200'
                        }`}
                      >
                        {a.replace('flex-', '')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-2">Justify Content</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map(j => (
                      <button
                        key={j}
                        onClick={() => onUpdateStyle('justifyContent', j)}
                        className={`px-2 py-1.5 text-[10px] font-medium rounded-md border transition-all ${
                          element.styles.justifyContent === j
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:border-indigo-200'
                        }`}
                      >
                        {j.replace('flex-', '').replace('space-', '')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Gap</label>
                  <input
                    type="text"
                    value={element.styles.gap || ''}
                    onChange={(e) => onUpdateStyle('gap', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="8px"
                  />
                </div>
              </>
            )}

            {/* Position Info */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-600 mb-2">Position</div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">X:</span>
                  <span className="font-mono text-slate-700">{Math.round(element.rect.x)}px</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Y:</span>
                  <span className="font-mono text-slate-700">{Math.round(element.rect.y)}px</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function EnhancedUIBuilderModal({
  html: initialHtml,
  css: initialCss,
  js: initialJs,
  pages: initialPages,
  startPage: initialStartPage,
  mode = 'create',
  outputMode = 'html',
  windowConfig: initialWindowConfig,
  originalComponent,
  onSave,
  onSaveComponent,
  onClose,
}: EnhancedUIBuilderModalProps) {
  const canvasRef = useRef<UIBuilderCanvasRef>(null);

  // Editor state
  const [html, setHtml] = useState(initialHtml || '');
  const [css, setCss] = useState(initialCss || '');
  const [js, setJs] = useState(initialJs || '');
  const [pages, setPages] = useState<Record<string, any> | undefined>(initialPages);
  const [startPage, setStartPage] = useState<string | undefined>(initialStartPage);
  const [currentPage, setCurrentPage] = useState<string | null>(
    initialPages && Object.keys(initialPages).length > 0
      ? (initialStartPage || Object.keys(initialPages)[0])
      : null
  );

  // Enhanced window config with all new properties
  const [windowConfig, setWindowConfig] = useState<UIWindowConfig>({
    ...initialWindowConfig,
    // Defaults for any properties not provided
    width: initialWindowConfig?.width ?? 600,
    height: initialWindowConfig?.height ?? 450,
    position: initialWindowConfig?.position ?? 'center',
    alwaysOnTop: initialWindowConfig?.alwaysOnTop ?? true,
    frameless: initialWindowConfig?.frameless ?? false,
    transparent: initialWindowConfig?.transparent ?? false,
    borderRadius: initialWindowConfig?.borderRadius ?? 12,
    resizable: initialWindowConfig?.resizable ?? false,
    title: initialWindowConfig?.title ?? 'Custom UI',
    backgroundType: initialWindowConfig?.backgroundType ?? 'color',
    backgroundColor: initialWindowConfig?.backgroundColor ?? '#1a1a2e',
    gradient: initialWindowConfig?.gradient ?? undefined,
    backgroundImage: initialWindowConfig?.backgroundImage ?? undefined,
    overlay: initialWindowConfig?.overlay ?? undefined,
    shadow: initialWindowConfig?.shadow ?? {
      enabled: true,
      color: '#00000040',
      blur: 20,
      spread: 0,
      x: 0,
      y: 8,
    },
    border: initialWindowConfig?.border ?? undefined,
    animation: initialWindowConfig?.animation ?? {
      open: 'fade',
      close: 'fade',
      duration: 300,
      easing: 'ease-out',
    },
    contentPadding: initialWindowConfig?.contentPadding ?? 24,
    margin: initialWindowConfig?.margin,
  });

  const [pageFlowDesign, setPageFlowDesign] = useState<PageFlowDesign | undefined>();

  // UI State
  const [viewMode, setViewMode] = useState<ViewMode>('design');
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const previewMode = false; // Preview is now a separate tab
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('properties');
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<{ id: string; dropPoint?: { clientX: number; clientY: number } } | null>(null);
  const [paletteCategory, setPaletteCategory] = useState<string>('basic');
  const [showAddPageInput, setShowAddPageInput] = useState(false);
  const [newPageName, setNewPageName] = useState('');

  // Track changes
  const needsSyncRef = useRef(false);
  const hasMountedRef = useRef(false);
  // Track whether the user actually made visual edits (drop, property edit, code edit)
  // When false and originalComponent is set, doSave preserves the original component code
  const userMadeVisualEditsRef = useRef(false);

  // Filtered components by category
  const filteredComponents = useMemo(
    () => COMPONENT_TEMPLATES.filter(c => c.category === paletteCategory),
    [paletteCategory]
  );

  // Compute effective background CSS from windowConfig (color/gradient/image/transparent)
  const getEffectiveBackground = useCallback((): string => {
    switch (windowConfig.backgroundType) {
      case 'gradient':
        if (windowConfig.gradient?.stops?.length) {
          const sorted = [...windowConfig.gradient.stops].sort((a, b) => a.position - b.position);
          const stops = sorted.map(s => `${s.color} ${s.position}%`).join(', ');
          if (windowConfig.gradient.type === 'linear') {
            return `linear-gradient(${windowConfig.gradient.angle || 135}deg, ${stops})`;
          } else if (windowConfig.gradient.type === 'radial') {
            return `radial-gradient(circle at ${windowConfig.gradient.centerX || 50}% ${windowConfig.gradient.centerY || 50}%, ${stops})`;
          } else if (windowConfig.gradient.type === 'conic') {
            return `conic-gradient(from 0deg at ${windowConfig.gradient.centerX || 50}% ${windowConfig.gradient.centerY || 50}%, ${stops})`;
          }
        }
        return windowConfig.backgroundColor || '#1a1a2e';
      case 'image':
        if (windowConfig.backgroundImage?.url) {
          const fit = windowConfig.backgroundImage.fit || 'cover';
          const pos = windowConfig.backgroundImage.position || 'center';
          return `url(${windowConfig.backgroundImage.url}) ${pos}/${fit} no-repeat`;
        }
        return windowConfig.backgroundColor || '#1a1a2e';
      case 'transparent':
        return 'transparent';
      case 'color':
      default:
        return windowConfig.backgroundColor || '#1a1a2e';
    }
  }, [windowConfig.backgroundType, windowConfig.backgroundColor, windowConfig.gradient, windowConfig.backgroundImage]);

  // Get current page content
  const getCurrentHtml = useCallback(() => {
    if (currentPage && pages?.[currentPage]) {
      return pages[currentPage].html || '';
    }
    return html;
  }, [currentPage, pages, html]);

  const getCurrentCss = useCallback(() => {
    if (currentPage && pages?.[currentPage]) {
      return pages[currentPage].css || css;
    }
    return css;
  }, [currentPage, pages, css]);

  const getCurrentJs = useCallback(() => {
    if (currentPage && pages?.[currentPage]) {
      return pages[currentPage].js || '';
    }
    return js;
  }, [currentPage, pages, js]);

  // Transform JSX for the canvas preview (async, via main process Sucrase)
  const [transformedJs, setTransformedJs] = useState('');
  const transformPendingRef = useRef<string | null>(null);

  useEffect(() => {
    const raw = getCurrentJs();
    if (!raw) {
      setTransformedJs('');
      return;
    }
    // Debounce: only transform if raw JS hasn't changed for 300ms
    transformPendingRef.current = raw;
    const timer = setTimeout(async () => {
      if (transformPendingRef.current !== raw) return;
      try {
        const res = await window.desktopAPI?.customUiTransformJsx?.(raw);
        if (res?.ok && transformPendingRef.current === raw) {
          setTransformedJs(res.code);
        } else if (transformPendingRef.current === raw) {
          setTransformedJs(raw); // fallback to raw if transform fails
        }
      } catch {
        if (transformPendingRef.current === raw) setTransformedJs(raw);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [getCurrentJs]);

  // Transform the original component code for live preview rendering.
  // The iframe already detects `typeof App === 'function'` and calls
  // ReactDOM.render(React.createElement(App), root), so passing the
  // transformed component as JS gives us a true runtime preview with
  // .map(), style objects, animations, etc. all working.
  const [transformedComponentJs, setTransformedComponentJs] = useState('');

  useEffect(() => {
    if (!originalComponent) {
      setTransformedComponentJs('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await window.desktopAPI?.customUiTransformJsx?.(originalComponent);
        if (!cancelled && res?.ok) {
          setTransformedComponentJs(res.code);
        }
      } catch { /* ignore */ }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [originalComponent]);

  // Update content
  const updateCurrentHtml = useCallback((newHtml: string) => {
    if (currentPage && pages) {
      setPages(prev => ({
        ...prev,
        [currentPage]: { ...prev?.[currentPage], html: newHtml }
      }));
    } else {
      setHtml(newHtml);
    }
    needsSyncRef.current = true;
  }, [currentPage, pages]);

  const updateCurrentCss = useCallback((newCss: string) => {
    if (currentPage && pages) {
      setPages(prev => ({
        ...prev,
        [currentPage]: { ...prev?.[currentPage], css: newCss }
      }));
    } else {
      setCss(newCss);
    }
    needsSyncRef.current = true;
  }, [currentPage, pages]);

  const updateCurrentJs = useCallback((newJs: string) => {
    if (currentPage && pages) {
      setPages(prev => ({
        ...prev,
        [currentPage]: { ...prev?.[currentPage], js: newJs }
      }));
    } else {
      setJs(newJs);
    }
    needsSyncRef.current = true;
  }, [currentPage, pages]);

  // Page management
  const addPage = useCallback((pageName: string) => {
    if (!pageName.trim()) return;
    const id = pageName.trim().toLowerCase().replace(/\s+/g, '-');
    setPages(prev => ({
      ...prev,
      [id]: { id, name: pageName.trim(), html: '<div class="p-6">\n  <h2 class="text-xl font-bold text-slate-800 mb-4">New Page</h2>\n  <p class="text-slate-600">Page content here.</p>\n</div>', css: '', js: '' }
    }));
    if (!startPage) setStartPage(id);
    setCurrentPage(id);
    needsSyncRef.current = true;
    return id;
  }, [startPage]);

  const deletePage = useCallback((pageName: string) => {
    if (!pages) return;
    const newPages = { ...pages };
    delete newPages[pageName];

    if (Object.keys(newPages).length === 0) {
      setPages(undefined);
      setCurrentPage(null);
      setStartPage(undefined);
    } else {
      setPages(newPages);
      if (currentPage === pageName) setCurrentPage(Object.keys(newPages)[0]);
      if (startPage === pageName) setStartPage(Object.keys(newPages)[0]);
    }
    needsSyncRef.current = true;
  }, [pages, currentPage, startPage]);

  const switchPage = useCallback((pageName: string | null) => {
    setCurrentPage(pageName);
    setSelectedElement(null);
    setSelectedPath(null);
  }, []);

  // Handle element selection
  const handleSelectElement = useCallback((element: SelectedElementInfo | null) => {
    setSelectedElement(element);
    setSelectedPath(element?.path || null);
    if (element) setRightPanelTab('properties');
  }, []);

  // Update element properties
  const updateElementProperty = useCallback((updates: { textContent?: string; className?: string; id?: string }) => {
    if (selectedPath && canvasRef.current) {
      canvasRef.current.updateElement(selectedPath, updates);
      userMadeVisualEditsRef.current = true;
      needsSyncRef.current = true;
      setTimeout(() => canvasRef.current?.requestHtml(), 100);
    }
  }, [selectedPath]);

  const updateElementAttribute = useCallback((name: string, value: string) => {
    if (selectedPath && canvasRef.current && name) {
      canvasRef.current.updateElement(selectedPath, {
        attributes: {
          [name]: value,
        },
      });
      userMadeVisualEditsRef.current = true;
      needsSyncRef.current = true;
      setTimeout(() => canvasRef.current?.requestHtml(), 100);
    }
  }, [selectedPath]);

  const updateElementStyle = useCallback((property: string, value: string) => {
    if (selectedPath && canvasRef.current) {
      const currentStyle = selectedElement?.attributes?.style || '';
      const styleObj: Record<string, string> = {};
      currentStyle.split(';').forEach(s => {
        const [key, val] = s.split(':').map(x => x?.trim());
        if (key && val) styleObj[key] = val;
      });
      styleObj[camelToKebab(property)] = value;
      const newStyle = Object.entries(styleObj).map(([k, v]) => `${k}: ${v}`).join('; ');
      canvasRef.current.updateElement(selectedPath, { style: newStyle });
      userMadeVisualEditsRef.current = true;
      needsSyncRef.current = true;
      setTimeout(() => canvasRef.current?.requestHtml(), 100);
    }
  }, [selectedPath, selectedElement]);

  // Handle HTML change from canvas - don't set needsSyncRef here because:
  // 1. Initial iframe render sends HTML back, which is NOT a user edit
  // 2. User-initiated edits already set needsSyncRef via their own handlers before this fires
  const handleHtmlChange = useCallback((newHtml: string) => {
    if (currentPage && pages) {
      setPages(prev => ({ ...prev, [currentPage]: { ...prev?.[currentPage], html: newHtml } }));
    } else {
      setHtml(newHtml);
    }
  }, [currentPage, pages]);

  // Add component
  const addComponent = useCallback((componentId: string, dropPoint?: { clientX: number; clientY: number }) => {
    const template = COMPONENT_TEMPLATES.find(c => c.id === componentId);
    if (template) {
      userMadeVisualEditsRef.current = true;
      needsSyncRef.current = true;

      // If in React component mode, transition to HTML mode first, then schedule insertion
      if (transformedComponentJs) {
        setPendingAdd({ id: componentId, dropPoint });
        setTransformedComponentJs('');
        return;
      }

      if (canvasRef.current) {
        if (dropPoint) {
          canvasRef.current.insertHtmlAtPoint(template.html, dropPoint);
        } else {
          canvasRef.current.appendHtml(template.html);
        }
      } else {
        updateCurrentHtml((getCurrentHtml() || '').trim() ? getCurrentHtml() + '\n' + template.html : template.html);
      }
    }
  }, [getCurrentHtml, updateCurrentHtml, transformedComponentJs]);

  // Process pending component add after iframe refreshes from React→HTML mode transition
  useEffect(() => {
    if (!pendingAdd) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        const pending = pendingAdd;
        setPendingAdd(null);
        const template = COMPONENT_TEMPLATES.find(c => c.id === pending.id);
        if (template && canvasRef.current) {
          // Small delay to ensure iframe DOM is fully initialized
          setTimeout(() => {
            if (pending.dropPoint) {
              canvasRef.current?.insertHtmlAtPoint(template.html, pending.dropPoint);
            } else {
              canvasRef.current?.appendHtml(template.html);
            }
          }, 100);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pendingAdd]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, componentId: string) => {
    e.dataTransfer.setData('component-id', componentId);
    e.dataTransfer.effectAllowed = 'copy';
    setDraggedComponent(componentId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedComponent(null);
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDraggedComponent(null);
    const componentId = e.dataTransfer.getData('component-id');
    if (componentId) addComponent(componentId, { clientX: e.clientX, clientY: e.clientY });
  }, [addComponent]);

  // Save helper - dispatches to correct handler based on outputMode
  const doSave = useCallback(() => {
    if (outputMode === 'react' && onSaveComponent) {
      // If the user hasn't made visual edits and we have the original component,
      // preserve it to avoid destructive JSX→HTML→JSX round-trip corruption
      if (originalComponent && !userMadeVisualEditsRef.current) {
        onSaveComponent({ component: originalComponent, css, window: windowConfig });
      } else {
        const component = generateReactComponent(html, css, js);
        onSaveComponent({ component, css, window: windowConfig });
      }
    } else {
      onSave({ html, css, js, window: windowConfig, pages, startPage });
    }
  }, [outputMode, html, css, js, windowConfig, pages, startPage, onSave, onSaveComponent, originalComponent]);

  // Auto-save with debounce
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (!needsSyncRef.current) return;

    const timeout = setTimeout(() => {
      doSave();
      needsSyncRef.current = false;
    }, 300);

    return () => clearTimeout(timeout);
  }, [html, css, js, pages, startPage, windowConfig, doSave]);

  // Window config changes from the properties panel
  const handleWindowConfigChange = useCallback((updater: React.SetStateAction<UIWindowConfig>) => {
    setWindowConfig(updater);
    needsSyncRef.current = true;
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    if (needsSyncRef.current) {
      doSave();
    }
    onClose();
  }, [doSave, onClose]);

  // Zoom handlers
  const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 2));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  // Add page handler
  const handleAddPage = () => {
    if (newPageName.trim()) {
      addPage(newPageName.trim());
      setNewPageName('');
      setShowAddPageInput(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* ─── Header ─── */}
      <div className="h-12 px-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 relative z-10">
        {/* Left - Logo & Title */}
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${mode === 'update' ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
            <Palette className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {mode === 'update' ? 'Update UI' : 'UI Builder'}
            </div>
          </div>
        </div>

        {/* Center - View Mode Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <button
            onClick={() => setViewMode('design')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === 'design'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Design
          </button>
          <button
            onClick={() => setViewMode('flow')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === 'flow'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Pages
            {pages && Object.keys(pages).length > 0 && (
              <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[10px] rounded-full leading-none">
                {Object.keys(pages).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === 'preview'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            onClick={() => setViewMode('window')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              viewMode === 'window'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Window
          </button>
        </div>

        {/* Right - Actions */}
        <div className="flex items-center gap-2">
          {viewMode === 'design' && (
            <>
              <div className="flex items-center gap-0.5 bg-slate-50 rounded-md border border-slate-200 p-0.5">
                <button onClick={handleZoomOut} disabled={zoom <= 0.25} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleResetZoom} className="min-w-[44px] px-1.5 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-white rounded">
                  {Math.round(zoom * 100)}%
                </button>
                <button onClick={handleZoomIn} disabled={zoom >= 2} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={() => setShowGrid(!showGrid)}
                className={`p-1.5 rounded-md transition-all ${showGrid ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                title="Toggle Grid"
              >
                <Grid3x3 className="w-4 h-4" />
              </button>

              <div className="w-px h-5 bg-slate-200" />
            </>
          )}

          <button
            onClick={handleClose}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg shadow-sm transition-all text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            Done
          </button>

          <button onClick={handleClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Main Content Area ─── */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'design' && (
          <>
            {/* Left Panel - Component Palette */}
            {!previewMode && (
              <div className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
                {/* Category Tabs */}
                <div className="flex flex-wrap gap-1 p-2 border-b border-slate-200 bg-slate-50/50">
                  {PALETTE_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setPaletteCategory(cat.id)}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md transition-all ${
                        paletteCategory === cat.id
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                      }`}
                    >
                      <cat.icon className="w-3 h-3" />
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Component List */}
                <div className="flex-1 overflow-auto scrollbar-minimal p-2">
                  <div className="space-y-1.5">
                    {filteredComponents.map((component) => {
                      const Icon = component.icon;
                      return (
                        <button
                          key={component.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, component.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => addComponent(component.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing text-left group ${
                            draggedComponent === component.id
                              ? 'border-indigo-400 bg-indigo-50'
                              : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                          }`}
                          title={component.description}
                        >
                          <div className="w-7 h-7 rounded-md bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center shrink-0 transition-colors">
                            <Icon className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-slate-700 truncate">{component.name}</div>
                            {component.description && (
                              <div className="text-[9px] text-slate-400 truncate">{component.description}</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Canvas Area */}
            <div className={`flex-1 min-w-0 flex flex-col min-h-0 transition-all ${isDragOver ? 'ring-4 ring-indigo-300 ring-inset bg-indigo-50/30' : ''}`}>
              {/* Page Tabs */}
              {!previewMode && (
                <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border-b border-slate-200 overflow-x-auto shrink-0">
                  <button
                    onClick={() => switchPage(null)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                      currentPage === null
                        ? 'bg-white text-indigo-700 border border-indigo-200 shadow-sm'
                        : 'text-slate-600 hover:bg-white border border-transparent'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Main
                  </button>

                  {pages && Object.keys(pages).map(pageName => (
                    <div key={pageName} className="flex items-center">
                      <button
                        onClick={() => switchPage(pageName)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                          currentPage === pageName
                            ? 'bg-white text-indigo-700 border border-indigo-200 shadow-sm'
                            : 'text-slate-600 hover:bg-white border border-transparent'
                        }`}
                      >
                        <LayoutGrid className="w-3 h-3" />
                        {pageName}
                        {startPage === pageName && (
                          <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded font-bold">START</span>
                        )}
                      </button>
                      {currentPage === pageName && (
                        <button
                          onClick={() => deletePage(pageName)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add Page */}
                  {showAddPageInput ? (
                    <div className="flex items-center gap-1 ml-1">
                      <input
                        type="text"
                        value={newPageName}
                        onChange={(e) => setNewPageName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddPage();
                          if (e.key === 'Escape') { setShowAddPageInput(false); setNewPageName(''); }
                        }}
                        placeholder="page-name"
                        className="w-28 px-2 py-1 text-xs border border-indigo-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-300 font-mono"
                        autoFocus
                      />
                      <button onClick={handleAddPage} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { setShowAddPageInput(false); setNewPageName(''); }} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddPageInput(true)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors ml-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Page
                    </button>
                  )}
                </div>
              )}

              {/* Canvas */}
              <div className="flex-1 relative">
                {draggedComponent && (
                  <div className="absolute inset-0 z-20" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} />
                )}
                {isDragOver && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                    <div className="px-6 py-3 bg-indigo-500 text-white rounded-xl shadow-2xl font-semibold text-sm">
                      Drop to add component
                    </div>
                  </div>
                )}
                <UIBuilderCanvas
                  ref={canvasRef}
                  html={transformedComponentJs ? '' : getCurrentHtml()}
                  css={getCurrentCss()}
                  js={transformedComponentJs || transformedJs}
                  canvasWidth={windowConfig.width}
                  canvasHeight={windowConfig.height}
                  windowPosition={windowConfig.position}
                  customX={windowConfig.customX}
                  customY={windowConfig.customY}
                  windowMargin={windowConfig.margin}
                  backgroundColor={getEffectiveBackground()}
                  borderRadius={windowConfig.borderRadius}
                  zoom={zoom}
                  showGrid={showGrid}
                  gridSize={8}
                  previewMode={previewMode}
                  selectedPath={selectedPath}
                  onSelectElement={handleSelectElement}
                  onHoverElement={() => {}}
                  onHtmlChange={handleHtmlChange}
                />
              </div>
            </div>

            {/* Right Panel - Properties / Code */}
            {!previewMode && (
              <div className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
                {/* Right Panel Tabs */}
                <div className="flex border-b border-slate-200 shrink-0">
                  <button
                    onClick={() => setRightPanelTab('properties')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all border-b-2 ${
                      rightPanelTab === 'properties'
                        ? 'text-indigo-700 border-indigo-500'
                        : 'text-slate-500 border-transparent hover:text-slate-700'
                    }`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Properties
                  </button>
                  <button
                    onClick={() => setRightPanelTab('code')}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all border-b-2 ${
                      rightPanelTab === 'code'
                        ? 'text-indigo-700 border-indigo-500'
                        : 'text-slate-500 border-transparent hover:text-slate-700'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Code
                  </button>
                </div>

                {/* Properties Panel */}
                {rightPanelTab === 'properties' && (
                  selectedElement ? (
                    <ElementPropertyEditor
                      element={selectedElement}
                      onUpdateProperty={updateElementProperty}
                      onUpdateAttribute={updateElementAttribute}
                      onUpdateStyle={updateElementStyle}
                      pages={pages}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-6">
                      <div className="text-center text-slate-400">
                        <MousePointer2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                        <div className="text-sm font-medium mb-1">Select an element</div>
                        <div className="text-xs">Click any element on the canvas to edit its properties</div>
                      </div>
                    </div>
                  )
                )}

                {/* Code Panel */}
                {rightPanelTab === 'code' && (
                  <div className="flex-1 overflow-auto scrollbar-minimal p-3 space-y-4">
                    {currentPage && (
                      <div className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                        <LayoutGrid className="w-3 h-3" />
                        Editing: {currentPage}
                      </div>
                    )}

                    {outputMode === 'react' ? (
                      <>
                        <div className="text-[10px] text-slate-400 bg-slate-50 px-2.5 py-1.5 rounded-lg">
                          Generated React component preview. Edit elements on the canvas — code updates on save.
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">React Component</label>
                          <textarea
                            value={generateReactComponent(getCurrentHtml(), getCurrentCss(), getCurrentJs())}
                            readOnly
                            className="w-full h-72 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none text-slate-700"
                            spellCheck={false}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">HTML (editable)</label>
                          <textarea
                            value={getCurrentHtml()}
                            onChange={(e) => { userMadeVisualEditsRef.current = true; updateCurrentHtml(e.target.value); }}
                            className="w-full h-32 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                            spellCheck={false}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">CSS</label>
                          <textarea
                            value={getCurrentCss()}
                            onChange={(e) => updateCurrentCss(e.target.value)}
                            className="w-full h-20 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                            spellCheck={false}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">HTML</label>
                          <textarea
                            value={getCurrentHtml()}
                            onChange={(e) => updateCurrentHtml(e.target.value)}
                            className="w-full h-40 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                            spellCheck={false}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">CSS</label>
                          <textarea
                            value={getCurrentCss()}
                            onChange={(e) => updateCurrentCss(e.target.value)}
                            className="w-full h-28 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                            spellCheck={false}
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">JavaScript</label>
                          <textarea
                            value={getCurrentJs()}
                            onChange={(e) => updateCurrentJs(e.target.value)}
                            className="w-full h-28 px-2.5 py-2 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                            spellCheck={false}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {viewMode === 'preview' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview Toolbar */}
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-0.5 bg-white rounded-md border border-slate-200 p-0.5">
                <button onClick={handleZoomOut} disabled={zoom <= 0.25} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded disabled:opacity-40">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button onClick={handleResetZoom} className="min-w-[44px] px-1.5 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-slate-50 rounded">
                  {Math.round(zoom * 100)}%
                </button>
                <button onClick={handleZoomIn} disabled={zoom >= 2} className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded disabled:opacity-40">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Runtime Preview</span>
            </div>
            {/* Live Preview Canvas */}
            <div className="flex-1 relative bg-slate-100">
              <UIBuilderCanvas
                ref={canvasRef}
                html={transformedComponentJs ? '' : getCurrentHtml()}
                css={getCurrentCss()}
                js={transformedComponentJs || transformedJs}
                canvasWidth={windowConfig.width}
                canvasHeight={windowConfig.height}
                windowPosition={windowConfig.position}
                customX={windowConfig.customX}
                customY={windowConfig.customY}
                windowMargin={windowConfig.margin}
                backgroundColor={getEffectiveBackground()}
                borderRadius={windowConfig.borderRadius}
                zoom={zoom}
                showGrid={false}
                gridSize={8}
                previewMode={true}
                selectedPath={null}
                onSelectElement={() => {}}
                onHoverElement={() => {}}
              />
            </div>
          </div>
        )}

        {viewMode === 'window' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 p-6 overflow-auto scrollbar-minimal bg-slate-50">
              <div className="max-w-2xl mx-auto">
                <WindowPropertiesPanel config={windowConfig} onChange={handleWindowConfigChange} />
              </div>
            </div>
          </div>
        )}

        {viewMode === 'flow' && (
          <div className="flex-1 overflow-hidden">
            <PageFlowBuilder
              pages={pages || {}}
              startPage={startPage || ''}
              flowDesign={pageFlowDesign}
              onPagesChange={(newPages, newStartPage) => {
                setPages(newPages);
                setStartPage(newStartPage);
                needsSyncRef.current = true;
              }}
              onFlowDesignChange={setPageFlowDesign}
              onEditPage={(pageId) => {
                setCurrentPage(pageId);
                setViewMode('design');
              }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
