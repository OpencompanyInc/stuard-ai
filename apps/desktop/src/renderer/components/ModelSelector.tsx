import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Sparkles,
  Check,
  Zap,
  Brain,
  ChevronDown,
  Cpu,
  Command,
  ChevronRight,
  Scale,
  Settings2,
  Globe
} from 'lucide-react';
import type { ModelMeta } from '../hooks/usePreferences';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { clsx } from 'clsx';

interface ModelSelectorProps {
  selectedModelId: string | 'auto';
  onSelectModel: (id: string | 'auto') => void;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}

const PROVIDER_FALLBACK_ICONS: Record<string, React.ReactNode> = {
  'OpenAI': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-emerald-500 text-white rounded">O</span>,
  'Google': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-blue-500 text-white rounded">G</span>,
  'xAI': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-black text-white rounded italic">x</span>,
  'DeepSeek': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-blue-600 text-white rounded">D</span>,
  'Perplexity': <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold bg-cyan-500 text-white rounded">P</span>,
};

const TIER_DEFAULTS: Record<'fast' | 'balanced' | 'smart' | 'research', string> = {
  fast: 'deepseek/deepseek-chat',
  balanced: 'xai/grok-4-1-fast',
  smart: 'google/gemini-3-pro-preview',
  research: 'perplexity/sonar-pro',
};

