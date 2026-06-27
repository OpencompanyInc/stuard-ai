import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Wand2,
  Check,
  Zap,
  Brain,
  ChevronDown,
  Cpu,
  Scale,
  Globe,
} from 'lucide-react';
import type { ModelMeta, ModelSourcePreference, ReasoningLevel, ReasoningEffort, ReasoningControl } from '../hooks/usePreferences';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { useByokStatus } from '../hooks/useByokStatus';
import { clsx } from 'clsx';
import { ModelProviderLogo } from './ModelProviderLogo';

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

// ── Surface tokens ─────────────────────────────────────────────────────────
// The desktop `theme-*` / `primary` classes are plain CSS utilities, so Tailwind
// opacity modifiers on them (e.g. `bg-theme-hover/60`, `bg-primary/[0.08]`) are
// dead no-ops. Tints must go through arbitrary `color-mix` values on the CSS
// vars — which also auto-adapt across surfaces: inside `.launcher-compact-skin`
// and the workflow panel, `--foreground`/`--primary` remap to the compact-pill /
// studio palette (primary = brand red), so the same string reads correctly in
// compact, launcher, window, and Studio.
const ROW_HOVER = 'hover:bg-[color:color-mix(in_srgb,var(--foreground)_6%,transparent)]';
const ROW_ACTIVE = 'bg-[color:color-mix(in_srgb,var(--foreground)_9%,transparent)]';
const ROW_SELECTED = 'bg-[color:color-mix(in_srgb,var(--primary)_10%,transparent)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--primary)_30%,transparent)]';
const ACCENT_TEXT = 'text-[color:var(--primary)]';
const ACCENT_SOFT_TILE = 'bg-[color:color-mix(in_srgb,var(--primary)_13%,transparent)]';
const NEUTRAL_TILE = 'bg-[color:color-mix(in_srgb,var(--foreground)_7%,transparent)]';
const SEG_TRACK = 'bg-[color:color-mix(in_srgb,var(--foreground)_6%,transparent)]';

/** Calm, monochrome provider fallback chip (letter on a neutral tile). Logos
 *  load for nearly every model; this only shows when one is missing, so it stays
 *  quiet rather than introducing a saturated brand color into the list. */
const PROVIDER_FALLBACK_LETTER: Record<string, string> = {
  OpenAI: 'O',
  Google: 'G',
  xAI: 'x',
  DeepSeek: 'D',
  Perplexity: 'P',
  Anthropic: 'A',
  OpenRouter: 'R',
};

function providerFallbackIcon(provider: string | undefined): React.ReactNode {
  const letter = provider ? PROVIDER_FALLBACK_LETTER[provider] : undefined;
  if (letter) {
    return (
      <span className="text-[11px] font-semibold text-theme-muted leading-none">{letter}</span>
    );
  }
  return <Cpu className="w-3.5 h-3.5 text-theme-muted" />;
}

