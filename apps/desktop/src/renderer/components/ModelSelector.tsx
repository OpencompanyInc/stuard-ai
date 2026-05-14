import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Sparkles,
  Check,
  Zap,
  Brain,
  ChevronDown,
  Cpu,
  Scale,
  Globe,
} from 'lucide-react';
import type { ModelMeta, ModelSourcePreference, ReasoningLevel } from '../hooks/usePreferences';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { useByokStatus } from '../hooks/useByokStatus';
import { clsx } from 'clsx';

interface ModelSelectorProps {
  selectedModelId: string | 'auto';
  onSelectModel: (id: string | 'auto') => void;
  modelSource?: ModelSourcePreference;
  onModelSourceChange?: (source: ModelSourcePreference) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningLevelChange?: (level: ReasoningLevel) => void;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  variant?: 'default' | 'glass';
  portal?: boolean;
  panelWidth?: number;
}

const PROVIDER_FALLBACK_ICONS: Record<string, React.ReactNode> = {
  'OpenAI': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-emerald-500 text-white rounded">O</span>,
  'Google': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-blue-500 text-white rounded">G</span>,
  'xAI': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-black text-white rounded italic">x</span>,
  'DeepSeek': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-blue-600 text-white rounded">D</span>,
  'Perplexity': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-cyan-500 text-white rounded">P</span>,
  'Anthropic': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-orange-500 text-white rounded">A</span>,
  'OpenRouter': <span className="w-4 h-4 flex items-center justify-center text-[9px] font-semibold bg-purple-500 text-white rounded">R</span>,
};

const TIER_DEFAULTS: Record<'fast' | 'balanced' | 'smart' | 'research', string> = {
  fast: 'deepseek/deepseek-chat',
  balanced: 'xai/grok-4-1-fast',
  smart: 'openai/gpt-5.1',
  research: 'perplexity/sonar-pro',
};

