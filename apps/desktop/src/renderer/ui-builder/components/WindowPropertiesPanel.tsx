/**
 * WindowPropertiesPanel - Visual configuration for Custom UI window properties
 * Supports: size, position, background (color/gradient/image), shadow, border, animation
 */

import React, { useState, useCallback } from 'react';
import {
  Maximize,
  Minimize,
  Move,
  Layers,
  Image as ImageIcon,
  Type,
  Palette,
  Box,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  Grid3x3,
  Monitor,
  Upload,
  Link,
  Crosshair,
} from 'lucide-react';
import type { UIWindowConfig } from '../types';

interface WindowPropertiesPanelProps {
  config: UIWindowConfig;
  onChange: (config: UIWindowConfig) => void;
}

type Section = 'size' | 'position' | 'appearance' | 'background' | 'effects' | 'animation';

const PRESET_SIZES = [
  { name: 'Compact', width: 320, height: 240, icon: Minimize },
  { name: 'Small', width: 400, height: 300, icon: Minimize },
  { name: 'Medium', width: 600, height: 450, icon: Maximize },
  { name: 'Large', width: 800, height: 600, icon: Maximize },
  { name: 'XL', width: 1024, height: 768, icon: Maximize },
  { name: 'Fullscreen', width: -1, height: -1, icon: Monitor }, // -1 means fullscreen
];

const POSITIONS = [
  { value: 'center', label: 'Center' },
  { value: 'topleft', label: 'Top Left' },
  { value: 'topright', label: 'Top Right' },
  { value: 'bottomleft', label: 'Bottom Left' },
  { value: 'bottomcenter', label: 'Bottom Center' },
  { value: 'bottomright', label: 'Bottom Right' },
  { value: 'cursor', label: 'Near Cursor' },
  { value: 'custom', label: 'Custom' },
];

// Map position values to approximate percentage coordinates on a screen preview
const POSITION_COORDS: Record<string, { x: number; y: number }> = {
  center: { x: 50, y: 50 },
  topleft: { x: 15, y: 15 },
  topright: { x: 85, y: 15 },
  bottomleft: { x: 15, y: 85 },
  bottomcenter: { x: 50, y: 85 },
  bottomright: { x: 85, y: 85 },
  cursor: { x: 65, y: 40 },
  custom: { x: 50, y: 50 },
};

const GRADIENT_PRESETS = [
  {
    name: 'Ocean',
    gradient: {
      type: 'linear' as const,
      angle: 135,
      stops: [
        { color: '#667eea', position: 0 },
        { color: '#764ba2', position: 100 },
      ],
    },
  },
  {
    name: 'Sunset',
    gradient: {
      type: 'linear' as const,
      angle: 135,
      stops: [
        { color: '#f093fb', position: 0 },
        { color: '#f5576c', position: 100 },
      ],
    },
  },
  {
    name: 'Midnight',
    gradient: {
      type: 'linear' as const,
      angle: 180,
      stops: [
        { color: '#0f2027', position: 0 },
        { color: '#203a43', position: 50 },
        { color: '#2c5364', position: 100 },
      ],
    },
  },
  {
    name: 'Emerald',
    gradient: {
      type: 'linear' as const,
      angle: 135,
      stops: [
        { color: '#11998e', position: 0 },
        { color: '#38ef7d', position: 100 },
      ],
    },
  },
  {
    name: 'Royal',
    gradient: {
      type: 'radial' as const,
      stops: [
        { color: '#1a1a2e', position: 0 },
        { color: '#16213e', position: 50 },
        { color: '#0f3460', position: 100 },
      ],
    },
  },
];