const TIER_DEFAULTS: Record<'fast' | 'balanced' | 'smart' | 'research', string> = {
  fast: 'google/gemini-3.1-flash-lite',
  balanced: 'google/gemini-3.1-pro-preview',
  smart: 'openai/gpt-5.4',
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

/** Compact context-window label: 2000000 → "2M", 1500000 → "1.5M", 128000 → "128k". */
function formatContextWindow(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : +m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
}

// ── Per-model thinking ("reasoning") controls ──────────────────────────────

const REASONING_LADDER: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

const REASONING_LABEL: Record<ReasoningLevel, string> = {
  none: 'Off',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'Max',
};

/** What the Thinking control should offer for the selected model. */
interface ResolvedReasoning {
  show: boolean;        // render the control at all
  canDisable: boolean;  // offer an "Off" choice
  levels: ReasoningEffort[];
  default: ReasoningEffort;
}

const GENERIC_REASONING: ResolvedReasoning = { show: true, canDisable: true, levels: ['low', 'medium', 'high'], default: 'high' };
const NO_REASONING: ResolvedReasoning = { show: false, canDisable: true, levels: [], default: 'high' };

function resolveReasoningFor(model: ModelMeta | null | undefined, selectedModelId: string | 'auto'): ResolvedReasoning {
  // Auto routes to a server-picked model; offer the common tiers.
  if (selectedModelId === 'auto') return GENERIC_REASONING;
  const ctrl: ReasoningControl | undefined = model?.reasoningControl;
  if (ctrl && typeof ctrl.supported === 'boolean') {
    if (!ctrl.supported || ctrl.levels.length === 0) return NO_REASONING;
    return { show: true, canDisable: ctrl.canDisable, levels: ctrl.levels, default: ctrl.default || 'high' };
  }
  // No capability from the registry yet: fall back to the coarse reasoning flag.
  return model?.isReasoning ? GENERIC_REASONING : NO_REASONING;
}

/** Clamp a (possibly stale) global level to what the current model supports. */
function clampReasoning(level: ReasoningLevel, r: ResolvedReasoning): ReasoningLevel {
  if (!r.show) return level;
  if (level === 'none') return r.canDisable ? 'none' : r.default;
  if (r.levels.includes(level as ReasoningEffort)) return level;
  const idx = REASONING_LADDER.indexOf(level as ReasoningEffort);
  for (let i = idx; i >= 0; i--) {
    if (r.levels.includes(REASONING_LADDER[i])) return REASONING_LADDER[i];
  }
  return r.levels[0];
}

function dedupeBrowseModels(models: ModelMeta[]): ModelMeta[] {
  const seen = new Set<string>();
  const out: ModelMeta[] = [];
  for (const model of models) {
    const id = String(model.id || '').toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
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

/**
 * Stuard-served models keep their `openrouter/...` id (the silent transport)
 * even though they're displayed de-branded as the underlying vendor. These are
 * the always-available catalog; native ids (no prefix) are the BYOK surface.
 */
function isStuardServed(model: ModelMeta | null | undefined): boolean {
  return String(model?.id || '').startsWith('openrouter/');
}

/**
 * Canonical identity that collapses a native entry and its Stuard-served twin
 * (e.g. `openai/gpt-5.1` ⇆ `openrouter/openai/gpt-5.1`). OpenRouter `:free`
 * variants are distinct routable models and must stay separate from paid ids.
 */
function canonicalModelKey(id: string): string {
  return String(id || '').replace(/^openrouter\//i, '').toLowerCase();
}

/**
 * Whether the user can route this model through a BYOK key. Native ids are
 * served by their own provider, so they need that provider's key. Stuard-served
 * (`openrouter/...`) ids route through the OpenRouter transport, so a personal
 * OpenRouter key is what overrides them onto the user's own account.
 */
function hasByokForModel(
  model: ModelMeta | null | undefined,
  snap: Pick<ReturnType<typeof useByokStatus>, 'byokProviders'>,
): boolean {
  if (!model) return false;
  if (isStuardServed(model)) return snap.byokProviders.has('openrouter');
  return snap.byokProviders.has(modelProviderId(model));
}

/**
 * A model is offered in the picker when it's reachable:
 *   • Stuard-served catalog (`openrouter/...`) — always, no key needed. This is
 *     the full OpenRouter catalog (GPT, Gemini, Grok, DeepSeek, Qwen, …),
 *     de-branded as the underlying vendor.
 *   • Bare native ids — only with that provider's BYOK key, or (OpenAI) a linked
 *     ChatGPT/Codex plan. When the user has a key, dedupeAcrossSources prefers
 *     this native entry over its Stuard-served twin so they get "Your key".
 */
function isModelSelectable(
  model: ModelMeta | null | undefined,
  snap: ReturnType<typeof useByokStatus>,
): boolean {
  if (!model) return false;
  if (isStuardServed(model)) return true;
  if (snap.byokProviders.has(modelProviderId(model))) return true;
  if (isOpenAIModel(model) && snap.codexReady) return true;
  return false;
}

function sourceBadgeForModel(
  model: ModelMeta | null | undefined,
  source: ModelSourcePreference,
  snap: ReturnType<typeof useByokStatus>,
): 'byok' | 'subscription' | null {
  if (!model) return null;
  if (source === 'api_key') {
    return hasByokForModel(model, snap) ? 'byok' : null;
  }
  if (source === 'subscription') {
    return isOpenAIModel(model) && snap.codexReady ? 'subscription' : null;
  }
  return null;
}

/**
 * Collapse native ↔ Stuard-served twins to a single row. Prefer the native
 * entry when the user can actually use it (own key / plan) so they get the
 * "Your key"/"ChatGPT" affordance; otherwise show the Stuard-served entry.
 */
function dedupeAcrossSources(
  models: ModelMeta[],
  snap: ReturnType<typeof useByokStatus>,
): ModelMeta[] {
  const byKey = new Map<string, ModelMeta>();
  const order: string[] = [];
  for (const model of models) {
    const key = canonicalModelKey(model.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, model);
      order.push(key);
      continue;
    }
    // Prefer whichever twin the user can select; tie-break to native.
    const existingSelectable = isModelSelectable(existing, snap);
    const candidateSelectable = isModelSelectable(model, snap);
    if (candidateSelectable && !existingSelectable) {
      byKey.set(key, model);
    } else if (candidateSelectable === existingSelectable && !isStuardServed(model)) {
      byKey.set(key, model);
    }
  }
  return order.map((k) => byKey.get(k)!).filter(Boolean);
}

const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; extra?: React.ReactNode }> = ({ icon, label, extra }) => (
  <div className="flex items-center gap-1.5 px-2.5 mb-1 mt-0.5">
    <span className="flex-shrink-0">{icon}</span>
    <span className="text-[10px] font-semibold text-theme-muted uppercase tracking-[0.14em]">{label}</span>
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
      const margin = 12;
      const left =
        align === 'center'
          ? rect.left + rect.width / 2 - width / 2
          : align === 'end'
            ? rect.right - width
            : rect.left;

      // Clamp the panel to the room actually available, and flip to the side
      // with more space when the preferred side is too cramped, so the panel
      // never spills past the top/bottom of the viewport.
      const spaceAbove = rect.top - margin;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      let effectiveSide = side;
      if (side === 'top' && spaceAbove < 320 && spaceBelow > spaceAbove) effectiveSide = 'bottom';
      else if (side === 'bottom' && spaceBelow < 320 && spaceAbove > spaceBelow) effectiveSide = 'top';

      const available = effectiveSide === 'top' ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(240, Math.min(520, available));

      setPortalStyle({
        position: 'fixed',
        width,
        maxHeight,
        left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
        ...(effectiveSide === 'top'
          ? { top: rect.top - margin, transform: 'translateY(-100%)' }
          : { top: rect.bottom + margin }),
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

  // Collapse native ↔ Stuard-served twins to one row each, then keep only the
  // models the user can actually route to: the Stuard-served catalog (always)
  // plus native ids unlocked by a BYOK key / ChatGPT plan.
  const selectableModels = useMemo(
    () => dedupeAcrossSources(ALL_MODELS, byokStatus).filter((m) => isModelSelectable(m, byokStatus)),
    [ALL_MODELS, byokStatus],
  );

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return selectableModels;
    return selectableModels.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }, [search, selectableModels]);

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

  // On open, focus the search and jump the highlight to the model that's already
  // selected so it's visible (and scrolled into view) rather than always landing
  // on the first row.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      const idx = allVisibleItems.findIndex((it) => it.id === selectedModelId);
      setActiveIndex(idx >= 0 ? idx : 0);
    } else {
      setSearch('');
    }
    // Intentionally only on open/close — re-running while typing would yank the
    // keyboard highlight around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  // Thinking controls adapt to the selected model: which tiers it exposes,
  // whether it can be turned off, and what a stale global level resolves to.
  const reasoning = useMemo(
    () => resolveReasoningFor(selectedModel, selectedModelId),
    [selectedModel, selectedModelId],
  );
  const effectiveReasoning = useMemo(
    () => clampReasoning(reasoningLevel, reasoning),
    [reasoningLevel, reasoning],
  );
  const reasoningButtons = useMemo<ReasoningLevel[]>(
    () => [...(reasoning.canDisable ? (['none'] as ReasoningLevel[]) : []), ...reasoning.levels],
    [reasoning],
  );

  const handleSelect = (id: string | 'auto') => {
    if (id === 'auto' && modelSource !== 'stuard') {
      onModelSourceChange?.('stuard');
    } else if (modelSource === 'subscription') {
      const nextModel = ALL_MODELS.find(m => m.id === id);
      if (!isOpenAIModel(nextModel)) onModelSourceChange?.('stuard');
    } else if (modelSource === 'api_key') {
      const nextModel = ALL_MODELS.find(m => m.id === id);
      if (nextModel && !hasByokForModel(nextModel, byokStatus)) onModelSourceChange?.('stuard');
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
        : !selectedModel || !hasByokForModel(selectedModel, byokStatus),
      title: selectedModelId === 'auto'
        ? 'Pick a specific model to route through your API key.'
        : !selectedModel
          ? 'Unknown model.'
          : hasByokForModel(selectedModel, byokStatus)
            ? byokStatus.byokProviders.has(modelProviderId(selectedModel))
              ? `Route through your ${selectedModel.provider} API key — no Stuard credits used.`
              : `Route through your OpenRouter API key — no Stuard credits used.`
            : `Add a ${selectedModel.provider} or OpenRouter API key in Settings to enable this.`,
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

  const wfSurfaceTheme = useMemo(() => {
    if (typeof document === 'undefined') return undefined;
    const attr = document.querySelector('[data-wf-theme]')?.getAttribute('data-wf-theme');
    return attr === 'dark' || attr === 'light' ? attr : undefined;
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx(
          'model-selector-trigger flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-[12px] transition-colors cursor-pointer outline-none group',
          'hover:bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)]',
          open && 'bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)]',
          className,
        )}
      >
        <div className="relative w-5 h-5 flex items-center justify-center flex-shrink-0">
          {selectedModel?.logoUrl ? (
            <ModelProviderLogo
              src={selectedModel.logoUrl}
              alt={selectedModel.provider}
              providerId={selectedModel.providerId}
              className="w-4 h-4"
            />
          ) : (
            selectedModel ? (
              providerFallbackIcon(selectedModel.provider)
            ) : (
              <Wand2 className={clsx('w-3.5 h-3.5', ACCENT_TEXT)} />
            )
          )}
          {selectedSource && (
            <span
              className={clsx(
                'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-[color:var(--card-bg)]',
                selectedSource === 'byok' ? 'bg-emerald-500' : 'bg-cyan-500',
              )}
              title={selectedSource === 'byok'
                ? 'Routed through your API key.'
                : 'Routed through your ChatGPT plan.'}
            />
          )}
        </div>
        <span className="text-[12px] font-medium text-theme-muted truncate max-w-[110px] group-hover:text-theme-fg transition-colors">
          {selectedModelName}
        </span>
        {reasoning.show && effectiveReasoning !== 'high' && (
          <span
            className={clsx(
              'text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded-md leading-none',
              effectiveReasoning === 'none'
                ? 'text-theme-muted bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)]'
                : clsx(ACCENT_TEXT, 'bg-[color:color-mix(in_srgb,var(--primary)_12%,transparent)]'),
            )}
            title={`Thinking: ${effectiveReasoning}`}
          >
            {REASONING_LABEL[effectiveReasoning]}
          </span>
        )}
        <ChevronDown className={clsx('w-3 h-3 text-theme-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (() => {
        const panel = (
          <div
            ref={panelRef}
            data-wf-theme={wfSurfaceTheme}
            className={clsx(
              // Height cap lives in CSS on .model-selector-panel (robust against
              // Tailwind JIT missing the arbitrary min()/calc() value). Non-portal
              // (launcher + window) uses that cap; portal callers override it with
              // an inline maxHeight computed from the available viewport space.
              'z-[10005] model-selector-panel rounded-[20px] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 shadow-2xl',
              variant === 'glass'
                ? 'bg-[color:color-mix(in_srgb,var(--card-bg)_85%,transparent)] backdrop-blur-2xl'
                : 'bg-[color:color-mix(in_srgb,var(--card-bg)_97%,transparent)] backdrop-blur-xl',
              portal
                ? 'fixed'
                : [
                    'absolute',
                    side === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5',
                    align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
                  ]
            )}
            style={portal ? portalStyle : { width: panelWidth }}
          >
            {/* Search header */}
            <div className="p-2 border-b border-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted pointer-events-none" />
                <input
                  ref={inputRef}
                  className="w-full pl-9 pr-3 py-2.5 rounded-[12px] text-[13px] text-theme-fg bg-[color:color-mix(in_srgb,var(--foreground)_5%,transparent)] placeholder:text-theme-muted outline-none border border-transparent font-normal transition-colors focus:bg-[color:color-mix(in_srgb,var(--foreground)_7%,transparent)] focus:border-[color:color-mix(in_srgb,var(--primary)_38%,transparent)]"
                  placeholder="Search models, providers…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {search ? (
                <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 custom-scrollbar">
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
                      <div className={clsx('w-11 h-11 rounded-[14px] flex items-center justify-center mx-auto mb-3', NEUTRAL_TILE)}>
                        <Search className="w-4 h-4 text-theme-muted" />
                      </div>
                      <p className="text-[13px] font-medium text-theme-fg mb-1">No matches</p>
                      <p className="text-[11px] text-theme-muted">
                        Nothing for "<span className="text-theme-fg">{search}</span>". Try a provider name or model family.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div ref={scrollRef} className="flex-1 min-h-0 p-1.5 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
                  {/* Auto router */}
                  <button
                    onClick={() => handleSelect('auto')}
                    data-index={0}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-2 py-2 rounded-[14px] transition-colors text-left',
                      selectedModelId === 'auto'
                        ? ROW_SELECTED
                        : activeIndex === 0
                          ? ROW_ACTIVE
                          : ROW_HOVER,
                    )}
                  >
                    <div className={clsx('w-8 h-8 rounded-[11px] flex items-center justify-center flex-shrink-0', ACCENT_SOFT_TILE)}>
                      <Wand2 className={clsx('w-4 h-4', ACCENT_TEXT)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-theme-fg leading-tight">Automatic</div>
                      <div className="text-[11px] text-theme-muted truncate mt-0.5">Best model picked for each task</div>
                    </div>
                    {selectedModelId === 'auto' && <Check className={clsx('w-4 h-4 flex-shrink-0', ACCENT_TEXT)} />}
                  </button>

                  {/* No specific models to list: the user has no API key, so the
                      Stuard "Automatic" default (above) is the only route. */}
                  {selectableModels.length === 0 && (
                    <div className="px-3 py-3 text-center">
                      <p className="text-[11px] text-theme-muted leading-relaxed">
                        Stuard automatically picks the best model for each task.
                        <br />
                        Add a provider API key in <span className="text-theme-fg">Settings</span> to choose a specific one.
                      </p>
                    </div>
                  )}

                  {grouped.openai.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <SectionHeader
                        icon={<Wand2 className="w-3 h-3 text-cyan-500" />}
                        label="ChatGPT plan"
                        extra={byokStatus.codexAccountEmail && (
                          <span className="text-[10px] text-theme-muted font-normal normal-case tracking-normal truncate">
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
                      <SectionHeader icon={<Zap className="w-3 h-3 text-amber-500" />} label="Fast & efficient" />
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
                      <SectionHeader icon={<Scale className="w-3 h-3 text-emerald-500" />} label="Balanced" />
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
                      <SectionHeader icon={<Brain className="w-3 h-3 text-violet-500" />} label="Intelligence" />
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
                      <SectionHeader icon={<Globe className="w-3 h-3 text-sky-500" />} label="Research" />
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
            <div className="px-2.5 py-2.5 border-t border-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] bg-[color:color-mix(in_srgb,var(--foreground)_3%,transparent)] flex flex-col gap-2">
              {onModelSourceChange && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-theme-muted uppercase tracking-[0.14em] w-[58px] flex-shrink-0">
                    Routing
                  </span>
                  <div className={clsx('flex-1 flex items-center rounded-[12px] p-1 gap-1', SEG_TRACK)}>
                    {sourceOptions.map((opt) => {
                      const active = modelSource === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={opt.disabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!opt.disabled) onModelSourceChange(opt.value);
                          }}
                          className={clsx(
                            'flex-1 px-2 py-1 rounded-[8px] text-[11px] font-medium transition-colors text-center',
                            active
                              ? opt.value === 'api_key'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : opt.value === 'subscription'
                                  ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                                  : 'bg-theme-card text-theme-fg shadow-sm'
                              : opt.disabled
                                ? 'text-theme-muted opacity-40 cursor-not-allowed'
                                : 'text-theme-muted hover:text-theme-fg',
                          )}
                          title={opt.title}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Thinking depth — only the tiers this model actually exposes.
                  Hidden entirely for models that don't reason. */}
              {reasoning.show && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-theme-muted uppercase tracking-[0.14em] w-[58px] flex-shrink-0">
                    Thinking
                  </span>
                  <div className={clsx('flex-1 flex items-center rounded-[12px] p-1 gap-1', SEG_TRACK)}>
                    {reasoningButtons.map((level) => {
                      const active = effectiveReasoning === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReasoningLevelChange?.(level);
                          }}
                          className={clsx(
                            'flex-1 px-2 py-1 rounded-[8px] text-[11px] font-medium transition-colors text-center',
                            active
                              ? level === 'none'
                                ? 'bg-theme-card text-theme-fg shadow-sm'
                                : clsx(ACCENT_SOFT_TILE, ACCENT_TEXT)
                              : 'text-theme-muted hover:text-theme-fg',
                          )}
                          title={level === 'none' ? 'Disable thinking' : `Thinking depth: ${REASONING_LABEL[level]}`}
                        >
                          {REASONING_LABEL[level]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-3 text-[10px] text-theme-muted">
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono">↑↓</kbd>
                    <span>nav</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono">↵</kbd>
                    <span>select</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="font-mono">esc</kbd>
                    <span>close</span>
                  </span>
                </div>
                <div className="text-[10px] text-theme-muted">
                  {selectableModels.length} models
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
  const byokAvailable = hasByokForModel(model, byokStatus);
  const codexAvailable = isOpenAIModel(model) && byokStatus.codexReady;
  const showByokAction = byokAvailable && currentSource !== 'api_key';
  const showPlanAction = codexAvailable && currentSource !== 'subscription';

  return (
    <button
      data-index={index}
      onClick={onClick}
      className={clsx(
        'group/row w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[14px] text-left transition-colors relative',
        isSelected
          ? ROW_SELECTED
          : isActive
            ? ROW_ACTIVE
            : ROW_HOVER,
      )}
    >
      <div className={clsx('w-8 h-8 rounded-[11px] flex items-center justify-center flex-shrink-0', NEUTRAL_TILE)}>
        {model.logoUrl ? (
          <ModelProviderLogo
            src={model.logoUrl}
            alt={model.provider}
            providerId={model.providerId}
            className="w-4 h-4"
          />
        ) : (
          providerFallbackIcon(model.provider)
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-theme-fg truncate leading-tight">{model.name}</span>
          {model.isReasoning && (
            <span title="Reasoning-capable model" className="flex-shrink-0">
              <Brain className="w-3 h-3 text-violet-500" aria-label="Reasoning model" />
            </span>
          )}
        </div>
        <div className="text-[11px] text-theme-muted truncate mt-0.5">
          {model.provider}
          {model.contextWindow ? ` · ${formatContextWindow(model.contextWindow)} context` : ''}
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
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded-md transition-opacity cursor-pointer"
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
            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-1.5 py-0.5 rounded-md transition-opacity cursor-pointer"
            title="Use your ChatGPT plan for this OpenAI model"
          >
            Use plan
          </span>
        )}
        {source === 'byok' && (
          <span
            className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded-md"
            title="Routed through your API key — no Stuard credits used."
          >
            Your key
          </span>
        )}
        {source === 'subscription' && (
          <span
            className="text-[10px] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-md"
            title="Routed through your ChatGPT plan — no Stuard credits used."
          >
            ChatGPT
          </span>
        )}
        {isSelected && (
          <Check className={clsx('w-4 h-4 flex-shrink-0', ACCENT_TEXT)} />
        )}
      </div>
    </button>
  );
};