function hashString(s: string): number {
  // tiny, deterministic hash for stable "random" picks
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let x = hashString(seed) || 1;
  // xorshift32
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModelId,
  onSelectModel,
  className,
  side = 'top',
  align = 'start'
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { models: ALL_MODELS } = useModelRegistry();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as any)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setActiveIndex(0);
    } else {
      setSearch('');
    }
  }, [open]);

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return ALL_MODELS;
    return ALL_MODELS.filter(m => 
      m.name.toLowerCase().includes(q) || 
      m.provider.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }, [search, ALL_MODELS]);

  const grouped = useMemo(() => {
    if (search) {
      return { smart: [] as ModelMeta[], balanced: [] as ModelMeta[], fast: [] as ModelMeta[], research: [] as ModelMeta[] };
    }

    const today = new Date();
    const seedDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const byTier = {
      // Fast is explicitly "non-reasoning" (per UX spec)
      fast: filteredModels.filter(m => m.category === 'fast' && !m.isReasoning),
      balanced: filteredModels.filter(m => m.category === 'balanced'),
      smart: filteredModels.filter(m => m.category === 'smart'),
      research: filteredModels.filter(m => m.category === 'research'),
    } satisfies Record<'fast' | 'balanced' | 'smart' | 'research', ModelMeta[]>;

    const build = (tier: 'fast' | 'balanced' | 'smart' | 'research') => {
      const list = byTier[tier];
      if (list.length === 0) return [] as ModelMeta[];
      const defId = TIER_DEFAULTS[tier];
      const def = list.find(m => m.id === defId) || list[0];
      const rest = list.filter(m => m.id !== def.id);
      const shuffled = seededShuffle(rest, `${seedDay}:${tier}`);
      return [def, ...shuffled.slice(0, 2)].filter(Boolean);
    };

    return {
      fast: build('fast'),
      balanced: build('balanced'),
      smart: build('smart'),
      research: build('research'),
    };
  }, [filteredModels, search]);

  const allVisibleItems = useMemo(() => {
    const items: Array<{ id: string | 'auto', type: 'model' | 'auto', data?: ModelMeta }> = [];
    if (!search) items.push({ id: 'auto', type: 'auto' });

    // In search mode, we show all filtered models in a single list
    if (search) {
      filteredModels.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
    } else {
      grouped.fast.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
      grouped.balanced.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
      grouped.smart.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
      grouped.research.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
    }

    return items;
  }, [grouped, search, filteredModels]);

  const selectedModel = useMemo(() => {
    if (selectedModelId === 'auto') return null;
    return ALL_MODELS.find(m => m.id === selectedModelId);
  }, [selectedModelId, ALL_MODELS]);

  const selectedModelName = useMemo(() => {
    if (selectedModelId === 'auto') return 'Auto';
    return selectedModel ? selectedModel.name : selectedModelId;
  }, [selectedModelId, selectedModel]);

  const handleSelect = (id: string | 'auto') => {
    onSelectModel(id);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % allVisibleItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + allVisibleItems.length) % allVisibleItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allVisibleItems[activeIndex];
      if (item) handleSelect(item.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (open && scrollRef.current) {
      const activeEl = scrollRef.current.querySelector(`[data-index="${activeIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [activeIndex, open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-xl transition-all cursor-pointer outline-none group border border-transparent hover:bg-black/5",
          open ? "bg-black/5" : "bg-transparent",
          className
        )}
      >
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          {selectedModel?.logoUrl ? (
            <img
              src={selectedModel.logoUrl}
              alt={selectedModel.provider}
              className="w-4 h-4 object-contain"
            />
          ) : (
            selectedModel ? (
              PROVIDER_FALLBACK_ICONS[selectedModel.provider] || <Cpu className="w-3.5 h-3.5 text-neutral-500" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-blue-600 fill-blue-600/20" />
            )
          )}
        </div>
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[12px] font-semibold text-neutral-600 truncate max-w-[80px] leading-none group-hover:text-neutral-900">
            {selectedModelName}
          </span>
        </div>
        <ChevronDown className={clsx("w-3 h-3 text-neutral-400/70 transition-transform duration-300 ml-0.5", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className={clsx(
            "absolute z-[10005] w-[400px] bg-white rounded-[24px] border border-black/10 shadow-2xl overflow-hidden flex flex-col max-h-[520px] animate-in fade-in zoom-in-95 duration-200",
            side === 'top' ? 'bottom-full mb-4' : 'top-full mt-4',
            align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'
          )}
        >
          {/* Header with Search */}
          <div className="p-3 bg-neutral-50/50 border-b border-neutral-100 flex items-center">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                ref={inputRef}
                className="w-full pl-11 pr-4 py-2 bg-white rounded-xl text-[14px] text-neutral-800 placeholder:text-neutral-400 outline-none shadow-sm ring-1 ring-black/5 focus:ring-2 focus:ring-blue-500/20 transition-all border-none font-medium"
                placeholder="Search any model..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {search ? (
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                <div className="flex flex-col gap-1">
                  {allVisibleItems.map((item, i) => item.type === 'model' && (
                    <ModelItem 
                      key={item.id}
                      model={item.data!}
                      isActive={activeIndex === i}
                      isSelected={selectedModelId === item.id}
                      index={i}
                      onClick={() => handleSelect(item.id)}
                    />
                  ))}
                </div>
                {allVisibleItems.length === 0 && (
                  <div className="py-20 text-center">
                    <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Search className="w-8 h-8 text-neutral-300" />
                    </div>
                    <p className="text-neutral-500 font-medium">No models found for "{search}"</p>
                  </div>
                )}
              </div>
            ) : (
              <div ref={scrollRef} className="flex-1 p-2 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                {/* Auto Router Item */}
                <div className="px-1">
                  <button 
                    onClick={() => handleSelect('auto')}
                    data-index={0}
                    className={clsx(
                      "w-full flex items-center gap-3 p-2 rounded-xl transition-all text-left",
                      activeIndex === 0 ? "bg-neutral-900 text-white shadow-lg scale-[1.02] z-10" :
                      selectedModelId === 'auto' ? "bg-blue-50 text-blue-700 ring-1 ring-blue-500/10" : "hover:bg-neutral-50 text-neutral-700"
                    )}
                  >
                    <div className={clsx(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all shadow-sm",
                      activeIndex === 0 ? "bg-white/10" : "bg-blue-50"
                    )}>
                      <Sparkles className={clsx("w-4 h-4", activeIndex === 0 ? "text-white" : "text-blue-600")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold">Automatic Routing</div>
                      <div className={clsx("text-[10px] font-medium", activeIndex === 0 ? "text-neutral-300" : "text-neutral-400")}>Best model for each task</div>
                    </div>
                    {selectedModelId === 'auto' && <Check className="w-4 h-4" />}
                  </button>
                </div>

                {/* Fast Mode Section */}
                {grouped.fast.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Fast & Efficient</span>
                    </div>
                    {grouped.fast.map((model) => {
                      const idx = allVisibleItems.findIndex(x => x.id === model.id);
                      return (
                        <ModelItem 
                          key={model.id}
                          model={model}
                          isActive={activeIndex === idx}
                          isSelected={selectedModelId === model.id}
                          index={idx}
                          onClick={() => handleSelect(model.id)}
                          compact
                        />
                      );
                    })}
                  </div>
                )}

                {/* Balanced Section */}
                {grouped.balanced.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Scale className="w-3 h-3 text-emerald-500" />
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Balanced</span>
                    </div>
                    {grouped.balanced.map((model) => {
                      const idx = allVisibleItems.findIndex(x => x.id === model.id);
                      return (
                        <ModelItem 
                          key={model.id}
                          model={model}
                          isActive={activeIndex === idx}
                          isSelected={selectedModelId === model.id}
                          index={idx}
                          onClick={() => handleSelect(model.id)}
                          compact
                        />
                      );
                    })}
                  </div>
                )}

                {/* Smart Section */}
                {grouped.smart.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Brain className="w-3 h-3 text-purple-500" />
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Intelligence</span>
                    </div>
                    {grouped.smart.map((model) => {
                      const idx = allVisibleItems.findIndex(x => x.id === model.id);
                      return (
                        <ModelItem
                          key={model.id}
                          model={model}
                          isActive={activeIndex === idx}
                          isSelected={selectedModelId === model.id}
                          index={idx}
                          onClick={() => handleSelect(model.id)}
                          compact
                        />
                      );
                    })}
                  </div>
                )}

                {/* Research Section */}
                {grouped.research.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-2 mb-1">
                      <Globe className="w-3 h-3 text-cyan-500" />
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Research</span>
                    </div>
                    {grouped.research.map((model) => {
                      const idx = allVisibleItems.findIndex(x => x.id === model.id);
                      return (
                        <ModelItem
                          key={model.id}
                          model={model}
                          isActive={activeIndex === idx}
                          isSelected={selectedModelId === model.id}
                          index={idx}
                          onClick={() => handleSelect(model.id)}
                          compact
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Info */}
          <div className="p-3 bg-neutral-50 border-t border-neutral-100 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                <Command className="w-3 h-3" />
                <span>Nav</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-bold uppercase tracking-wider hover:text-neutral-800 cursor-pointer transition-colors">
                <Settings2 className="w-3 h-3" />
                <span>Config</span>
              </div>
            </div>
            <div className="text-[10px] text-neutral-400 italic">
              {ALL_MODELS.length} models
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ModelItemProps {
  model: ModelMeta;
  isActive: boolean;
  isSelected: boolean;
  index: number;
  onClick: () => void;
  shortcut?: string;
  compact?: boolean;
}

const ModelItem: React.FC<ModelItemProps> = ({ model, isActive, isSelected, index, onClick, shortcut, compact }) => {
  return (
    <button
      data-index={index}
      onClick={onClick}
      className={clsx(
        'w-full flex items-center justify-between rounded-2xl text-left transition-all group relative',
        compact ? 'p-2' : 'p-3',
        isActive ? 'bg-neutral-900 text-white shadow-xl scale-[1.02] z-10' : 
        isSelected ? 'bg-blue-50/80 text-neutral-900 ring-1 ring-blue-500/10' : 'hover:bg-neutral-50 text-neutral-700 hover:scale-[1.01]'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={clsx(
          "rounded-xl flex items-center justify-center flex-shrink-0 transition-all shadow-sm",
          compact ? "w-8 h-8" : "w-10 h-10",
          isActive ? "bg-white/10 rotate-3" : "bg-white border border-black/5 group-hover:-rotate-3"
        )}>
          {model.logoUrl ? (
            <img
              src={model.logoUrl}
              alt={model.provider}
              className={clsx(compact ? "w-4 h-4" : "w-5 h-5", "object-contain")}
            />
          ) : (
            PROVIDER_FALLBACK_ICONS[model.provider] || <Cpu className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={clsx(
              "font-bold truncate leading-none",
              compact ? "text-[13px]" : "text-[14px]"
            )}>{model.name}</div>
            {model.isReasoning && !compact && (
              <div className={clsx(
                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                isActive ? "bg-white/20 text-white" : "bg-purple-100 text-purple-600"
              )}>
                Pro
              </div>
            )}
          </div>
          <div className={clsx(
            "text-[10px] mt-1 font-bold truncate uppercase tracking-tighter opacity-70",
            isActive ? "text-neutral-300" : "text-neutral-400"
          )}>
            {model.provider} {model.contextWindow && `• ${Math.round(model.contextWindow/1000)}k`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isSelected ? (
          <div className={clsx(
            "rounded-full flex items-center justify-center",
            compact ? "w-4 h-4" : "w-5 h-5",
            isActive ? "bg-white/20" : "bg-blue-600 shadow-sm shadow-blue-500/30"
          )}>
            <Check className={clsx(compact ? "w-2.5 h-2.5" : "w-3 h-3", "text-white")} />
          </div>
        ) : (
          <ChevronRight className={clsx(
            "w-4 h-4 transition-all opacity-0 -translate-x-2",
            isActive && "opacity-40 translate-x-0"
          )} />
        )}
      </div>
    </button>
  );
};