export function WindowPropertiesPanel({ config, onChange }: WindowPropertiesPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(
    new Set(['size', 'background'])
  );

  const toggleSection = (section: Section) => {
    const newSet = new Set(expandedSections);
    if (newSet.has(section)) {
      newSet.delete(section);
    } else {
      newSet.add(section);
    }
    setExpandedSections(newSet);
  };

  const updateConfig = useCallback(<K extends keyof UIWindowConfig>(
    key: K,
    value: UIWindowConfig[K]
  ) => {
    onChange({ ...config, [key]: value });
  }, [config, onChange]);

  const updateNested = useCallback(<K extends keyof UIWindowConfig>(
    parentKey: K,
    childKey: string,
    value: any
  ) => {
    const parent = config[parentKey] as Record<string, any> || {};
    onChange({
      ...config,
      [parentKey]: { ...parent, [childKey]: value },
    });
  }, [config, onChange]);

  // Generate gradient CSS
  const generateGradientCSS = (gradient: UIWindowConfig['gradient']) => {
    if (!gradient || !gradient.stops?.length) return '';

    const sortedStops = [...gradient.stops].sort((a, b) => a.position - b.position);
    const stopString = sortedStops.map(s => `${s.color} ${s.position}%`).join(', ');

    switch (gradient.type) {
      case 'linear':
        return `linear-gradient(${gradient.angle || 135}deg, ${stopString})`;
      case 'radial':
        return `radial-gradient(circle at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString})`;
      case 'conic':
        return `conic-gradient(from 0deg at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString})`;
      default:
        return '';
    }
  };

  // Preview background style
  const getPreviewBackground = (): React.CSSProperties => {
    switch (config.backgroundType) {
      case 'gradient':
        if (config.gradient) {
          return { background: generateGradientCSS(config.gradient) };
        }
        break;
      case 'image':
        if (config.backgroundImage?.url) {
          return {
            backgroundImage: `url(${config.backgroundImage.url})`,
            backgroundSize: config.backgroundImage.fit,
            backgroundPosition: config.backgroundImage.position,
            backgroundRepeat: config.backgroundImage.repeat,
            opacity: config.backgroundImage.opacity ?? 1,
          };
        }
        break;
      case 'translucent': {
        const tColor = config.translucent?.color || '#1a1a2e';
        const tOpacity = config.translucent?.opacity ?? 0.7;
        const r = parseInt(tColor.slice(1, 3), 16) || 0;
        const g = parseInt(tColor.slice(3, 5), 16) || 0;
        const b = parseInt(tColor.slice(5, 7), 16) || 0;
        return {
          backgroundColor: `rgba(${r}, ${g}, ${b}, ${tOpacity})`,
          backdropFilter: `blur(${config.translucent?.blur ?? 12}px)`,
        } as React.CSSProperties;
      }
      case 'transparent':
        return {
          backgroundImage: 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%)',
          backgroundSize: '16px 16px',
        };
      case 'color':
      default:
        if (config.backgroundColor) {
          return { backgroundColor: config.backgroundColor };
        }
    }
    return { backgroundColor: '#1a1a2e' };
  };

  const SectionHeader = ({ section, icon: Icon, title }: { section: Section; icon: any; title: string }) => (
    <button
      onClick={() => toggleSection(section)}
      className="flex items-center justify-between w-full p-3 hover:bg-slate-50 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
          <Icon className="w-4 h-4 text-indigo-600" />
        </div>
        <span className="font-medium text-slate-700">{title}</span>
      </div>
      {expandedSections.has(section) ? (
        <ChevronDown className="w-4 h-4 text-slate-400" />
      ) : (
        <ChevronRight className="w-4 h-4 text-slate-400" />
      )}
    </button>
  );

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Preview Card */}
      <div className="p-4 border-b border-slate-200">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Preview</div>
        <div
          className="w-full h-32 rounded-lg shadow-inner flex items-center justify-center text-white font-medium"
          style={{
            ...getPreviewBackground(),
            borderRadius: config.borderRadius ? `${config.borderRadius}px` : '8px',
            boxShadow: config.shadow?.enabled
              ? `${config.shadow.x}px ${config.shadow.y}px ${config.shadow.blur}px ${config.shadow.spread}px ${config.shadow.color}`
              : undefined,
            border: config.border?.enabled
              ? `${config.border.width}px ${config.border.style} ${config.border.color}`
              : undefined,
          }}
        >
          {config.title || 'Window Preview'}
        </div>
      </div>

      <div className="p-2 space-y-1 max-h-[600px] overflow-auto">
        {/* Size Section */}
        <div>
          <SectionHeader section="size" icon={Maximize} title="Size & Dimensions" />
          {expandedSections.has('size') && (
            <div className="px-4 pb-4 space-y-4">
              {/* Preset Sizes */}
              <div className="grid grid-cols-3 gap-2">
                {PRESET_SIZES.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      if (preset.width === -1) {
                        updateConfig('width', window.screen.availWidth);
                        updateConfig('height', window.screen.availHeight);
                      } else {
                        updateConfig('width', preset.width);
                        updateConfig('height', preset.height);
                      }
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-xs transition-all ${
                      config.width === preset.width || (preset.width === -1 && config.width > 1000)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 hover:border-indigo-300 text-slate-600'
                    }`}
                  >
                    <preset.icon className="w-4 h-4" />
                    <span className="font-medium">{preset.name}</span>
                    {preset.width > 0 && (
                      <span className="text-[10px] opacity-70">{preset.width}×{preset.height}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Custom Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Width (px)</label>
                  <input
                    type="number"
                    value={config.width}
                    onChange={(e) => updateConfig('width', parseInt(e.target.value) || 400)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Height (px)</label>
                  <input
                    type="number"
                    value={config.height}
                    onChange={(e) => updateConfig('height', parseInt(e.target.value) || 300)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </div>
              </div>

              {/* Resizable */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.resizable !== false}
                  onChange={(e) => updateConfig('resizable', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Allow resizing</span>
              </label>
            </div>
          )}
        </div>

        {/* Position Section */}
        <div>
          <SectionHeader section="position" icon={Move} title="Position" />
          {expandedSections.has('position') && (
            <div className="px-4 pb-4 space-y-4">
              {/* Visual screen position picker */}
              <div
                className="relative w-full aspect-[16/10] bg-slate-100 rounded-xl border-2 border-slate-200 overflow-hidden cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const xPct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                  const yPct = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                  onChange({ ...config, position: 'custom' as any, customX: xPct, customY: yPct });
                }}
              >
                {/* Screen frame */}
                <div className="absolute inset-2 rounded-lg border border-slate-300 bg-white/60">
                  {/* Taskbar */}
                  <div className="absolute bottom-0 left-0 right-0 h-[8%] bg-slate-200/80 rounded-b-lg" />
                </div>
                {/* Position dot */}
                {(() => {
                  const pos = config.position === 'custom'
                    ? { x: config.customX ?? 50, y: config.customY ?? 50 }
                    : (POSITION_COORDS[config.position] || POSITION_COORDS.center);
                  return (
                    <div
                      className="absolute w-5 h-4 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-indigo-500 border-2 border-white shadow-lg ring-2 ring-indigo-300/50 transition-all duration-150"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    />
                  );
                })()}
                {/* Label */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-medium text-slate-400">
                  Click to place window
                </div>
              </div>

              {/* Position button grid */}
              <div className="grid grid-cols-4 gap-1.5">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.value}
                    onClick={() => updateConfig('position', pos.value as any)}
                    className={`px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                      config.position === pos.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 hover:border-indigo-300 text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>

              {/* Custom position X/Y inputs */}
              {config.position === 'custom' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">X Position (%)</label>
                    <input
                      type="number"
                      value={config.customX ?? 50}
                      onChange={(e) => updateConfig('customX', parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Y Position (%)</label>
                    <input
                      type="number"
                      value={config.customY ?? 50}
                      onChange={(e) => updateConfig('customY', parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      min="0"
                      max="100"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.frameless === true}
                  onChange={(e) => updateConfig('frameless', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Frameless window (no title bar)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.alwaysOnTop === true}
                  onChange={(e) => updateConfig('alwaysOnTop', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Always on top</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.minimizable !== false}
                  onChange={(e) => updateConfig('minimizable', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Minimizable</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.draggable !== false}
                  onChange={(e) => updateConfig('draggable', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-700">Window is draggable</span>
              </label>
            </div>
          )}
        </div>

        {/* Background Section */}
        <div>
          <SectionHeader section="background" icon={Palette} title="Background" />
          {expandedSections.has('background') && (
            <div className="px-4 pb-4 space-y-4">
              {/* Background Type Tabs */}
              <div className="flex p-1 bg-slate-100 rounded-lg">
                {(['color', 'gradient', 'image', 'translucent', 'transparent'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (type === 'transparent') {
                        onChange({ ...config, backgroundType: 'transparent', backgroundColor: 'transparent' });
                      } else if (type === 'translucent') {
                        onChange({
                          ...config,
                          backgroundType: 'translucent',
                          frameless: true,
                          translucent: config.translucent || { color: '#1a1a2e', opacity: 0.7, blur: 12 },
                        });
                      } else if (config.backgroundType === 'transparent' || config.backgroundType === 'translucent') {
                        onChange({ ...config, backgroundType: type, backgroundColor: type === 'color' ? '#1a1a2e' : config.backgroundColor });
                      } else {
                        updateConfig('backgroundType', type);
                      }
                    }}
                    className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-all capitalize ${
                      config.backgroundType === type || (type === 'color' && !config.backgroundType)
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Translucent Background */}
              {config.backgroundType === 'translucent' && (
                <div className="space-y-4">
                  <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/50">
                    <div className="text-center space-y-1">
                      <div className="text-sm font-medium text-indigo-700">Translucent Background</div>
                      <p className="text-[10px] text-indigo-500">
                        Semi-transparent with backdrop blur. Content behind the window shows through.
                      </p>
                    </div>
                  </div>

                  {/* Base Color */}
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Base Color</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={config.translucent?.color || '#1a1a2e'}
                        onChange={(e) => onChange({
                          ...config,
                          translucent: { ...config.translucent, color: e.target.value, opacity: config.translucent?.opacity ?? 0.7, blur: config.translucent?.blur ?? 12 },
                        })}
                        className="w-10 h-10 rounded-lg cursor-pointer border-2 border-slate-200"
                      />
                      <input
                        type="text"
                        value={config.translucent?.color || '#1a1a2e'}
                        onChange={(e) => onChange({
                          ...config,
                          translucent: { ...config.translucent, color: e.target.value, opacity: config.translucent?.opacity ?? 0.7, blur: config.translucent?.blur ?? 12 },
                        })}
                        className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                        placeholder="#1a1a2e"
                      />
                    </div>
                  </div>

                  {/* Opacity */}
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">
                      Opacity: {Math.round((config.translucent?.opacity ?? 0.7) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((config.translucent?.opacity ?? 0.7) * 100)}
                      onChange={(e) => onChange({
                        ...config,
                        translucent: { ...config.translucent, color: config.translucent?.color || '#1a1a2e', opacity: parseInt(e.target.value) / 100, blur: config.translucent?.blur ?? 12 },
                      })}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                      <span>0% (invisible)</span>
                      <span>50%</span>
                      <span>100% (solid)</span>
                    </div>
                  </div>

                  {/* Blur */}
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">
                      Backdrop Blur: {config.translucent?.blur ?? 12}px
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={config.translucent?.blur ?? 12}
                      onChange={(e) => onChange({
                        ...config,
                        translucent: { ...config.translucent, color: config.translucent?.color || '#1a1a2e', opacity: config.translucent?.opacity ?? 0.7, blur: parseInt(e.target.value) },
                      })}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                      <span>0px (none)</span>
                      <span>25px</span>
                      <span>50px (heavy)</span>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.frameless === true}
                      onChange={(e) => updateConfig('frameless', e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-700">Frameless mode <span className="text-slate-400">(required for translucent)</span></span>
                  </label>
                </div>
              )}

              {/* Transparent Background */}
              {config.backgroundType === 'transparent' && (
                <div className="space-y-3">
                  <div className="p-4 rounded-lg border border-dashed border-slate-300" style={{ backgroundImage: 'repeating-conic-gradient(#e2e8f0 0% 25%, #fff 0% 50%)', backgroundSize: '16px 16px' }}>
                    <div className="text-center space-y-1.5">
                      <div className="text-sm font-medium text-slate-700">Transparent Background</div>
                      <p className="text-xs text-slate-500">
                        Only the window background will be transparent. Your UI content remains fully visible.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.frameless === true}
                      onChange={(e) => updateConfig('frameless', e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-700">Enable frameless mode <span className="text-slate-400">(recommended)</span></span>
                  </label>
                </div>
              )}

              {/* Color Background */}
              {(config.backgroundType === 'color' || !config.backgroundType) && (
                <div className="space-y-2">
                  <label className="text-xs text-slate-500">Background Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={config.backgroundColor || '#1a1a2e'}
                      onChange={(e) => updateConfig('backgroundColor', e.target.value)}
                      className="w-12 h-12 rounded-lg cursor-pointer border-2 border-slate-200"
                    />
                    <input
                      type="text"
                      value={config.backgroundColor || '#1a1a2e'}
                      onChange={(e) => updateConfig('backgroundColor', e.target.value)}
                      className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      placeholder="#1a1a2e"
                    />
                  </div>
                </div>
              )}

              {/* Gradient Background */}
              {config.backgroundType === 'gradient' && (
                <div className="space-y-4">
                  {/* Gradient Presets */}
                  <div className="grid grid-cols-5 gap-2">
                    {GRADIENT_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => updateConfig('gradient', preset.gradient as any)}
                        className="group relative w-full aspect-square rounded-lg overflow-hidden"
                        style={{ background: generateGradientCSS(preset.gradient as any) }}
                        title={preset.name}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity">
                          {preset.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Gradient Type */}
                  <div className="flex gap-2">
                    {(['linear', 'radial', 'conic'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => updateNested('gradient', 'type', type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border-2 transition-all capitalize ${
                          config.gradient?.type === type || (type === 'linear' && !config.gradient?.type)
                            ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                            : 'border-slate-200 text-slate-600 hover:border-indigo-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  {/* Gradient Angle (for linear) */}
                  {(!config.gradient?.type || config.gradient?.type === 'linear') && (
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Angle: {config.gradient?.angle || 135}°</label>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={config.gradient?.angle || 135}
                        onChange={(e) => updateNested('gradient', 'angle', parseInt(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Gradient Stops */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Color Stops</label>
                      <button
                        onClick={() => {
                          const stops = config.gradient?.stops || [];
                          updateNested('gradient', 'stops', [
                            ...stops,
                            { color: '#ffffff', position: 50 },
                          ]);
                        }}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="w-3 h-3" />
                        Add Stop
                      </button>
                    </div>
                    {(config.gradient?.stops || []).map((stop, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={stop.color}
                          onChange={(e) => {
                            const stops = [...(config.gradient?.stops || [])];
                            stops[index] = { ...stop, color: e.target.value };
                            updateNested('gradient', 'stops', stops);
                          }}
                          className="w-8 h-8 rounded cursor-pointer"
                        />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={stop.position}
                          onChange={(e) => {
                            const stops = [...(config.gradient?.stops || [])];
                            stops[index] = { ...stop, position: parseInt(e.target.value) };
                            updateNested('gradient', 'stops', stops);
                          }}
                          className="flex-1"
                        />
                        <span className="text-xs text-slate-500 w-10">{stop.position}%</span>
                        <button
                          onClick={() => {
                            const stops = (config.gradient?.stops || []).filter((_, i) => i !== index);
                            updateNested('gradient', 'stops', stops);
                          }}
                          className="p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Image Background */}
              {config.backgroundType === 'image' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Image URL</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={config.backgroundImage?.url || ''}
                          onChange={(e) => updateNested('backgroundImage', 'url', e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                          placeholder="https://example.com/image.jpg"
                        />
                      </div>
                      <button className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors">
                        <Upload className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Fit</label>
                      <select
                        value={config.backgroundImage?.fit || 'cover'}
                        onChange={(e) => updateNested('backgroundImage', 'fit', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      >
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                        <option value="fill">Fill</option>
                        <option value="none">None</option>
                        <option value="scale-down">Scale Down</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Position</label>
                      <select
                        value={config.backgroundImage?.position || 'center'}
                        onChange={(e) => updateNested('backgroundImage', 'position', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      >
                        <option value="center">Center</option>
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">
                      Opacity: {Math.round((config.backgroundImage?.opacity ?? 1) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((config.backgroundImage?.opacity ?? 1) * 100)}
                      onChange={(e) => updateNested('backgroundImage', 'opacity', parseInt(e.target.value) / 100)}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Effects Section */}
        <div>
          <SectionHeader section="effects" icon={Sparkles} title="Effects" />
          {expandedSections.has('effects') && (
            <div className="px-4 pb-4 space-y-4">
              {/* Shadow */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.shadow?.enabled || false}
                    onChange={(e) => updateNested('shadow', 'enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Drop Shadow</span>
                </label>

                {config.shadow?.enabled && (
                  <div className="pl-6 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">X Offset</label>
                        <input
                          type="number"
                          value={config.shadow.x || 0}
                          onChange={(e) => updateNested('shadow', 'x', parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">Y Offset</label>
                        <input
                          type="number"
                          value={config.shadow.y || 4}
                          onChange={(e) => updateNested('shadow', 'y', parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">Blur</label>
                        <input
                          type="number"
                          value={config.shadow.blur || 12}
                          onChange={(e) => updateNested('shadow', 'blur', parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">Spread</label>
                        <input
                          type="number"
                          value={config.shadow.spread || 0}
                          onChange={(e) => updateNested('shadow', 'spread', parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={config.shadow.color || '#00000040'}
                        onChange={(e) => updateNested('shadow', 'color', e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer"
                      />
                      <span className="text-xs text-slate-500">Shadow Color</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Border */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.border?.enabled || false}
                    onChange={(e) => updateNested('border', 'enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Border</span>
                </label>

                {config.border?.enabled && (
                  <div className="pl-6 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={config.border.color || '#ffffff20'}
                        onChange={(e) => updateNested('border', 'color', e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer"
                      />
                      <span className="text-xs text-slate-500">Border Color</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">Width (px)</label>
                        <input
                          type="number"
                          value={config.border.width || 1}
                          onChange={(e) => updateNested('border', 'width', parseInt(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 mb-1 block">Style</label>
                        <select
                          value={config.border.style || 'solid'}
                          onChange={(e) => updateNested('border', 'style', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded"
                        >
                          <option value="solid">Solid</option>
                          <option value="dashed">Dashed</option>
                          <option value="dotted">Dotted</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Border Radius */}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Corner Radius: {config.borderRadius || 0}px
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={config.borderRadius || 0}
                    onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={config.borderRadius || 0}
                    onChange={(e) => updateConfig('borderRadius', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 text-xs border border-slate-200 rounded text-center"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Appearance Section */}
        <div>
          <SectionHeader section="appearance" icon={Type} title="Content & Typography" />
          {expandedSections.has('appearance') && (
            <div className="px-4 pb-4 space-y-4">
              {/* Overflow / Scrollbar */}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Content Overflow</label>
                <select
                  value={config.overflow || 'auto'}
                  onChange={(e) => updateConfig('overflow', e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="auto">Auto (scrollbar when needed)</option>
                  <option value="hidden">Hidden (no scrollbar, clip content)</option>
                  <option value="scroll">Scroll (always show scrollbar)</option>
                  <option value="visible">Visible (content can overflow)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Controls how content behaves when it exceeds the window size</p>
              </div>

              {/* Content Padding */}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Content Padding: {config.contentPadding || 24}px
                </label>
                <input
                  type="range"
                  min="0"
                  max="64"
                  step="4"
                  value={config.contentPadding || 24}
                  onChange={(e) => updateConfig('contentPadding', parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>0px</span>
                  <span>32px</span>
                  <span>64px</span>
                </div>
              </div>

              {/* Typography */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-slate-600">Default Typography</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Font Family</label>
                    <select
                      value={config.typography?.fontFamily || 'system'}
                      onChange={(e) => {
                        const val = e.target.value;
                        onChange({
                          ...config,
                          typography: { ...config.typography, fontFamily: val === 'system' ? undefined : val },
                        });
                      }}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    >
                      <optgroup label="System">
                        <option value="system">System Default</option>
                      </optgroup>
                      <optgroup label="Sans-Serif">
                        <option value="'Inter', system-ui, sans-serif">Inter</option>
                        <option value="'Poppins', system-ui, sans-serif">Poppins</option>
                        <option value="'Roboto', system-ui, sans-serif">Roboto</option>
                        <option value="'Open Sans', system-ui, sans-serif">Open Sans</option>
                        <option value="'Lato', system-ui, sans-serif">Lato</option>
                        <option value="'Montserrat', system-ui, sans-serif">Montserrat</option>
                        <option value="'Raleway', system-ui, sans-serif">Raleway</option>
                        <option value="'Outfit', system-ui, sans-serif">Outfit</option>
                        <option value="'DM Sans', system-ui, sans-serif">DM Sans</option>
                        <option value="'Plus Jakarta Sans', system-ui, sans-serif">Plus Jakarta Sans</option>
                        <option value="'Manrope', system-ui, sans-serif">Manrope</option>
                        <option value="'Sora', system-ui, sans-serif">Sora</option>
                        <option value="'Archivo', system-ui, sans-serif">Archivo</option>
                        <option value="'Space Grotesk', system-ui, sans-serif">Space Grotesk</option>
                        <option value="'Nunito', system-ui, sans-serif">Nunito</option>
                        <option value="'Quicksand', system-ui, sans-serif">Quicksand</option>
                        <option value="'Comfortaa', system-ui, sans-serif">Comfortaa</option>
                        <option value="'IBM Plex Sans', system-ui, sans-serif">IBM Plex Sans</option>
                      </optgroup>
                      <optgroup label="Serif">
                        <option value="'Playfair Display', Georgia, serif">Playfair Display</option>
                        <option value="'Merriweather', Georgia, serif">Merriweather</option>
                        <option value="'Lora', Georgia, serif">Lora</option>
                        <option value="'Source Serif 4', Georgia, serif">Source Serif 4</option>
                        <option value="'DM Serif Display', Georgia, serif">DM Serif Display</option>
                        <option value="Georgia, serif">Georgia</option>
                      </optgroup>
                      <optgroup label="Display">
                        <option value="'Bebas Neue', Impact, sans-serif">Bebas Neue</option>
                        <option value="'Oswald', Impact, sans-serif">Oswald</option>
                      </optgroup>
                      <optgroup label="Handwriting">
                        <option value="'Caveat', cursive">Caveat</option>
                        <option value="'Dancing Script', cursive">Dancing Script</option>
                        <option value="'Pacifico', cursive">Pacifico</option>
                        <option value="'Permanent Marker', cursive">Permanent Marker</option>
                        <option value="'Satisfy', cursive">Satisfy</option>
                      </optgroup>
                      <optgroup label="Monospace">
                        <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                        <option value="'Fira Code', monospace">Fira Code</option>
                        <option value="'Source Code Pro', monospace">Source Code Pro</option>
                        <option value="'Space Mono', monospace">Space Mono</option>
                        <option value="'IBM Plex Mono', monospace">IBM Plex Mono</option>
                      </optgroup>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">Base Font Size</label>
                    <input
                      type="number"
                      value={config.typography?.fontSize || 14}
                      onChange={(e) => {
                        onChange({
                          ...config,
                          typography: { ...config.typography, fontSize: parseInt(e.target.value) || 14 },
                        });
                      }}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      min="10"
                      max="24"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Default Text Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.typography?.color || '#e2e8f0'}
                      onChange={(e) => {
                        onChange({
                          ...config,
                          typography: { ...config.typography, color: e.target.value },
                        });
                      }}
                      className="w-8 h-8 rounded cursor-pointer border-2 border-slate-200"
                    />
                    <input
                      type="text"
                      value={config.typography?.color || '#e2e8f0'}
                      onChange={(e) => {
                        onChange({
                          ...config,
                          typography: { ...config.typography, color: e.target.value },
                        });
                      }}
                      className="flex-1 px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Animation Section */}
        <div>
          <SectionHeader section="animation" icon={RefreshCw} title="Animation" />
          {expandedSections.has('animation') && (
            <div className="px-4 pb-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Open Animation</label>
                  <select
                    value={config.animation?.open || 'fade'}
                    onChange={(e) => updateNested('animation', 'open', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  >
                    <option value="fade">Fade</option>
                    <option value="slide-up">Slide Up</option>
                    <option value="slide-down">Slide Down</option>
                    <option value="slide-left">Slide Left</option>
                    <option value="slide-right">Slide Right</option>
                    <option value="scale">Scale</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Close Animation</label>
                  <select
                    value={config.animation?.close || 'fade'}
                    onChange={(e) => updateNested('animation', 'close', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  >
                    <option value="fade">Fade</option>
                    <option value="slide-up">Slide Up</option>
                    <option value="slide-down">Slide Down</option>
                    <option value="slide-left">Slide Left</option>
                    <option value="slide-right">Slide Right</option>
                    <option value="scale">Scale</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Duration: {config.animation?.duration || 300}ms
                </label>
                <input
                  type="range"
                  min="100"
                  max="1000"
                  step="50"
                  value={config.animation?.duration || 300}
                  onChange={(e) => updateNested('animation', 'duration', parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
