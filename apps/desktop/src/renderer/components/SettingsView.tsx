import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_CHAT_MODELS, type ChatModelsConfig, type ModelMeta, type ThemeMode, type TonePreset } from "../hooks/usePreferences";
import { RefreshCw, Download, ArrowUpCircle, CheckCircle, AlertCircle, Loader2, FlaskConical, Beaker, RotateCcw, X, Cloud, CloudOff, Shield, Lock, Eye, EyeOff, Key, Archive, Settings, Palette, Zap, CreditCard, Brain, Scale, Cpu, ChevronDown, Check, Search, History, Folder, SlidersHorizontal, MessageSquare } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { invalidateRendererSyncPrefsCache } from "../utils/syncPrefs";
import { clsx } from "clsx";
import { BillingSettings } from "./BillingSettings";
import { useModelRegistry } from "../hooks/useModelRegistry";
import { ApiKeysSection } from "./settings/ApiKeysSection";
import { GlobalHotkeySection } from "./settings/GlobalHotkeySection";
import { CheckpointsSection } from "./settings/CheckpointsSection";
import { FileIndexSettings } from "./FileIndexSettings";
import { ModelProviderLogo } from "./ModelProviderLogo";
import { isUpdateActionable, useUpdateStatus } from "../hooks/useUpdateStatus";

type UpdateChannel = "stable" | "beta" | "staging";
type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error" | "up-to-date";

interface UpdateState {
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
  apiEndpoint?: string;
}

