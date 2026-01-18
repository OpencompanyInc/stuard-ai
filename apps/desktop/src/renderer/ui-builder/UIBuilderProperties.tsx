/**
 * UIBuilderProperties - Properties panel for selected element
 * Allows editing element properties, styles, and bindings
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Settings2, Palette, Link2, Move, Box,
  Type, Image, Eye, EyeOff, Lock, Unlock, Trash2, Copy, Layers
} from 'lucide-react';
import type { UIElement, UIElementStyle, UIElementProps, UIElementBindings, ButtonVariant } from './types';
import { COLORS, BUTTON_VARIANTS, SPACING, BORDER_RADIUS } from './utils/defaultStyles';

interface UIBuilderPropertiesProps {
  element: UIElement | null;
  onUpdate: (updates: Partial<UIElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}

// === Section Component ===

function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
          <span className="text-xs font-semibold text-slate-700">{title}</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

// === Input Components ===

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 shrink-0 text-xs text-slate-500">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 ${className}`}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
      min={min}
      max={max}
      step={step}
      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
    />
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#000000'}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
      />
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="#000000"
        className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
      />
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value as T)}
      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 bg-white"
    >
      <option value="">Select...</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function ToggleInput({
  value,
  onChange,
  label,
}: {
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-8 h-5 rounded-full transition-colors ${value ? 'bg-indigo-500' : 'bg-slate-300'
          }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'left-3.5' : 'left-0.5'
            }`}
        />
      </button>
      <span className="text-xs text-slate-600">{label}</span>
    </label>
  );
}

// === Main Component ===

export function UIBuilderProperties({
  element,
  onUpdate,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
}: UIBuilderPropertiesProps) {
  if (!element) {
    return (
      <div className="w-64 bg-white border-l border-slate-200 flex flex-col h-full">
        <div className="p-4 border-b border-slate-100">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Properties</div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-slate-400">
            <Box className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">Select an element to edit its properties</p>
          </div>
        </div>
      </div>
    );
  }

  const updateProps = (updates: Partial<UIElementProps>) => {
    onUpdate({ props: { ...element.props, ...updates } });
  };

  const updateStyle = (updates: Partial<UIElementStyle>) => {
    onUpdate({ style: { ...element.style, ...updates } });
  };

  const updateBindings = (updates: Partial<UIElementBindings>) => {
    onUpdate({ bindings: { ...element.bindings, ...updates } });
  };

  return (
    <div className="w-64 bg-white border-l border-slate-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Properties</div>
          <div className="flex items-center gap-1">
            <button
              onClick={onDuplicate}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              title="Duplicate"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
            <Box className="w-4 h-4" />
          </div>
          <div>
            <input
              type="text"
              value={element.name || element.type}
              onChange={e => onUpdate({ name: e.target.value })}
              className="w-full text-sm font-semibold text-slate-800 bg-transparent border-none p-0 focus:outline-none focus:ring-0"
            />
            <div className="text-[10px] text-slate-400 font-mono">{element.type} #{element.id.slice(-6)}</div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal">
        {/* Content Section */}
        <Section title="Content" icon={Type} defaultOpen={true}>
          {/* Text property for most components */}
          {['button', 'text', 'heading', 'badge', 'checkbox'].includes(element.type) && (
            <PropertyRow label="Text">
              <TextInput
                value={element.props.text || ''}
                onChange={v => updateProps({ text: v })}
                placeholder="Enter text..."
              />
            </PropertyRow>
          )}

          {/* Placeholder for inputs */}
          {['input', 'textarea'].includes(element.type) && (
            <PropertyRow label="Placeholder">
              <TextInput
                value={element.props.placeholder || ''}
                onChange={v => updateProps({ placeholder: v })}
              />
            </PropertyRow>
          )}

          {/* Button variant */}
          {element.type === 'button' && (
            <PropertyRow label="Variant">
              <SelectInput<ButtonVariant>
                value={element.props.variant}
                onChange={v => updateProps({ variant: v })}
                options={[
                  { value: 'primary', label: 'Primary' },
                  { value: 'secondary', label: 'Secondary' },
                  { value: 'danger', label: 'Danger' },
                  { value: 'ghost', label: 'Ghost' },
                  { value: 'outline', label: 'Outline' },
                ]}
              />
            </PropertyRow>
          )}

          {/* Image source */}
          {element.type === 'image' && (
            <>
              <PropertyRow label="Source">
                <TextInput
                  value={element.props.src || ''}
                  onChange={v => updateProps({ src: v })}
                  placeholder="URL or {{data.field}}"
                />
              </PropertyRow>
              <PropertyRow label="Alt Text">
                <TextInput
                  value={element.props.alt || ''}
                  onChange={v => updateProps({ alt: v })}
                />
              </PropertyRow>
            </>
          )}

          {/* Heading level */}
          {element.type === 'heading' && (
            <PropertyRow label="Level">
              <SelectInput
                value={String(element.props.level || 2)}
                onChange={v => updateProps({ level: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 })}
                options={[
                  { value: '1', label: 'H1 - Largest' },
                  { value: '2', label: 'H2' },
                  { value: '3', label: 'H3' },
                  { value: '4', label: 'H4' },
                  { value: '5', label: 'H5' },
                  { value: '6', label: 'H6 - Smallest' },
                ]}
              />
            </PropertyRow>
          )}

          {/* Progress value */}
          {element.type === 'progress' && (
            <PropertyRow label="Value">
              <NumberInput
                value={element.props.value}
                onChange={v => updateProps({ value: v })}
                min={0}
                max={100}
              />
            </PropertyRow>
          )}

          {/* Disabled toggle */}
          {['button', 'input', 'textarea', 'select', 'checkbox'].includes(element.type) && (
            <ToggleInput
              value={element.props.disabled}
              onChange={v => updateProps({ disabled: v })}
              label="Disabled"
            />
          )}
        </Section>

        {/* Position & Size Section */}
        <Section title="Position & Size" icon={Move} defaultOpen={true}>
          <div className="grid grid-cols-2 gap-2">
            <PropertyRow label="X">
              <NumberInput
                value={element.x}
                onChange={v => onUpdate({ x: v ?? 0 })}
              />
            </PropertyRow>
            <PropertyRow label="Y">
              <NumberInput
                value={element.y}
                onChange={v => onUpdate({ y: v ?? 0 })}
              />
            </PropertyRow>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PropertyRow label="Width">
              {typeof element.width === 'number' ? (
                <NumberInput
                  value={element.width}
                  onChange={v => onUpdate({ width: v ?? 100 })}
                  min={20}
                />
              ) : (
                <SelectInput
                  value={element.width}
                  onChange={v => onUpdate({ width: v })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'full', label: '100%' },
                  ]}
                />
              )}
            </PropertyRow>
            <PropertyRow label="Height">
              {typeof element.height === 'number' ? (
                <NumberInput
                  value={element.height}
                  onChange={v => onUpdate({ height: v ?? 40 })}
                  min={20}
                />
              ) : (
                <SelectInput
                  value={element.height}
                  onChange={v => onUpdate({ height: v })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'full', label: '100%' },
                  ]}
                />
              )}
            </PropertyRow>
          </div>
        </Section>

        {/* Style Section */}
        <Section title="Style" icon={Palette} defaultOpen={false}>
          <PropertyRow label="Background">
            <ColorInput
              value={element.style.backgroundColor}
              onChange={v => updateStyle({ backgroundColor: v })}
            />
          </PropertyRow>
          <PropertyRow label="Text Color">
            <ColorInput
              value={element.style.textColor}
              onChange={v => updateStyle({ textColor: v })}
            />
          </PropertyRow>
          <PropertyRow label="Font Size">
            <NumberInput
              value={element.style.fontSize}
              onChange={v => updateStyle({ fontSize: v })}
              min={8}
              max={72}
            />
          </PropertyRow>
          <PropertyRow label="Font Weight">
            <SelectInput
              value={element.style.fontWeight}
              onChange={v => updateStyle({ fontWeight: v })}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'medium', label: 'Medium' },
                { value: 'semibold', label: 'Semibold' },
                { value: 'bold', label: 'Bold' },
              ]}
            />
          </PropertyRow>
          <PropertyRow label="Radius">
            <NumberInput
              value={element.style.borderRadius}
              onChange={v => updateStyle({ borderRadius: v })}
              min={0}
              max={50}
            />
          </PropertyRow>
          <PropertyRow label="Border">
            <NumberInput
              value={element.style.borderWidth}
              onChange={v => updateStyle({ borderWidth: v })}
              min={0}
              max={10}
            />
          </PropertyRow>
          <PropertyRow label="Border Color">
            <ColorInput
              value={element.style.borderColor}
              onChange={v => updateStyle({ borderColor: v })}
            />
          </PropertyRow>
          <PropertyRow label="Shadow">
            <SelectInput
              value={element.style.shadow}
              onChange={v => updateStyle({ shadow: v })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'sm', label: 'Small' },
                { value: 'md', label: 'Medium' },
                { value: 'lg', label: 'Large' },
                { value: 'xl', label: 'Extra Large' },
              ]}
            />
          </PropertyRow>
        </Section>

        {/* Data Bindings Section */}
        <Section title="Data Bindings" icon={Link2} defaultOpen={false}>
          <PropertyRow label="Bind to">
            <TextInput
              value={element.bindings.dataBind || ''}
              onChange={v => updateBindings({ dataBind: v })}
              placeholder="e.g. name, items[0].title"
            />
          </PropertyRow>
          <PropertyRow label="Action">
            <TextInput
              value={element.bindings.dataAction || ''}
              onChange={v => updateBindings({ dataAction: v })}
              placeholder="e.g. submit, cancel"
            />
          </PropertyRow>
          <ToggleInput
            value={element.bindings.dataHtml}
            onChange={v => updateBindings({ dataHtml: v })}
            label="Render as HTML"
          />
        </Section>

        {/* Layer Order Section */}
        <Section title="Layer Order" icon={Layers} defaultOpen={false}>
          <div className="flex gap-2">
            <button
              onClick={onSendBackward}
              className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              Send Back
            </button>
            <button
              onClick={onBringForward}
              className="flex-1 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              Bring Forward
            </button>
          </div>
          <div className="text-[10px] text-slate-400 text-center">
            Z-Index: {element.zIndex || 0}
          </div>
        </Section>
      </div>
    </div>
  );
}