function hashString(s: string): number {
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

function stripVariantSuffix(modelId: string): string {
  return String(modelId || '').replace(/:free$/i, '');
}

function dedupeBrowseModels(models: ModelMeta[]): ModelMeta[] {
  const seen = new Set<string>();
  const out: ModelMeta[] = [];
  for (const model of models) {
    const familyId = stripVariantSuffix(model.id);
    if (seen.has(familyId)) continue;
    seen.add(familyId);
    out.push(model);
  }
  return out;
}

function modelProviderId(model: ModelMeta | null | undefined): string {
  return String(model?.providerId || model?.id?.split('/')[0] || '').toLowerCase();
}

function isOpenAIModel(model: ModelMeta | null | undefined): boolean {
  return modelProviderId(model) === 'openai';
}

function sourceBadgeForModel(
  model: ModelMeta | null | undefined,
  source: ModelSourcePreference,
  snap: ReturnType<typeof useByokStatus>,
): 'byok' | 'subscription' | null {
  if (!model) return null;
  if (source === 'api_key') {
    return snap.byokProviders.has(modelProviderId(model)) ? 'byok' : null;
  }
  if (source === 'subscription') {
    return isOpenAIModel(model) && snap.codexReady ? 'subscription' : null;
  }
  return null;
}

const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; extra?: React.ReactNode }> = ({ icon, label, extra }) => (
  <div className="flex items-center gap-1.5 px-2 mb-1">
    <span className="text-theme-muted/70 flex-shrink-0">{icon}</span>
    <span className="text-[10px] font-semibold text-theme-muted/80 uppercase tracking-wider">{label}</span>
    {extra && <div className="ml-auto flex items-center min-w-0 truncate">{extra}</div>}
  </div>
);

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModelId,
  onSelectModel,
  modelSource = 'stuard',
  onModelSourceChange,
  reasoningLevel = 'high',
  onReasoningLevelChange,
  className,
  side = 'top',
  align = 'start',
  variant = 'default',
  portal = false,
  panelWidth = 400,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [portalStyle, setPortalStyle] = useState<React.CSSProperties>({});
  const { models: REGISTRY_MODELS } = useModelRegistry();
  const byokStatus = useByokStatus();
  const ALL_MODELS = REGISTRY_MODELS;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !portal || !containerRef.current) return;

    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = panelWidth;
      const left =
        align === 'center'
          ? rect.left + rect.width / 2 - width / 2
          : align === 'end'
            ? rect.right - width
            : rect.left;

      setPortalStyle({
        position: 'fixed',
        width,
        left: Math.max(12, Math.min(left, window.innerWidth - width - 12)),
        top: side === 'top' ? rect.top - 12 : rect.bottom + 12,
        transform: side === 'top' ? 'translateY(-100%)' : undefined,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open, panelWidth, portal, side]);

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
      return { openai: [] as ModelMeta[], smart: [] as ModelMeta[], balanced: [] as ModelMeta[], fast: [] as ModelMeta[], research: [] as ModelMeta[] };
    }

    const today = new Date();
    const seedDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const browseModels = dedupeBrowseModels(filteredModels);
    const openaiModels = modelSource === 'subscription' ? browseModels.filter(isOpenAIModel) : [];
    const tierModels = openaiModels.length > 0 ? browseModels.filter(m => !isOpenAIModel(m)) : browseModels;
    const byTier = {
      fast: tierModels.filter(m => m.category === 'fast' && !m.isReasoning),
      balanced: tierModels.filter(m => m.category === 'balanced'),
      smart: tierModels.filter(m => m.category === 'smart'),
      research: tierModels.filter(m => m.category === 'research'),
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
      openai: openaiModels,
      fast: build('fast'),
      balanced: build('balanced'),
      smart: build('smart'),
      research: build('research'),
    };
  }, [filteredModels, search, modelSource]);

  const allVisibleItems = useMemo(() => {
    const items: Array<{ id: string | 'auto', type: 'model' | 'auto', data?: ModelMeta }> = [];
    if (!search) items.push({ id: 'auto', type: 'auto' });

    if (search) {
      filteredModels.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
    } else {
      grouped.openai.forEach(m => items.push({ id: m.id, type: 'model', data: m }));
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

  const selectedSource = selectedModelId !== 'auto'
    ? sourceBadgeForModel(selectedModel, modelSource, byokStatus)
    : null;

  // Reasoning only meaningfully applies to reasoning-capable models (or 'auto')
  const reasoningApplies = selectedModelId === 'auto' || !!selectedModel?.isReasoning;

  const handleSelect = (id: string | 'auto') => {
    if (id === 'auto' && modelSource !== 'stuard') {
      onModelSourceChange?.('stuard');
    } else if (modelSource === 'subscription') {
      const nextModel = ALL_MODELS.find(m => m.id === id);
      if (!isOpenAIModel(nextModel)) onModelSourceChange?.('stuard');
    } else if (modelSource === 'api_key') {
      const nextModel = ALL_MODELS.find(m => m.id === id);
      if (nextModel && !byokStatus.byokProviders.has(modelProviderId(nextModel))) onModelSourceChange?.('stuard');
    }
    onSelectModel(id);
    setOpen(false);
  };

  // Pick a model AND set a source override in one click (hover affordance)
  const handleSelectWithSource = (id: string, source: ModelSourcePreference) => {
    onModelSourceChange?.(source);
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

  const sourceOptions = useMemo(() => ([
    {
      value: 'stuard' as ModelSourcePreference,
      label: 'Stuard',
      disabled: false,
      title: 'Use Stuard credits (default).',
    },
    {
      value: 'api_key' as ModelSourcePreference,
      label: 'Your key',
      disabled: selectedModelId === 'auto'
        ? true
        : !selectedModel || !byokStatus.byokProviders.has(modelProviderId(selectedModel)),
      title: selectedModelId === 'auto'
        ? 'Pick a specific model to route through your API key.'
        : !selectedModel
          ? 'Unknown model.'
          : byokStatus.byokProviders.has(modelProviderId(selectedModel))
            ? `Route through your ${selectedModel.provider} API key — no Stuard credits used.`
            : `Add a ${selectedModel.provider} API key in Settings to enable this.`,
    },
    {
      value: 'subscription' as ModelSourcePreference,
      label: 'ChatGPT',
      disabled: selectedModelId === 'auto'
        ? true
        : !selectedModel || !isOpenAIModel(selectedModel) || !byokStatus.codexReady,
      title: selectedModelId === 'auto'
        ? 'Pick an OpenAI model to route through your ChatGPT plan.'
        : !selectedModel
          ? 'Unknown model.'
          : !isOpenAIModel(selectedModel)
            ? 'Only available for OpenAI models.'
            : !byokStatus.codexReady
              ? 'Sign in with the Codex CLI in Settings to enable this.'
              : byokStatus.codexAccountEmail
                ? `Route through your ChatGPT plan (${byokStatus.codexAccountEmail}).`
                : 'Route through your ChatGPT plan.',
    },
  ]), [selectedModel, selectedModelId, byokStatus]);

  const reasoningOptions: Array<{ level: ReasoningLevel; label: string }> = [
    { level: 'none', label: 'Off' },
    { level: 'low', label: 'Low' },
    { level: 'medium', label: 'Med' },
    { level: 'high', label: 'High' },
  ];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors cursor-pointer outline-none group border border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
          open && "bg-black/[0.04] dark:bg-white/[0.04]",
          className
        )}
      >
        <div className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
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
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            )
          )}
          {selectedSource && (
            <span
              className={clsx(
                "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-theme-card",
                selectedSource === 'byok' ? 'bg-emerald-500' : 'bg-cyan-500',
              )}
              title={selectedSource === 'byok'
                ? 'Routed through your API key.'
                : 'Routed through your ChatGPT plan.'}
            />
          )}
        </div>
        <span className="text-[12px] font-medium text-theme-fg/80 truncate max-w-[110px] group-hover:text-theme-fg">
          {selectedModelName}
        </span>
        {reasoningLevel !== 'high' && (
          <span
            className={clsx(
              "text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded leading-none",
              reasoningLevel === 'none'
                ? "text-theme-muted/80 bg-theme-hover"
                : "text-purple-600 dark:text-purple-400 bg-purple-500/10",
            )}
            title={`Thinking: ${reasoningLevel}`}
          >
            {reasoningLevel === 'none' ? 'Off' : reasoningLevel === 'low' ? 'Low' : 'Med'}
          </span>
        )}
        <ChevronDown className={clsx("w-3 h-3 text-theme-muted/70 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (() => {
        const panel = (
          <div
            ref={panelRef}
            className={clsx(
              "z-[10005] rounded-2xl overflow-hidden flex flex-col max-h-[520px] animate-in fade-in zoom-in-95 duration-150",
              variant === 'glass'
                ? "bg-theme-card/90 backdrop-blur-2xl border border-white/10 shadow-xl"
                : "bg-theme-card/98 backdrop-blur-xl border border-theme/15 shadow-xl",
              portal
                ? "fixed"
                : [
                    "absolute",
                    side === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5',
                    align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
                  ]
            )}
            style={portal ? portalStyle : { width: panelWidth }}
          >
            {/* Search header */}
            <div className="p-2 border-b border-theme/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted/70 pointer-events-none" />
                <input
                  ref={inputRef}
                  className="w-full pl-9 pr-3 py-2 bg-transparent rounded-lg text-[13px] text-theme-fg placeholder:text-theme-muted/70 outline-none border-none font-normal focus:bg-theme-hover/40 transition-colors"
                  placeholder="Search models, providers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {search ? (
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-1.5 custom-scrollbar">
                  {allVisibleItems.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {allVisibleItems.map((item, i) => item.type === 'model' && (
                        <ModelItem
                          key={item.id}
                          model={item.data!}
                          isActive={activeIndex === i}
                          isSelected={selectedModelId === item.id}
                          index={i}
                          onClick={() => handleSelect(item.id)}
                          source={sourceBadgeForModel(item.data!, modelSource, byokStatus)}
                          currentSource={modelSource}
                          byokStatus={byokStatus}
                          onSelectWithSource={(s) => handleSelectWithSource(item.id, s)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 px-6 text-center">
                      <div className="w-10 h-10 bg-theme-hover/40 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Search className="w-4 h-4 text-theme-muted/70" />
                      </div>
                      <p className="text-[13px] font-medium text-theme-fg mb-1">No matches</p>
                      <p className="text-[11px] text-theme-muted">
                        Nothing for "<span className="text-theme-fg/80">{search}</span>". Try a provider name or model family.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div ref={scrollRef} className="flex-1 p-1.5 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
                  {/* Auto router */}
                  <button
                    onClick={() => handleSelect('auto')}
                    data-index={0}
                    className={clsx(
                      "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors text-left",
                      activeIndex === 0 ? "bg-theme-hover" : "hover:bg-theme-hover/60",
                      selectedModelId === 'auto' && "bg-primary/[0.08]",
                    )}
                  >
                    <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-theme-fg leading-tight">Automatic</div>
                      <div className="text-[11px] text-theme-muted truncate mt-0.5">Best model picked for each task</div>
                    </div>
                    {selectedModelId === 'auto' && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                  </button>

                  {grouped.openai.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader
                        icon={<Sparkles className="w-3 h-3 text-cyan-500/80" />}
                        label="ChatGPT plan"
                        extra={byokStatus.codexAccountEmail && (
                          <span className="text-[10px] text-theme-muted/60 font-normal normal-case tracking-normal truncate">
                            {byokStatus.codexAccountEmail}
                          </span>
                        )}
                      />
                      {grouped.openai.map((model) => {
                        const idx = allVisibleItems.findIndex(x => x.id === model.id);
                        return (
                          <ModelItem
                            key={model.id}
                            model={model}
                            isActive={activeIndex === idx}
                            isSelected={selectedModelId === model.id}
                            index={idx}
                            onClick={() => handleSelect(model.id)}
                            source={sourceBadgeForModel(model, modelSource, byokStatus)}
                            currentSource={modelSource}
                            byokStatus={byokStatus}
                            onSelectWithSource={(s) => handleSelectWithSource(model.id, s)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {grouped.fast.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader icon={<Zap className="w-3 h-3 text-amber-500/80" />} label="Fast & efficient" />
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
                            source={sourceBadgeForModel(model, modelSource, byokStatus)}
                            currentSource={modelSource}
                            byokStatus={byokStatus}
                            onSelectWithSource={(s) => handleSelectWithSource(model.id, s)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {grouped.balanced.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader icon={<Scale className="w-3 h-3 text-emerald-500/80" />} label="Balanced" />
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
                            source={sourceBadgeForModel(model, modelSource, byokStatus)}
                            currentSource={modelSource}
                            byokStatus={byokStatus}
                            onSelectWithSource={(s) => handleSelectWithSource(model.id, s)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {grouped.smart.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader icon={<Brain className="w-3 h-3 text-purple-500/80" />} label="Intelligence" />
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
                            source={sourceBadgeForModel(model, modelSource, byokStatus)}
                            currentSource={modelSource}
                            byokStatus={byokStatus}
                            onSelectWithSource={(s) => handleSelectWithSource(model.id, s)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {grouped.research.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader icon={<Globe className="w-3 h-3 text-cyan-500/80" />} label="Research" />
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
                            source={sourceBadgeForModel(model, modelSource, byokStatus)}
                            currentSource={modelSource}
                            byokStatus={byokStatus}
                            onSelectWithSource={(s) => handleSelectWithSource(model.id, s)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-2.5 py-2 bg-theme-bg/40 border-t border-theme/10 flex flex-col gap-1.5">
              {onModelSourceChange && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-theme-muted/80 uppercase tracking-wider w-[60px] flex-shrink-0">
                    Routing
                  </span>
                  <div className="flex-1 flex items-center bg-theme-hover/40 rounded-md p-[3px] gap-0.5">
                    {sourceOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={opt.disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!opt.disabled) onModelSourceChange(opt.value);
                        }}
                        className={clsx(
                          "flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors text-center",
                          modelSource === opt.value
                            ? opt.value === 'api_key'
                              ? "bg-emerald-500 text-white shadow-sm"
                              : opt.value === 'subscription'
                                ? "bg-cyan-500 text-white shadow-sm"
                                : "bg-theme-card text-theme-fg shadow-sm border border-theme/10"
                            : opt.disabled
                              ? "text-theme-muted/40 cursor-not-allowed"
                              : "text-theme-muted hover:text-theme-fg"
                        )}
                        title={opt.title}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    "text-[10px] font-semibold uppercase tracking-wider w-[60px] flex-shrink-0",
                    reasoningApplies ? "text-theme-muted/80" : "text-theme-muted/40",
                  )}
                  title={reasoningApplies ? undefined : 'This model does not use thinking.'}
                >
                  Thinking
                </span>
                <div className="flex-1 flex items-center bg-theme-hover/40 rounded-md p-[3px] gap-0.5">
                  {reasoningOptions.map(({ level, label }) => (
                    <button
                      key={level}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReasoningLevelChange?.(level);
                      }}
                      className={clsx(
                        "flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors text-center",
                        reasoningLevel === level
                          ? level === 'none'
                            ? "bg-theme-card text-theme-fg shadow-sm border border-theme/10"
                            : "bg-purple-500 text-white shadow-sm"
                          : !reasoningApplies
                            ? "text-theme-muted/40 hover:text-theme-muted"
                            : "text-theme-muted hover:text-theme-fg"
                      )}
                      title={!reasoningApplies ? 'Only applies to reasoning-capable models.' : `Thinking depth: ${label}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-theme/5">
                <div className="flex items-center gap-3 text-[10px] text-theme-muted/70">
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono text-theme-muted">↑↓</kbd>
                    <span>nav</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono text-theme-muted">↵</kbd>
                    <span>select</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono text-theme-muted">esc</kbd>
                    <span>close</span>
                  </span>
                </div>
                <div className="text-[10px] text-theme-muted/60">
                  {ALL_MODELS.length} models
                </div>
              </div>
            </div>
          </div>
        );

        return portal ? createPortal(panel, document.body) : panel;
      })()}
    </div>
  );
};

interface ModelItemProps {
  model: ModelMeta;
  isActive: boolean;
  isSelected: boolean;
  index: number;
  onClick: () => void;
  source?: 'byok' | 'subscription' | null;
  currentSource: ModelSourcePreference;
  byokStatus: ReturnType<typeof useByokStatus>;
  onSelectWithSource: (source: ModelSourcePreference) => void;
}

const ModelItem: React.FC<ModelItemProps> = ({
  model,
  isActive,
  isSelected,
  index,
  onClick,
  source,
  currentSource,
  byokStatus,
  onSelectWithSource,
}) => {
  const byokAvailable = byokStatus.byokProviders.has(modelProviderId(model));
  const codexAvailable = isOpenAIModel(model) && byokStatus.codexReady;
  const showByokAction = byokAvailable && currentSource !== 'api_key';
  const showPlanAction = codexAvailable && currentSource !== 'subscription';

  return (
    <button
      data-index={index}
      onClick={onClick}
      className={clsx(
        'group/row w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors relative',
        isActive ? 'bg-theme-hover' : 'hover:bg-theme-hover/60',
        isSelected && 'bg-primary/[0.08]',
      )}
    >
      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-theme-bg border border-theme/10">
        {model.logoUrl ? (
          <img
            src={model.logoUrl}
            alt={model.provider}
            className="w-4 h-4 object-contain"
          />
        ) : (
          PROVIDER_FALLBACK_ICONS[model.provider] || <Cpu className="w-3.5 h-3.5 text-theme-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-theme-fg truncate leading-tight">{model.name}</span>
          {model.isReasoning && (
            <span title="Reasoning-capable model" className="flex-shrink-0">
              <Brain className="w-3 h-3 text-purple-500/70" aria-label="Reasoning model" />
            </span>
          )}
        </div>
        <div className="text-[11px] text-theme-muted truncate mt-0.5">
          {model.provider}
          {model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k context` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Hover-only override actions — let the user pick this model AND change routing in one click */}
        {showByokAction && !isSelected && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWithSource('api_key');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onSelectWithSource('api_key');
              }
            }}
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded transition-opacity cursor-pointer"
            title="Use your API key for this provider"
          >
            Use key
          </span>
        )}
        {showPlanAction && !isSelected && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWithSource('subscription');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onSelectWithSource('subscription');
              }
            }}
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-1.5 py-0.5 rounded transition-opacity cursor-pointer"
            title="Use your ChatGPT plan for this OpenAI model"
          >
            Use plan
          </span>
        )}
        {source === 'byok' && (
          <span
            className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded"
            title="Routed through your API key — no Stuard credits used."
          >
            Your key
          </span>
        )}
        {source === 'subscription' && (
          <span
            className="text-[10px] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded"
            title="Routed through your ChatGPT plan — no Stuard credits used."
          >
            ChatGPT
          </span>
        )}
        {isSelected && (
          <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        )}
      </div>
    </button>
  );
};