const CHANNEL_INFO: Record<UpdateChannel, { color: string; bgColor: string; borderColor: string; label: string; apiUrl: string }> = {
  stable: { color: "text-emerald-600 dark:text-emerald-400", bgColor: "bg-emerald-500/5", borderColor: "border-emerald-500/50", label: "Stable", apiUrl: "api.stuard.ai" },
  beta: { color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-500/5", borderColor: "border-amber-500/50", label: "Beta", apiUrl: "beta-api.stuard.ai" },
  staging: { color: "text-primary", bgColor: "bg-primary/5", borderColor: "border-primary/50", label: "Staging", apiUrl: "staging-api.stuard.ai" },
};

interface BetaAccess {
  hasBetaAccess: boolean;
  hasStagingAccess: boolean;
  loading: boolean;
}

interface SettingsViewProps {
  /** Deep-link focus from the dashboard (e.g. { id: 'updates' }); object
   *  identity re-applies the focus on repeat navigations. */
  focusTab?: { id: string } | null;
  themeMode: ThemeMode;
  setThemeMode: (v: ThemeMode) => void;
  themeDarkShade: string;
  setThemeDarkShade: (v: string) => void;
  themeLightShade: string;
  setThemeLightShade: (v: string) => void;
  themeText: "white" | "black";
  setThemeText: (v: "white" | "black") => void;
  wakewordEnabled: boolean;
  setWakewordEnabled: (v: boolean) => void;
  screenCaptureInvisible: boolean;
  setScreenCaptureInvisible: (v: boolean) => void;
  handleSaveTheme: () => void;
  tone: TonePreset;
  setTone: (t: TonePreset) => void;
  customTone: string;
  setCustomTone: (v: string) => void;
  personaDraft: string;
  setPersonaDraft: (v: string) => void;
  persona: string | null;
  handleSaveTonePersona: () => void;
  setOnboardingComplete: (v: boolean) => void;
  chatModels: ChatModelsConfig;
  setChatModels: (v: ChatModelsConfig) => void;
}

const SectionHeader = ({
  icon, eyebrow, title, description, action,
}: {
  icon?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="mb-6 flex items-start justify-between gap-4 border-b border-theme-sidebar pb-4">
    <div className="flex min-w-0 items-start gap-3">
      {icon && (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-theme-muted/70">{eyebrow}</p>
        )}
        <h3 className="text-[18px] font-semibold font-stuard text-theme-fg tracking-tight">{title}</h3>
        <p className="mt-1 text-[13px] text-theme-muted font-medium">{description}</p>
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

interface SegmentedOption { value: string; label: string }
const SegmentedControl: React.FC<{
  value: string;
  options: SegmentedOption[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="inline-flex items-center gap-0.5 rounded-xl border border-theme bg-theme-hover/40 p-0.5">
    {options.map((opt) => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "px-3.5 py-1.5 rounded-[10px] text-[12px] font-semibold tracking-tight transition-all",
            active
              ? "bg-theme-card text-theme-fg shadow-sm border border-theme-sidebar"
              : "text-theme-muted hover:text-theme-fg"
          )}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const ColorField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="block text-[11px] font-semibold text-theme-muted mb-1.5 tracking-tight">{label}</label>
    <div className="flex items-center gap-2 p-1 rounded-xl border border-theme bg-theme-card">
      <div
        className="relative w-8 h-8 rounded-lg overflow-hidden border border-theme shrink-0"
        style={{ backgroundColor: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="flex-1 bg-transparent text-[12px] font-mono font-semibold text-theme-fg outline-none uppercase tracking-wide"
      />
    </div>
  </div>
);

const TONE_OPTIONS: SegmentedOption[] = [
  { value: "concise", label: "Concise" },
  { value: "friendly", label: "Friendly" },
  { value: "formal", label: "Formal" },
  { value: "technical", label: "Technical" },
  { value: "custom", label: "Custom" },
];

// Modern pill-style toggle switch
const Toggle = ({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed",
      checked ? "bg-primary" : "bg-theme-active/70 border border-theme"
    )}
  >
    <span className={clsx(
      "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
      checked ? "translate-x-[1.15rem]" : "translate-x-0.5"
    )} />
  </button>
);

// Standard settings row with toggle on the right
const ToggleRow = ({
  icon, title, description, checked, onChange, disabled, accent,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  accent?: boolean;
}) => (
  <div className={clsx(
    "flex items-center gap-4 p-4 rounded-xl border transition-colors",
    accent ? "bg-primary/5 border-primary/20" : checked ? "bg-theme-hover/70 border-theme-sidebar" : "bg-theme-hover/40 border-theme hover:border-theme"
  )}>
    <div className="flex items-center gap-2.5 min-w-0 flex-1">
      {icon && <span className={clsx("flex-shrink-0", checked ? "text-primary" : "text-theme-muted")}>{icon}</span>}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-theme-fg tracking-tight">{title}</div>
        {description && <p className="text-[11px] text-theme-muted mt-0.5 leading-relaxed">{description}</p>}
      </div>
    </div>
    <Toggle checked={checked} onChange={onChange} disabled={disabled} />
  </div>
);

type AutoModelTier = keyof ChatModelsConfig;

const AUTO_MODEL_TIERS: Array<{
  id: AutoModelTier;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  {
    id: "smart",
    label: "Smart",
    description: "Deep reasoning, planning, and complex work.",
    icon: <Brain className="w-4 h-4" />,
    accent: "text-purple-500 bg-purple-500/10",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Everyday chats with a good quality and speed mix.",
    icon: <Scale className="w-4 h-4" />,
    accent: "text-emerald-500 bg-emerald-500/10",
  },
  {
    id: "fast",
    label: "Fast",
    description: "Low-latency responses and lightweight tasks.",
    icon: <Zap className="w-4 h-4" />,
    accent: "text-amber-500 bg-amber-500/10",
  },
];

function normalizeChatModelsConfig(cfg?: ChatModelsConfig | null): ChatModelsConfig {
  const source = cfg || DEFAULT_CHAT_MODELS;
  return {
    fast: {
      allowed: Array.isArray(source.fast?.allowed) ? [...source.fast.allowed] : [],
      default: typeof source.fast?.default === "string" && source.fast.default.trim()
        ? source.fast.default.trim()
        : DEFAULT_CHAT_MODELS.fast.default,
    },
    balanced: {
      allowed: Array.isArray(source.balanced?.allowed) ? [...source.balanced.allowed] : [],
      default: typeof source.balanced?.default === "string" && source.balanced.default.trim()
        ? source.balanced.default.trim()
        : DEFAULT_CHAT_MODELS.balanced.default,
    },
    smart: {
      allowed: Array.isArray(source.smart?.allowed) ? [...source.smart.allowed] : [],
      default: typeof source.smart?.default === "string" && source.smart.default.trim()
        ? source.smart.default.trim()
        : DEFAULT_CHAT_MODELS.smart.default,
    },
  };
}

const PROVIDER_FALLBACK_TILES: Record<string, { letter: string; bg: string }> = {
  OpenAI: { letter: "O", bg: "bg-emerald-500" },
  Google: { letter: "G", bg: "bg-blue-500" },
  xAI: { letter: "x", bg: "bg-black" },
  DeepSeek: { letter: "D", bg: "bg-blue-600" },
  Perplexity: { letter: "P", bg: "bg-cyan-500" },
  Anthropic: { letter: "A", bg: "bg-orange-500" },
  OpenRouter: { letter: "R", bg: "bg-purple-500" },
};

function ProviderTile({ model, size = 24 }: { model?: ModelMeta; size?: number }) {
  const dim = { width: size, height: size };
  if (model?.logoUrl) {
    return (
      <div
        className="rounded-md bg-theme-card border border-theme-sidebar flex items-center justify-center overflow-hidden flex-shrink-0"
        style={dim}
      >
        <ModelProviderLogo
          src={model.logoUrl}
          alt={model.provider}
          providerId={model.providerId}
          style={{ width: size - 8, height: size - 8 }}
        />
      </div>
    );
  }
  const fallback = model ? PROVIDER_FALLBACK_TILES[model.provider] : undefined;
  if (fallback) {
    return (
      <div
        className={clsx("rounded-md flex items-center justify-center text-white font-bold flex-shrink-0", fallback.bg)}
        style={{ ...dim, fontSize: Math.max(10, Math.floor(size * 0.5)) }}
      >
        {fallback.letter}
      </div>
    );
  }
  return (
    <div
      className="rounded-md bg-theme-hover border border-theme-sidebar flex items-center justify-center flex-shrink-0"
      style={dim}
    >
      <Cpu className="text-theme-muted" style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}

interface ModelDropdownProps {
  value: string;
  options: ModelMeta[];
  modelById: Map<string, ModelMeta>;
  onChange: (id: string) => void;
  tierLabel: string;
}

function ModelDropdown({ value, options, modelById, onChange, tierLabel }: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const selected = modelById.get(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    );
  }, [options, query]);

  // Group filtered models by provider for cleaner browsing
  const grouped = useMemo(() => {
    const groups = new Map<string, ModelMeta[]>();
    for (const m of filtered) {
      const arr = groups.get(m.provider) || [];
      arr.push(m);
      groups.set(m.provider, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const flatList = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIdx(0);
      return;
    }
    const margin = 12;
    const gap = 8;
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const panelW = Math.max(r.width, 320);
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;
      const available = Math.max(200, (openUp ? spaceAbove : spaceBelow) - gap);
      const panelMaxHeight = Math.min(480, available, window.innerHeight - margin * 2);
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - panelW - margin));
      const top = openUp
        ? Math.max(margin, r.top - gap - panelMaxHeight)
        : Math.min(window.innerHeight - margin - panelMaxHeight, r.bottom + gap);
      setPos({
        position: "fixed",
        left,
        top,
        width: panelW,
        maxHeight: panelMaxHeight,
        zIndex: 10010,
      });
    };
    update();
    setTimeout(() => inputRef.current?.focus(), 30);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (flatList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flatList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + flatList.length) % flatList.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = flatList[activeIdx];
      if (m) handleSelect(m.id);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "w-full flex items-center gap-2.5 rounded-xl border bg-theme-card px-2.5 py-2 text-left transition-all outline-none",
          open
            ? "border-primary/50 ring-2 ring-primary/15"
            : "border-theme hover:border-theme hover:bg-theme-hover/40"
        )}
      >
        <ProviderTile model={selected} size={26} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-theme-fg truncate leading-tight">
            {selected?.name || value}
          </div>
          <div className="text-[10px] text-theme-muted font-medium truncate leading-tight mt-0.5">
            {selected?.provider || "Unknown provider"}
            {selected?.contextWindow ? ` · ${Math.round(selected.contextWindow / 1000)}k ctx` : ""}
          </div>
        </div>
        <ChevronDown
          className={clsx(
            "w-3.5 h-3.5 text-theme-muted shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={pos}
            className="rounded-2xl border border-theme bg-theme-card/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col min-h-0 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 border-b border-theme-sidebar bg-theme-hover/30">
              <div className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">
                {tierLabel} model
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="shrink-0 px-2.5 pt-2.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search models, providers..."
                  className="w-full pl-8 pr-2.5 py-2 bg-theme-hover/50 border border-theme-sidebar rounded-xl text-[12px] font-medium text-theme-fg placeholder:text-theme-muted outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 memory-context-scrollbar">
              {grouped.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-[12px] text-theme-muted font-medium">No matches for "{query}"</div>
                </div>
              ) : (
                grouped.map(([provider, list]) => (
                  <div key={provider} className="mb-2 last:mb-0">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-theme-muted/70">
                      {provider}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {list.map((m) => {
                        const isSelected = m.id === value;
                        const flatIdx = flatList.indexOf(m);
                        const isActive = flatIdx === activeIdx;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onMouseEnter={() => setActiveIdx(flatIdx)}
                            onClick={() => handleSelect(m.id)}
                            className={clsx(
                              "w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors",
                              isActive
                                ? "bg-primary/10"
                                : "hover:bg-theme-hover/60"
                            )}
                          >
                            <ProviderTile model={m} size={22} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[12px] font-semibold text-theme-fg truncate leading-tight">
                                  {m.name}
                                </span>
                                {m.isReasoning && (
                                  <span className="px-1 py-0 rounded text-[8px] font-bold uppercase tracking-wider text-purple-500 bg-purple-500/10 leading-tight">
                                    Pro
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-theme-muted font-medium truncate leading-tight mt-0.5">
                                {m.id}
                                {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k` : ""}
                              </div>
                            </div>
                            {isSelected && (
                              <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Check className="w-2.5 h-2.5 text-primary-fg" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="shrink-0 px-3 py-2 border-t border-theme-sidebar bg-theme-hover/20 text-[10px] text-theme-muted font-medium flex items-center justify-between">
              <span>↑↓ navigate · ↵ select · esc close</span>
              <span>{flatList.length} model{flatList.length === 1 ? "" : "s"}</span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function AutoModelRoutingSection({
  chatModels,
  onChatModelsChange,
}: {
  chatModels: ChatModelsConfig;
  onChatModelsChange: (v: ChatModelsConfig) => void;
}) {
  const { models, modelById, loading, error } = useModelRegistry();
  const normalized = useMemo(() => normalizeChatModelsConfig(chatModels), [chatModels]);
  const modelsByTier = useMemo(() => {
    const rank: Record<string, number> = { smart: 0, balanced: 1, fast: 2, research: 3 };
    const sortModels = (tier: AutoModelTier) => [...models].sort((a, b) => {
      const aPreferred = a.category === tier ? 0 : 1;
      const bPreferred = b.category === tier ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      const byTier = (rank[a.category] ?? 9) - (rank[b.category] ?? 9);
      if (byTier !== 0) return byTier;
      const byProvider = a.provider.localeCompare(b.provider);
      if (byProvider !== 0) return byProvider;
      return a.name.localeCompare(b.name);
    });
    return {
      fast: sortModels("fast"),
      balanced: sortModels("balanced"),
      smart: sortModels("smart"),
    };
  }, [models]);

  const updateTierDefault = (tier: AutoModelTier, modelId: string) => {
    const next = normalizeChatModelsConfig(chatModels);
    onChatModelsChange({
      ...next,
      [tier]: {
        ...next[tier],
        default: modelId,
      },
    });
  };

  return (
    <div className="dashboard-card p-6">
      <SectionHeader
        icon={<Scale className="w-4 h-4" />}
        eyebrow="Assistant"
        title="Auto Model Routing"
        description="Pick which model Auto picks for each tier of task."
        action={
          <button
            onClick={() => onChatModelsChange(normalizeChatModelsConfig(DEFAULT_CHAT_MODELS))}
            className="flex items-center gap-1.5 rounded-full border border-theme bg-theme-hover/50 px-3 py-2 text-[11px] font-semibold text-theme-muted transition-all hover:bg-theme-hover hover:text-theme-fg"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {AUTO_MODEL_TIERS.map((tier) => {
          const selectedId = normalized[tier.id].default;
          const selectedModel = modelById.get(selectedId);
          const tierModels = modelsByTier[tier.id];
          const hasSelectedOption = tierModels.some((m) => m.id === selectedId);
          const options = hasSelectedOption || !selectedModel
            ? tierModels
            : [selectedModel, ...tierModels];

          return (
            <div key={tier.id} className="p-4 rounded-xl border border-theme bg-theme-hover/40 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className={clsx("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", tier.accent)}>
                  {tier.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-theme-fg tracking-tight">{tier.label}</div>
                  <p className="text-[11px] text-theme-muted leading-relaxed font-medium mt-0.5">{tier.description}</p>
                </div>
              </div>

              <ModelDropdown
                value={selectedId}
                options={options}
                modelById={modelById}
                onChange={(id) => updateTierDefault(tier.id, id)}
                tierLabel={tier.label}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-theme-muted font-medium">
        <Cpu className="w-3.5 h-3.5" />
        <span>
          {loading ? "Refreshing model list..." : error ? "Using fallback model list." : "Auto routing applies to new requests."}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Security & Privacy Section
// ─────────────────────────────────────────────────────────────────────────────

function SecurityPrivacySection() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<{
    memory_lock_enabled: boolean;
    vault_lock_enabled: boolean;
    lock_timeout_minutes: number;
    has_password: boolean;
  }>({ memory_lock_enabled: false, vault_lock_enabled: false, lock_timeout_minutes: 5, has_password: false });
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const res = await window.desktopAPI?.securityGetSettings?.();
      if (res?.ok && res.settings) {
        setSettings({
          memory_lock_enabled: res.settings.memory_lock_enabled,
          vault_lock_enabled: res.settings.vault_lock_enabled,
          lock_timeout_minutes: res.settings.lock_timeout_minutes,
          has_password: res.settings.has_password,
        });
      }
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleToggle = async (key: 'vault_lock_enabled' | 'memory_lock_enabled', value: boolean) => {
    if (value && !settings.has_password) {
      setShowSetPassword(true);
      return;
    }
    try {
      await window.desktopAPI?.securityUpdateSettings?.({ [key]: value });
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch { }
  };

  const handleSetPassword = async () => {
    if (!newPw || newPw.length < 4) { setPwError("Password must be at least 4 characters"); return; }
    if (newPw !== confirmPw) { setPwError("Passwords don't match"); return; }
    setSaving(true);
    setPwError("");
    try {
      const res = await window.desktopAPI?.securitySetPassword?.(newPw, settings.has_password ? currentPw : undefined);
      if (res?.ok) {
        setSettings(prev => ({ ...prev, has_password: true }));
        setShowSetPassword(false);
        setShowChangePassword(false);
        setNewPw(""); setConfirmPw(""); setCurrentPw("");
        setSuccess("Password saved");
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setPwError(res?.error === 'invalid_current_password' ? 'Current password is incorrect' : (res?.error || 'Failed to set password'));
      }
    } catch {
      setPwError("Failed to set password");
    }
    setSaving(false);
  };

  const handleRemovePassword = async () => {
    if (!currentPw) { setPwError("Enter current password"); return; }
    setSaving(true);
    setPwError("");
    try {
      const res = await window.desktopAPI?.securityRemovePassword?.(currentPw);
      if (res?.ok) {
        setSettings(prev => ({ ...prev, has_password: false, vault_lock_enabled: false, memory_lock_enabled: false }));
        setShowChangePassword(false);
        setCurrentPw(""); setNewPw(""); setConfirmPw("");
        setSuccess("Password removed");
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setPwError(res?.error === 'invalid_current_password' ? 'Current password is incorrect' : (res?.error || 'Failed'));
      }
    } catch {
      setPwError("Failed");
    }
    setSaving(false);
  };

  const handleTimeoutChange = async (minutes: number) => {
    try {
      await window.desktopAPI?.securityUpdateSettings?.({ lock_timeout_minutes: minutes });
      setSettings(prev => ({ ...prev, lock_timeout_minutes: minutes }));
    } catch { }
  };

  if (loading) return null;

  const inputCls = "w-full bg-theme-hover border border-theme rounded-xl px-3 py-2.5 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all";

  return (
    <div className="max-w-4xl space-y-6">
        {/* Password Management */}
        <div className="dashboard-card p-6">
          <SectionHeader icon={<Shield className="w-4 h-4" />} eyebrow="Privacy" title="Security & Privacy" description="Protect your vault credentials and conversation history with a password." />

          <div className="mb-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-theme-hover border border-theme">
              <div className="flex items-center gap-3">
                <div className={clsx("p-2 rounded-xl", settings.has_password ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400")}>
                  {settings.has_password ? <Shield className="w-5 h-5" /> : <Key className="w-5 h-5" />}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-theme-fg">
                    {settings.has_password ? "Security Password Set" : "No Security Password"}
                  </div>
                  <div className="text-[11px] text-theme-muted">
                    {settings.has_password ? "Used to protect Vault and Memories." : "Set a password to enable lock features."}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.has_password && (
                  <button
                    onClick={() => { setShowChangePassword(true); setShowSetPassword(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border border-theme text-theme-muted hover:text-theme-fg hover:border-theme transition-all"
                  >
                    Change
                  </button>
                )}
                <button
                  onClick={() => { setShowSetPassword(true); setShowChangePassword(false); setPwError(""); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-fg hover:opacity-90 transition-all"
                >
                  {settings.has_password ? "Update" : "Set Password"}
                </button>
              </div>
            </div>

            {success && (
              <div className="mt-2 flex items-center gap-2 text-xs font-bold text-emerald-400">
                <CheckCircle className="w-3.5 h-3.5" /> {success}
              </div>
            )}
          </div>

          {(showSetPassword || showChangePassword) && (
            <div className="mb-6 p-4 rounded-xl bg-theme-hover border border-primary/20 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-theme-fg flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  {showChangePassword && settings.has_password ? "Change Password" : "Set Security Password"}
                </h4>
                <button onClick={() => { setShowSetPassword(false); setShowChangePassword(false); setPwError(""); }} className="p-1 rounded-lg text-theme-muted hover:text-theme-fg">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {settings.has_password && (
                <div>
                  <label className="text-xs font-semibold text-theme-muted mb-1 block">Current Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      className={clsx(inputCls, "pr-9")}
                      value={currentPw}
                      onChange={e => setCurrentPw(e.target.value)}
                      placeholder="Enter current password"
                    />
                    <button onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-fg">
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-theme-muted mb-1 block">New Password</label>
                <input type={showPw ? "text" : "password"} className={inputCls} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="At least 4 characters" />
              </div>
              <div>
                <label className="text-xs font-semibold text-theme-muted mb-1 block">Confirm Password</label>
                <input type={showPw ? "text" : "password"} className={inputCls} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter password" />
              </div>

              {pwError && <p className="text-xs text-red-400 font-medium">{pwError}</p>}

              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSetPassword} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50 transition-all">
                  {saving ? "Saving..." : "Save Password"}
                </button>
                {showChangePassword && settings.has_password && (
                  <button onClick={handleRemovePassword} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all">
                    Remove Password
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <ToggleRow
              icon={<Shield className="w-4 h-4" />}
              title="Lock Vault"
              description="Require password to view credentials in the Security Vault."
              checked={settings.vault_lock_enabled}
              onChange={v => handleToggle('vault_lock_enabled', v)}
            />
            <ToggleRow
              icon={<Archive className="w-4 h-4" />}
              title="Lock Memories"
              description="Require password to view conversation history and memories."
              checked={settings.memory_lock_enabled}
              onChange={v => handleToggle('memory_lock_enabled', v)}
            />

            {(settings.vault_lock_enabled || settings.memory_lock_enabled) && (
              <div className="p-4 rounded-xl bg-theme-hover/40 border border-theme">
                <label className="text-[11px] font-semibold text-theme-muted tracking-tight mb-2 block">Auto-lock timeout</label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 5, 15, 30, 60].map(mins => (
                    <button
                      key={mins}
                      onClick={() => handleTimeoutChange(mins)}
                      className={clsx(
                        "px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight border transition-all",
                        settings.lock_timeout_minutes === mins
                          ? "bg-primary/10 border-primary/40 text-primary"
                          : "bg-theme-hover/60 border-theme text-theme-muted hover:text-theme-fg hover:border-theme"
                      )}
                    >
                      {mins < 60 ? `${mins}m` : "1h"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 text-[10px] text-theme-muted/60 font-medium">
            <Lock className="w-3 h-3" />
            AES-256-GCM encryption with OS keychain-backed keys
          </div>
        </div>

        {/* Cloud Sync */}
        <CloudSyncSettings />
    </div>
  );
}

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || "https://api.stuard.ai";

async function checkBetaAccess(): Promise<BetaAccess> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.email) return { hasBetaAccess: false, hasStagingAccess: false, loading: false };
    const email = session.user.email.toLowerCase();
    const token = session.access_token;
    const { data, error } = await supabase.from('beta_users').select('access_level').eq('email', email).single();
    if (error || !data) {
      try {
        const resp = await fetch(`${CLOUD_AI_HTTP}/v1/beta/check`, { headers: { Authorization: `Bearer ${token}` } });
        const json = await resp.json();
        return { hasBetaAccess: json?.beta === true, hasStagingAccess: json?.staging === true, loading: false };
      } catch { return { hasBetaAccess: false, hasStagingAccess: false, loading: false }; }
    }
    const level = String(data.access_level || '').toLowerCase();
    return { hasBetaAccess: level === 'beta' || level === 'staging' || level === 'all', hasStagingAccess: level === 'staging' || level === 'all', loading: false };
  } catch { return { hasBetaAccess: false, hasStagingAccess: false, loading: false }; }
}

const RestartModal: React.FC<{ open: boolean; version: string; onConfirm: () => void; onCancel: () => void; }> = ({ open, version, onConfirm, onCancel }) => {
  const [countdown, setCountdown] = useState(5);
  const [autoRestart, setAutoRestart] = useState(false);
  useEffect(() => {
    if (!open) { setCountdown(5); setAutoRestart(false); return; }
    if (!autoRestart) return;
    const timer = setInterval(() => { setCountdown(c => { if (c <= 1) { clearInterval(timer); onConfirm(); return 0; } return c - 1; }); }, 1000);
    return () => clearInterval(timer);
  }, [open, autoRestart, onConfirm]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-theme-card rounded-theme-card shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border border-theme">
        <div className="bg-theme-hover p-4 text-theme-fg relative overflow-hidden border-b border-theme">
          <div className="relative z-10 flex items-center gap-3 font-stuard">
            <div className="p-1.5 bg-primary/10 rounded-md border border-primary/20">
              <ArrowUpCircle className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-lg font-bold tracking-tight">Update Ready!</h2>
          </div>
        </div>
        <div className="p-6">
          <p className="text-theme-fg text-sm font-medium mb-4">Version {version} has been downloaded and is ready to install.</p>
          <div className="flex items-start gap-3 p-3 bg-theme-hover border border-theme rounded-theme-button mb-4 font-medium">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold text-theme-fg text-xs uppercase tracking-wide">Save your work</div>
              <div className="text-theme-muted text-[11px] mt-1">The app will close and restart automatically. Make sure to save any unsaved work.</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-theme-hover/60 rounded-xl mb-6 border border-theme transition-colors hover:border-theme">
            <div className="flex-1">
              <div className="text-xs font-semibold text-theme-fg tracking-tight">Auto-restart</div>
              <div className="text-[11px] text-theme-muted font-medium">Restart automatically in {countdown} seconds</div>
            </div>
            {autoRestart && <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center animate-pulse"><span className="text-primary font-semibold text-[10px]">{countdown}</span></div>}
            <Toggle checked={autoRestart} onChange={setAutoRestart} />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 rounded-theme-button border border-theme text-theme-muted text-xs font-bold hover:bg-theme-hover transition-colors">Later</button>
            <button onClick={onConfirm} className="px-4 py-2 rounded-theme-button bg-primary text-primary-fg text-xs font-bold hover:opacity-90 transition-colors shadow-sm">Restart Now</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const UpdateManager: React.FC = () => {
  const [state, setState] = useState<UpdateState>({ status: "idle", channel: "stable", currentVersion: "0.0.0" });
  const [changingChannel, setChangingChannel] = useState(false);
  const [betaAccess, setBetaAccess] = useState<BetaAccess>({ hasBetaAccess: false, hasStagingAccess: false, loading: true });
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState<string>("");

  useEffect(() => {
    (window as any).desktopAPI?.updatesGetState?.().then((s: UpdateState) => {
      if (s) {
        setState(s);
        if (s.apiEndpoint) setApiEndpoint(s.apiEndpoint);
      }
    });
    (window as any).desktopAPI?.updatesGetApiEndpoint?.().then((r: any) => {
      if (r?.ok && r?.endpoint) setApiEndpoint(r.endpoint);
    });
    const unsub = (window as any).desktopAPI?.onUpdatesState?.((s: UpdateState) => {
      if (s) {
        setState(s);
        if (s.apiEndpoint) setApiEndpoint(s.apiEndpoint);
        // Once we hit "installing", the restart modal is no longer the
        // current UI — the full-screen overlay is. Close the modal so it
        // doesn't sit on top of the overlay.
        if (s.status === "installing") setShowRestartModal(false);
      }
    });
    const unsubEndpoint = (window as any).desktopAPI?.onApiEndpointChanged?.((endpoint: string) => {
      setApiEndpoint(endpoint);
    });
    checkBetaAccess().then(setBetaAccess);
    return () => {
      if (typeof unsub === "function") unsub();
      if (typeof unsubEndpoint === "function") unsubEndpoint();
    };
  }, []);
  const handleCheck = async () => { await (window as any).desktopAPI?.updatesCheck?.(); };
  const handleDownload = async () => { await (window as any).desktopAPI?.updatesDownload?.(); };
  const handleInstall = async () => { await (window as any).desktopAPI?.updatesInstall?.(); };
  const handleChannelChange = async (ch: UpdateChannel) => {
    if (ch === state.channel) return;
    if (ch === 'beta' && !betaAccess.hasBetaAccess) return;
    if (ch === 'staging' && !betaAccess.hasStagingAccess) return;
    setChangingChannel(true);
    try { await (window as any).desktopAPI?.updatesSetChannel?.(ch); await (window as any).desktopAPI?.updatesCheck?.(); } finally { setChangingChannel(false); }
  };
  const statusIcon = () => {
    switch (state.status) {
      case "checking": return <Loader2 className="w-5 h-5 animate-spin text-primary" />;
      case "available": return <ArrowUpCircle className="w-5 h-5 text-amber-500" />;
      case "downloading": return <Download className="w-5 h-5 animate-pulse text-primary" />;
      case "downloaded": return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case "installing": return <Loader2 className="w-5 h-5 animate-spin text-primary" />;
      case "error": return <AlertCircle className="w-5 h-5 text-red-500" />;
      case "up-to-date": return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      default: return <RefreshCw className="w-5 h-5 text-theme-muted" />;
    }
  };
  const statusText = () => {
    switch (state.status) {
      case "checking": return "Checking...";
      case "available": return `v${state.latestVersion} available`;
      case "downloading": return `Downloading... ${state.downloadProgress ?? 0}%`;
      case "downloaded": return `v${state.latestVersion} ready`;
      case "installing": return "Installing update...";
      case "error": return "Update failed";
      case "up-to-date": return "Up to date";
      default: return "Check for updates";
    }
  };
  const canAccessBeta = betaAccess.hasBetaAccess;
  const canAccessStaging = betaAccess.hasStagingAccess;

  return (
    <div className="max-w-4xl space-y-6">
        <div className="dashboard-card p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-blue-500/5 to-transparent rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-700"></div>
          <div className="relative z-10">
            <SectionHeader icon={<ArrowUpCircle className="w-4 h-4" />} eyebrow="Maintenance" title="Updates" description="Manage application updates and release channels." />
            <div className="flex items-center justify-between p-5 bg-theme-hover/40 rounded-xl mb-5 border border-theme">
              <div>
                <div className="text-[11px] font-semibold text-theme-muted tracking-tight mb-1">Current version</div>
                <div className="text-[28px] font-semibold text-theme-fg tracking-tight font-stuard leading-none">{state.currentVersion}</div>
              </div>
              <div className="flex items-center gap-2.5 bg-theme-card px-4 py-2 rounded-lg border border-theme">
                {statusIcon()}
                <span className="text-[13px] font-semibold tracking-tight text-theme-fg">{statusText()}</span>
              </div>
            </div>

            <div className={clsx(
              "flex items-center justify-between p-4 rounded-xl mb-6 border",
              CHANNEL_INFO[state.channel].borderColor, CHANNEL_INFO[state.channel].bgColor
            )}>
              <div className="flex items-center gap-3">
                <div className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-tight bg-theme-card border border-theme",
                  CHANNEL_INFO[state.channel].color
                )}>
                  {CHANNEL_INFO[state.channel].label}
                </div>
                <div className="text-[12px] text-theme-muted font-medium">
                  Connected to <span className="font-mono text-theme-fg font-semibold">{apiEndpoint || CHANNEL_INFO[state.channel].apiUrl}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-theme-card px-2.5 py-1 rounded-md border border-theme">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tracking-tight">Live</span>
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-[11px] font-semibold text-theme-muted tracking-tight mb-3">Update channel</label>
              <div className={clsx(
                "grid gap-3",
                canAccessStaging ? 'grid-cols-3' : canAccessBeta ? 'grid-cols-2' : 'grid-cols-1'
              )}>
                <button onClick={() => handleChannelChange("stable")} disabled={changingChannel} className={clsx(
                  "p-4 rounded-xl border transition-all duration-200 text-left group/btn",
                  state.channel === "stable" ? "border-emerald-500/50 bg-emerald-500/5" : "border-theme bg-theme-hover/40 hover:bg-theme-hover/60 hover:border-emerald-500/30"
                )}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <CheckCircle className={clsx("w-4 h-4", state.channel === "stable" ? "text-emerald-500" : "text-theme-muted group-hover/btn:text-emerald-500/70")} />
                    <span className={clsx("font-semibold text-[13px] tracking-tight", state.channel === "stable" ? "text-emerald-600 dark:text-emerald-400" : "text-theme-fg")}>Stable</span>
                  </div>
                  <p className="text-[11px] text-theme-muted font-medium pl-6">Production releases</p>
                </button>
                {canAccessBeta && (
                  <button onClick={() => handleChannelChange("beta")} disabled={changingChannel} className={clsx(
                    "p-4 rounded-xl border transition-all duration-200 text-left group/btn",
                    state.channel === "beta" ? "border-amber-500/50 bg-amber-500/5" : "border-theme bg-theme-hover/40 hover:bg-theme-hover/60 hover:border-amber-500/30"
                  )}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Beaker className={clsx("w-4 h-4", state.channel === "beta" ? "text-amber-500" : "text-theme-muted group-hover/btn:text-amber-500/70")} />
                      <span className={clsx("font-semibold text-[13px] tracking-tight", state.channel === "beta" ? "text-amber-600 dark:text-amber-400" : "text-theme-fg")}>Beta</span>
                    </div>
                    <p className="text-[11px] text-theme-muted font-medium pl-6">Early access features</p>
                  </button>
                )}
                {canAccessStaging && (
                  <button onClick={() => handleChannelChange("staging")} disabled={changingChannel} className={clsx(
                    "p-4 rounded-xl border transition-all duration-200 text-left group/btn",
                    state.channel === "staging" ? "border-primary/50 bg-primary/5" : "border-theme bg-theme-hover/40 hover:bg-theme-hover/60 hover:border-primary/30"
                  )}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <FlaskConical className={clsx("w-4 h-4", state.channel === "staging" ? "text-primary" : "text-theme-muted group-hover/btn:text-primary/70")} />
                      <span className={clsx("font-semibold text-[13px] tracking-tight", state.channel === "staging" ? "text-primary" : "text-theme-fg")}>Staging</span>
                    </div>
                    <p className="text-[11px] text-theme-muted font-medium pl-6">Development builds</p>
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-5 border-t border-theme-sidebar">
              {(state.status === "idle" || state.status === "up-to-date" || state.status === "error") && (
                <button onClick={handleCheck} className="px-5 py-2 rounded-lg bg-primary text-primary-fg text-[13px] font-semibold tracking-tight hover:opacity-90 transition-all flex items-center gap-2 active:scale-95 shadow-sm"><RefreshCw className="w-4 h-4" />Check for Updates</button>
              )}
              {state.status === "available" && (
                <button onClick={handleDownload} className="px-5 py-2 rounded-lg bg-primary text-primary-fg text-[13px] font-semibold tracking-tight hover:opacity-90 transition-all flex items-center gap-2 active:scale-95 shadow-sm"><Download className="w-4 h-4" />Download Update</button>
              )}
              {state.status === "downloaded" && (
                <button onClick={() => setShowRestartModal(true)} className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold tracking-tight hover:bg-emerald-500 transition-all flex items-center gap-2 active:scale-95 shadow-sm"><RotateCcw className="w-4 h-4" />Restart to Update</button>
              )}
            </div>
            {state.releaseNotes && (state.status === "available" || state.status === "downloaded") && (
              <div className="mt-6 p-5 bg-theme-hover/40 rounded-xl border border-theme">
                <div className="text-[11px] font-semibold text-theme-muted mb-2 tracking-tight">
                  What's new in {state.latestVersion}
                </div>
                <div className="text-[13px] text-theme-fg leading-relaxed font-medium whitespace-pre-wrap">{state.releaseNotes}</div>
              </div>
            )}
          </div>
        </div>

        <RestartModal open={showRestartModal} version={state.latestVersion || ""} onConfirm={handleInstall} onCancel={() => setShowRestartModal(false)} />
    </div>
  );
};

/* ─── Cloud Sync Settings ─── */

interface SyncPrefs {
  sync_accounts: boolean;
  sync_conversations: boolean;
  sync_memories: boolean;
}

const CloudSyncSettings: React.FC = () => {
  const [prefs, setPrefs] = useState<SyncPrefs>({ sync_accounts: false, sync_conversations: false, sync_memories: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const resp = await fetch(`${CLOUD_AI_HTTP}/v1/preferences/sync`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setPrefs({
        sync_accounts: json.sync_accounts ?? false,
        sync_conversations: json.sync_conversations ?? false,
        sync_memories: json.sync_memories ?? false,
      });
      setError(null);
    } catch (e: any) {
      console.error("[CloudSync] fetch error", e);
      setError("Could not load sync preferences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  const updatePref = async (key: keyof SyncPrefs, value: boolean) => {
    setSaving(true);
    setError(null);
    const prev = { ...prefs };
    setPrefs(p => ({ ...p, [key]: value }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const resp = await fetch(`${CLOUD_AI_HTTP}/v1/preferences/sync`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [key]: value }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      invalidateRendererSyncPrefsCache();
    } catch (e: any) {
      console.error("[CloudSync] update error", e);
      setPrefs(prev);
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const TOGGLES: { key: keyof SyncPrefs; label: string; description: string }[] = [
    { key: "sync_accounts", label: "Sync Connected Accounts", description: "Store OAuth tokens (Discord, Google, etc.) in the cloud so they're available across devices. When off, tokens are stored locally with AES-256 encryption." },
    { key: "sync_conversations", label: "Sync Conversations", description: "Save conversation history to the cloud. When off, conversations are only stored on this device." },
    { key: "sync_memories", label: "Sync Memories", description: "Upload memory entries to the cloud. When off, memories remain local to this device." },
  ];

  return (
    <div className="dashboard-card p-6">
      <SectionHeader icon={<Cloud className="w-4 h-4" />} eyebrow="Privacy" title="Cloud Sync" description="Control what data is synced to StuardAI cloud." />

      {loading ? (
        <div className="flex items-center gap-2 text-theme-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading sync preferences...
        </div>
      ) : (
        <div className="space-y-2.5">
          {TOGGLES.map(({ key, label, description }) => (
            <ToggleRow
              key={key}
              icon={prefs[key] ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
              title={label}
              description={description}
              checked={prefs[key]}
              onChange={(v) => updatePref(key, v)}
              disabled={saving}
            />
          ))}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-red-500 text-[12px] font-semibold">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// General Tab Content
// ═══════════════════════════════════════════════════════════════════════════════

interface GeneralTabProps {
  themeMode: ThemeMode;
  setThemeMode: (v: ThemeMode) => void;
  wakewordEnabled: boolean;
  setWakewordEnabled: (v: boolean) => void;
  screenCaptureInvisible: boolean;
  setScreenCaptureInvisible: (v: boolean) => void;
  handleSaveTheme: () => void;
  tone: TonePreset;
  setTone: (t: TonePreset) => void;
  customTone: string;
  setCustomTone: (v: string) => void;
  personaDraft: string;
  setPersonaDraft: (v: string) => void;
  persona: string | null;
  handleSaveTonePersona: () => void;
  setOnboardingComplete: (v: boolean) => void;
  chatModels: ChatModelsConfig;
  setChatModels: (v: ChatModelsConfig) => void;
}

function GeneralTab({
  themeMode, setThemeMode,
  wakewordEnabled, setWakewordEnabled,
  screenCaptureInvisible, setScreenCaptureInvisible,
  handleSaveTheme,
  setOnboardingComplete,
}: GeneralTabProps) {
  return (
    <div className="max-w-4xl space-y-6">
        <GlobalHotkeySection />

        {/* Appearance */}
        <div className="dashboard-card p-6">
          <SectionHeader icon={<Palette className="w-4 h-4" />} eyebrow="Appearance" title="Theme" description="Customize the look of your desktop overlay." />
          <div className="space-y-5">
            <div>
              <label className="block text-[11px] font-semibold text-theme-muted tracking-tight mb-2">Color theme</label>
              <SegmentedControl
                value={themeMode}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(v) => setThemeMode(v as ThemeMode)}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end pt-4 border-t border-theme">
            <button
              onClick={handleSaveTheme}
              className="px-5 py-2 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold tracking-tight hover:opacity-90 transition-all shadow-sm"
            >
              Apply Theme
            </button>
          </div>
        </div>

        {/* Advanced Features */}
        <div className="dashboard-card p-6">
          <SectionHeader icon={<SlidersHorizontal className="w-4 h-4" />} eyebrow="Power user" title="Advanced Features" description="Enable or disable advanced functionality." />
          <div className="space-y-2.5">
            <ToggleRow
              accent
              title={'Wakeword Detection ("Hey Stuard")'}
              description="Runs continuously in the background using the shared audio bus."
              checked={wakewordEnabled}
              onChange={setWakewordEnabled}
            />
            <ToggleRow
              title="Screen Capture Invisibility"
              description="Hide Stuard windows from screenshots and screen recordings."
              checked={screenCaptureInvisible}
              onChange={(v) => {
                setScreenCaptureInvisible(v);
                (window as any).desktopAPI?.setScreenCaptureInvisible?.(v);
              }}
            />
          </div>
        </div>

        {/* Reset Onboarding */}
        <div className="dashboard-card p-6 !border-red-500/20">
          <h3 className="text-[15px] font-semibold text-red-500 mb-1 tracking-tight font-stuard">Advanced</h3>
          <p className="text-[13px] text-theme-muted mb-4 font-medium">Be careful with these settings.</p>
          <div className="flex items-center justify-between p-4 bg-red-500/5 rounded-xl border border-red-500/20">
            <div>
              <div className="text-[13px] font-semibold text-theme-fg tracking-tight">Reset onboarding</div>
              <div className="text-[11px] text-theme-muted font-medium mt-0.5">Go through the initial setup flow again.</div>
            </div>
            <button onClick={() => { setOnboardingComplete(false); (window as any).desktopAPI.openOnboarding(); }} className="px-4 py-2 rounded-lg border border-red-500/30 text-red-500 text-[12px] font-semibold tracking-tight hover:bg-red-500/10 hover:border-red-500/50 transition-all active:scale-95">Reset</button>
          </div>
        </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Assistant Tab Content — how the AI thinks & talks
// ═══════════════════════════════════════════════════════════════════════════════

interface AssistantTabProps {
  tone: TonePreset;
  setTone: (t: TonePreset) => void;
  customTone: string;
  setCustomTone: (v: string) => void;
  personaDraft: string;
  setPersonaDraft: (v: string) => void;
  handleSaveTonePersona: () => void;
  chatModels: ChatModelsConfig;
  setChatModels: (v: ChatModelsConfig) => void;
}

function AssistantTab({
  tone, setTone,
  customTone, setCustomTone,
  personaDraft, setPersonaDraft,
  handleSaveTonePersona,
  chatModels, setChatModels,
}: AssistantTabProps) {
  return (
    <div className="max-w-4xl space-y-6">
        {/* AI Personality */}
        <div className="dashboard-card p-6">
          <SectionHeader
            icon={<MessageSquare className="w-4 h-4" />}
            eyebrow="Assistant"
            title="AI Personality"
            description="Customize how the assistant communicates with you."
          />
          <div className="mb-6">
            <label className="block text-[11px] font-semibold text-theme-muted tracking-tight mb-2">Tone of voice</label>
            <SegmentedControl
              value={tone}
              options={TONE_OPTIONS}
              onChange={(v) => setTone(v as TonePreset)}
            />
            {tone === "custom" && (
              <input
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                placeholder="e.g. Witty, sarcastic, uses lots of emojis"
                className="mt-3 w-full max-w-md px-3 py-2 rounded-xl border border-theme bg-theme-hover text-theme-fg text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all shadow-sm placeholder:text-theme-muted"
              />
            )}
          </div>
          <div className="mb-6">
            <label className="block text-[11px] font-semibold text-theme-muted tracking-tight mb-1">System persona</label>
            <p className="text-[11px] text-theme-muted mb-2 font-medium">Instructions included in every system prompt.</p>
            <textarea
              value={personaDraft}
              onChange={(e) => setPersonaDraft(e.target.value)}
              placeholder="You are an expert TypeScript engineer..."
              className="w-full min-h-[140px] px-3 py-2 rounded-xl border border-theme bg-theme-hover text-theme-fg text-[13px] leading-relaxed font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y shadow-sm placeholder:text-theme-muted"
            />
          </div>
          <div className="flex justify-end pt-4 border-t border-theme">
            <button
              onClick={handleSaveTonePersona}
              className="px-5 py-2 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold tracking-tight hover:opacity-90 transition-all shadow-sm"
            >
              Save Personality
            </button>
          </div>
        </div>

        <AutoModelRoutingSection chatModels={chatModels} onChatModelsChange={setChatModels} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Billing Tab Content
// ═══════════════════════════════════════════════════════════════════════════════

function BillingTab() {
  return (
    <div className="max-w-4xl">
      <BillingSettings />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT (MemoriesView-style layout)
// ═══════════════════════════════════════════════════════════════════════════════

type SettingsTab = 'general' | 'assistant' | 'providers' | 'files' | 'checkpoints' | 'billing' | 'updates';

export const SettingsView: React.FC<SettingsViewProps> = (props) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  // Deep-link focus (dashboard "settings/updates" navigation, update pill).
  useEffect(() => {
    const id = props.focusTab?.id;
    if (id && ['general', 'assistant', 'providers', 'files', 'checkpoints', 'billing', 'updates'].includes(id)) {
      setActiveTab(id as SettingsTab);
    }
  }, [props.focusTab]);

  // Dot on the Updates nav row while a new version is waiting.
  const updateStatus = useUpdateStatus();
  const updateActionable = isUpdateActionable(updateStatus.status);

  type NavItem = { id: SettingsTab; label: string; hint: string; icon: React.ComponentType<{ className?: string }> };
  const navGroups: { heading: string; items: NavItem[] }[] = [
    {
      heading: 'Workspace',
      items: [
        { id: 'general', label: 'General', hint: 'Appearance, hotkey & advanced', icon: Settings },
      ],
    },
    {
      heading: 'Assistant',
      items: [
        { id: 'assistant', label: 'Personality & models', hint: 'Tone, persona & auto routing', icon: Brain },
        { id: 'providers', label: 'Providers', hint: 'Your own API keys', icon: Key },
      ],
    },
    {
      heading: 'Data',
      items: [
        { id: 'files', label: 'Files', hint: 'Folder search & indexing', icon: Folder },
        { id: 'checkpoints', label: 'Checkpoints', hint: 'Undo file changes', icon: History },
      ],
    },
    {
      heading: 'Account',
      items: [
        { id: 'billing', label: 'Billing', hint: 'Plan & usage', icon: CreditCard },
        { id: 'updates', label: 'Updates', hint: 'Version & channel', icon: ArrowUpCircle },
      ],
    },
  ];

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'assistant':
        return (
          <AssistantTab
            tone={props.tone}
            setTone={props.setTone}
            customTone={props.customTone}
            setCustomTone={props.setCustomTone}
            personaDraft={props.personaDraft}
            setPersonaDraft={props.setPersonaDraft}
            handleSaveTonePersona={props.handleSaveTonePersona}
            chatModels={props.chatModels}
            setChatModels={props.setChatModels}
          />
        );
      case 'providers':
        return <ApiKeysSection />;
      case 'files':
        return <FileIndexSettings />;
      case 'checkpoints':
        return <CheckpointsSection />;
      case 'billing':
        return <BillingTab />;
      case 'updates':
        return <UpdateManager />;
      case 'general':
      default:
        return <GeneralTab {...props} />;
    }
  };

  return (
    <div className="pb-6" data-onboarding="settings-view">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-theme-muted/70">Preferences</p>
          <h1 className="mt-1.5 text-[30px] font-semibold font-stuard tracking-tight text-theme-fg leading-none">Settings</h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-theme-muted">
            <Settings className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            <span>Tune how Stuard looks, thinks, and connects — grouped so you can find things fast.</span>
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_248px] xl:items-start">
        <div className="min-w-0">
          <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
            {renderActiveTab()}
          </div>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-5">
          <nav className="dashboard-card space-y-2 p-2">
            {navGroups.map((group) => (
              <div key={group.heading} className="last:mb-0">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-theme-muted/55">
                  {group.heading}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        title={item.hint}
                        className={clsx(
                          'flex w-full items-center gap-2.5 rounded-[16px] px-2.5 py-2 text-left transition-all',
                          active
                            ? 'bg-theme-hover/70 text-theme-fg shadow-sm'
                            : 'text-theme-muted hover:bg-theme-hover/50 hover:text-theme-fg'
                        )}
                      >
                        <span
                          className={clsx(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
                            active ? 'bg-primary/15 text-primary' : 'bg-theme-hover/45 text-theme-muted'
                          )}
                        >
                          <ItemIcon className="h-3.5 w-3.5" />
                        </span>
                        <span className="truncate text-[12.5px] font-medium tracking-tight">{item.label}</span>
                        {item.id === 'updates' && updateActionable && (
                          <span
                            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: 'var(--primary)' }}
                            aria-label="Update available"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
};
