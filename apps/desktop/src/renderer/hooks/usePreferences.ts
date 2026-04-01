import { useCallback, useEffect, useMemo, useState } from "react";

const LS_PREFIX = "stuard.pref.";

export type ChatMode = 'auto' | string;

/** Per-request reasoning effort level for models that support it. */
export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high';

/**
 * Providers that support per-request reasoning/thinking level configuration.
 * xAI and DeepSeek control reasoning at the model-variant level, so they're excluded.
 */
const CONFIGURABLE_REASONING_PROVIDERS = new Set(['openai', 'google', 'anthropic']);

/** Returns true if the given model supports per-request reasoning level configuration. */
export function supportsReasoningConfig(modelId: string): boolean {
  const provider = modelId.split('/')[0];
  return CONFIGURABLE_REASONING_PROVIDERS.has(provider) && REASONING_MODEL_IDS.has(modelId);
}

export interface ChatModeModelConfig {
  allowed: string[];
  default: string;
}

export interface ChatModelsConfig {
  fast: ChatModeModelConfig;
  balanced: ChatModeModelConfig;
  smart: ChatModeModelConfig;
}

export interface ModelMeta {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  logoUrl?: string;
  isReasoning: boolean;
  contextWindow?: number;
  category: 'fast' | 'balanced' | 'smart' | 'research';
}

export const ALL_CHAT_MODEL_IDS: string[] = [
  'xai/grok-4',
  'xai/grok-4-1-fast',
  'xai/grok-4-1-fast-non-reasoning',
  'xai/grok-4-fast',
  'xai/grok-4-fast-non-reasoning',
  'xai/grok-3',
  'xai/grok-3-fast',
  'xai/grok-3-fast-latest',
  'xai/grok-3-latest',
  'xai/grok-3-mini',
  'xai/grok-3-mini-fast',
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-pro',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-pro-preview',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-5',
  'openai/gpt-5-chat-latest',
  'openai/gpt-5-codex',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/gpt-5-pro',
  'openai/gpt-5.1',
  'openai/gpt-5.1-chat-latest',
  'openai/gpt-5.1-codex',
  'openai/gpt-5.1-codex-mini',
  'openai/gpt-5.2-codex',
  'openai/gpt-5.3-codex',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'anthropic/claude-3-5-haiku-latest',
  'anthropic/claude-haiku-4-5',
  'anthropic/claude-3-7-sonnet-latest',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-5',
  // Research models
  'perplexity/sonar',
  'perplexity/sonar-pro',
  'perplexity/sonar-reasoning',
  'perplexity/sonar-reasoning-pro',
  'perplexity/sonar-deep-research',
  'openai/o3-deep-research',
  'openai/o4-mini-deep-research',
];

const REASONING_MODEL_IDS = new Set<string>([
  'deepseek/deepseek-reasoner',
  'openai/gpt-5-pro',
  'openai/gpt-5.1',
  'openai/gpt-5.1-chat-latest',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3-pro-preview',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'xai/grok-4',
  'xai/grok-4-1-fast',
  'xai/grok-4-fast',
  'xai/grok-3',
  'xai/grok-3-fast',
  'xai/grok-3-fast-latest',
  'xai/grok-3-latest',
  'xai/grok-3-mini',
  'xai/grok-3-mini-fast',
  'anthropic/claude-3-7-sonnet-latest',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-5',
]);

const CONTEXT_WINDOWS: Record<string, number> = {
  'google/gemini-3.1-pro-preview': 2000000,
  'google/gemini-3-pro-preview': 2000000,
  'google/gemini-3-flash-preview': 1000000,
  'google/gemini-2.5-pro': 2000000,
  'google/gemini-2.5-flash': 1000000,
  'openai/gpt-5': 128000,
  'openai/gpt-5-pro': 128000,
  'openai/gpt-5.1': 128000,
  'openai/gpt-4.1': 128000,
  'openai/gpt-4.1-mini': 128000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'openai/gpt-5.2-codex': 700000,
  'openai/gpt-5.3-codex': 1000000,
  'xai/grok-4': 256000,
  'xai/grok-4-fast': 2000000,
  'xai/grok-3': 128000,
  'deepseek/deepseek-chat': 128000,
  'deepseek/deepseek-reasoner': 128000,
  'anthropic/claude-3-5-haiku-latest': 200000,
  'anthropic/claude-haiku-4-5': 200000,
  'anthropic/claude-3-7-sonnet-latest': 200000,
  'anthropic/claude-sonnet-4-5': 200000,
  'anthropic/claude-opus-4-5': 200000,
  // Research models
  'perplexity/sonar': 128000,
  'perplexity/sonar-pro': 200000,
  'perplexity/sonar-reasoning': 128000,
  'perplexity/sonar-reasoning-pro': 128000,
  'perplexity/sonar-deep-research': 128000,
  'openai/o3-deep-research': 128000,
  'openai/o4-mini-deep-research': 128000,
};

const MODEL_CATEGORIES: Record<string, 'fast' | 'balanced' | 'smart' | 'research'> = {
  'xai/grok-4': 'smart',
  'xai/grok-4-1-fast': 'balanced',
  'xai/grok-4-1-fast-non-reasoning': 'balanced',
  'xai/grok-4-fast': 'balanced',
  'xai/grok-4-fast-non-reasoning': 'balanced',
  'xai/grok-3': 'smart',
  'xai/grok-3-fast': 'smart',
  'xai/grok-3-fast-latest': 'smart',
  'xai/grok-3-latest': 'smart',
  'xai/grok-3-mini': 'fast',
  'xai/grok-3-mini-fast': 'fast',
  'google/gemini-3-flash-preview': 'fast',
  'google/gemini-2.5-flash': 'fast',
  'google/gemini-2.5-flash-lite': 'fast',
  'google/gemini-2.5-pro': 'smart',
  'google/gemini-3.1-pro-preview': 'smart',
  'google/gemini-3-pro-preview': 'smart',
  'openai/gpt-4.1': 'smart',
  'openai/gpt-4.1-mini': 'balanced',
  'openai/gpt-4.1-nano': 'fast',
  'openai/gpt-4o': 'balanced',
  'openai/gpt-4o-mini': 'fast',
  'openai/gpt-5': 'smart',
  'openai/gpt-5-chat-latest': 'smart',
  'openai/gpt-5-codex': 'smart',
  'openai/gpt-5-mini': 'balanced',
  'openai/gpt-5-nano': 'fast',
  'openai/gpt-5-pro': 'smart',
  'openai/gpt-5.1': 'smart',
  'openai/gpt-5.1-chat-latest': 'smart',
  'openai/gpt-5.1-codex': 'smart',
  'openai/gpt-5.1-codex-mini': 'balanced',
  'openai/gpt-5.2-codex': 'smart',
  'openai/gpt-5.3-codex': 'smart',
  'deepseek/deepseek-chat': 'fast',
  'deepseek/deepseek-reasoner': 'smart',
  'anthropic/claude-3-5-haiku-latest': 'fast',
  'anthropic/claude-haiku-4-5': 'fast',
  'anthropic/claude-3-7-sonnet-latest': 'balanced',
  'anthropic/claude-sonnet-4-5': 'smart',
  'anthropic/claude-opus-4-5': 'smart',
  // Research models
  'perplexity/sonar': 'research',
  'perplexity/sonar-pro': 'research',
  'perplexity/sonar-reasoning': 'research',
  'perplexity/sonar-reasoning-pro': 'research',
  'perplexity/sonar-deep-research': 'research',
  'openai/o3-deep-research': 'research',
  'openai/o4-mini-deep-research': 'research',
};

function humanizeProvider(p: string): string {
  const s = String(p || '').toLowerCase();
  if (s === 'xai') return 'xAI';
  if (s === 'openai') return 'OpenAI';
  if (s === 'google') return 'Google';
  if (s === 'deepseek') return 'DeepSeek';
  if (s === 'anthropic') return 'Anthropic';
  if (s === 'perplexity') return 'Perplexity';
  if (s === 'openrouter') return 'OpenRouter';
  return p;
}

function titleizeModelName(mid: string): string {
  try {
    const base = String(mid || '').replace(/-/g, ' ');
    // A few nicer aliases
    if (mid === 'deepseek-chat') return 'DeepSeek V3';
    if (mid === 'deepseek-reasoner') return 'DeepSeek R1';
    if (mid.startsWith('gpt ')) return base.toUpperCase();
    return base.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return String(mid || '');
  }
}

export const FALLBACK_MODELS: ModelMeta[] = ALL_CHAT_MODEL_IDS.map((id) => {
  const raw = String(id);
  const parts = raw.split('/');
  const providerKey = parts[0] || 'other';
  const modelKey = parts.slice(1).join('/') || raw;
  const isNonReasoning = modelKey.includes('non-reasoning');
  const isReasoning = !isNonReasoning && REASONING_MODEL_IDS.has(raw);
  return {
    id: raw,
    providerId: providerKey,
    provider: humanizeProvider(providerKey),
    name: titleizeModelName(modelKey),
    isReasoning,
    contextWindow: CONTEXT_WINDOWS[raw],
    category: MODEL_CATEGORIES[raw] || 'balanced',
  };
});

const DEFAULT_CHAT_MODE: ChatMode = 'auto';

// Legacy config support (can be simplified later)
const DEFAULT_CHAT_MODELS: ChatModelsConfig = {
  fast: { allowed: [], default: 'deepseek/deepseek-chat' },
  balanced: { allowed: [], default: 'xai/grok-4-1-fast' },
  smart: { allowed: [], default: 'google/gemini-3.1-pro-preview' },
};

function normalizeChatMode(v: any, chatModels: ChatModelsConfig): ChatMode {
  const raw = String(v || '').trim();
  if (!raw) return 'auto';
  if (raw === 'auto') return 'auto';
  // Back-compat: old tier stored
  if (raw === 'fast' || raw === 'balanced' || raw === 'smart') {
    const d = (chatModels as any)?.[raw]?.default;
    return typeof d === 'string' && d.trim() ? d.trim() : 'auto';
  }
  // New system: accept any provider/model-id format so desktop doesn't need updates
  const idx = raw.indexOf('/');
  if (idx > 0 && idx < raw.length - 1) return raw;
  return 'auto';
}

function getLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setLS<T>(key: string, value: T) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch { }
}

export type TonePreset = "concise" | "friendly" | "formal" | "technical" | "custom";
export type ThemeMode = "light" | "dark" | "custom";

function normalizeThemeMode(v: any): ThemeMode {
  const s = String(v || '').toLowerCase();
  if (s === 'dark') return 'dark';
  if (s === 'custom') return 'custom';
  // Back-compat for legacy values
  if (s === 'default' || s === 'light') return 'light';
  return 'light';
}

export function usePreferences() {
  const [tone, setToneState] = useState<TonePreset>(() => getLS<TonePreset>("tone", "concise"));
  const [customTone, setCustomToneState] = useState<string>(() => getLS<string>("tone_custom", ""));
  const [persona, setPersonaState] = useState<string>(() => getLS<string>("persona", ""));
  const [onboardingComplete, setOnboardingCompleteState] = useState<boolean>(() => getLS<boolean>("onboarding_complete", false));
  const [tourComplete, setTourCompleteState] = useState<boolean>(() => getLS<boolean>("tour_complete", false));
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => normalizeThemeMode(getLS<any>("theme_mode", "light")));
  const [themeDarkShade, setThemeDarkShadeState] = useState<string>(() => getLS<string>("theme_dark", "#0f172a"));
  const [themeLightShade, setThemeLightShadeState] = useState<string>(() => getLS<string>("theme_light", "#e2e8f0"));
  const [themeText, setThemeTextState] = useState<"white" | "black">(() => getLS("theme_text", "white"));
  const [translucentMode, setTranslucentModeState] = useState<boolean>(() => getLS<boolean>("translucent_mode", false));
  const [wakewordEnabled, setWakewordEnabledState] = useState<boolean>(() => getLS<boolean>("wakeword_enabled", false));
  const [wakewordSensitivity, setWakewordSensitivityState] = useState<number>(() => getLS<number>("wakeword_sensitivity", 0.7));
  const [terminalEnabled, setTerminalEnabledState] = useState<boolean>(() => getLS<boolean>("terminal_enabled", false));
  const [browserEnabled, setBrowserEnabledState] = useState<boolean>(() => getLS<boolean>("browser_enabled", false));
  const [screenCaptureInvisible, setScreenCaptureInvisibleState] = useState<boolean>(() => getLS<boolean>("screen_capture_invisible", false));
  const [chatModels, setChatModelsState] = useState<ChatModelsConfig>(() => getLS<ChatModelsConfig>('chat_models', DEFAULT_CHAT_MODELS));
  const [chatMode, setChatModeState] = useState<ChatMode>(() => normalizeChatMode(getLS<any>('chat_mode', DEFAULT_CHAT_MODE), getLS<ChatModelsConfig>('chat_models', DEFAULT_CHAT_MODELS)));
  // Timezone: auto-detect from browser, allow manual override stored in main-process settings
  const detectedTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } }, []);
  const [timezone, setTimezoneState] = useState<string>(() => getLS<string>('timezone', '') || detectedTz);
  const [timezoneOverride, setTimezoneOverrideState] = useState<boolean>(() => getLS<boolean>('timezone_override', false));

  useEffect(() => { setLS("tone", tone); }, [tone]);
  useEffect(() => { setLS("tone_custom", customTone); }, [customTone]);
  useEffect(() => { setLS("persona", persona); }, [persona]);
  useEffect(() => { setLS("onboarding_complete", onboardingComplete); }, [onboardingComplete]);
  useEffect(() => { setLS("tour_complete", tourComplete); }, [tourComplete]);
  useEffect(() => { setLS("theme_mode", themeMode); }, [themeMode]);
  useEffect(() => { setLS("theme_dark", themeDarkShade); }, [themeDarkShade]);
  useEffect(() => { setLS("theme_light", themeLightShade); }, [themeLightShade]);
  useEffect(() => { setLS("theme_text", themeText); }, [themeText]);
  useEffect(() => { setLS("translucent_mode", translucentMode); }, [translucentMode]);
  useEffect(() => { setLS("wakeword_enabled", wakewordEnabled); }, [wakewordEnabled]);
  useEffect(() => { setLS("wakeword_sensitivity", wakewordSensitivity); }, [wakewordSensitivity]);
  useEffect(() => { setLS("terminal_enabled", terminalEnabled); }, [terminalEnabled]);
  useEffect(() => { setLS("browser_enabled", browserEnabled); }, [browserEnabled]);
  useEffect(() => { setLS("screen_capture_invisible", screenCaptureInvisible); }, [screenCaptureInvisible]);
  useEffect(() => { setLS('chat_mode', chatMode); }, [chatMode]);
  useEffect(() => { setLS('chat_models', chatModels); }, [chatModels]);
  useEffect(() => { setLS('timezone', timezone); }, [timezone]);
  useEffect(() => { setLS('timezone_override', timezoneOverride); }, [timezoneOverride]);
  // Sync timezone to main process (for cron scheduling) whenever it changes
  useEffect(() => {
    try {
      const tz = timezoneOverride ? timezone : null; // null = auto-detect in main
      (window as any).stuard?.setTimezone?.(tz);
    } catch { }
  }, [timezone, timezoneOverride]);

  useEffect(() => {
    try {
      const root = document.documentElement;
      root.setAttribute('data-stuard-theme', themeMode);
      if (translucentMode) {
        root.setAttribute('data-translucent', 'true');
      } else {
        root.removeAttribute('data-translucent');
      }

      let cardBg = '#E3E3E3';
      if (themeMode === 'dark') {
        cardBg = '#D0D0D0';
      }
      if (themeMode === 'custom') {
        cardBg = `linear-gradient(180deg, ${themeLightShade} 0%, #E3E3E3 100%)`;
      }

      root.style.setProperty('--stuard-card-bg', cardBg);
    } catch { }
  }, [themeMode, themeLightShade]);

  // Listen for changes from other windows (e.g. onboarding wizard)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith(LS_PREFIX)) {
        const key = e.key.slice(LS_PREFIX.length);
        try {
          const val = e.newValue ? JSON.parse(e.newValue) : null;
          if (key === 'tone') setToneState(val ?? 'concise');
          if (key === 'tone_custom') setCustomToneState(val ?? '');
          if (key === 'persona') setPersonaState(val ?? '');
          if (key === 'onboarding_complete') setOnboardingCompleteState(val ?? false);
          if (key === 'tour_complete') setTourCompleteState(val ?? false);
          if (key === 'theme_mode') setThemeModeState(normalizeThemeMode(val));
          if (key === 'theme_dark') setThemeDarkShadeState(val ?? '#0f172a');
          if (key === 'theme_light') setThemeLightShadeState(val ?? '#e2e8f0');
          if (key === 'theme_text') setThemeTextState(val ?? 'white');
          if (key === 'translucent_mode') setTranslucentModeState(val ?? false);
          if (key === 'wakeword_enabled') setWakewordEnabledState(val ?? false);
          if (key === 'wakeword_sensitivity') setWakewordSensitivityState(val ?? 0.7);
          if (key === 'terminal_enabled') setTerminalEnabledState(val ?? false);
          if (key === 'browser_enabled') setBrowserEnabledState(val ?? false);
          if (key === 'screen_capture_invisible') setScreenCaptureInvisibleState(val ?? false);
          if (key === 'chat_models') setChatModelsState(val ?? DEFAULT_CHAT_MODELS);
          if (key === 'chat_mode') setChatModeState(normalizeChatMode(val ?? DEFAULT_CHAT_MODE, getLS<ChatModelsConfig>('chat_models', DEFAULT_CHAT_MODELS)));
          if (key === 'timezone') setTimezoneState(val || detectedTz);
          if (key === 'timezone_override') setTimezoneOverrideState(val ?? false);
        } catch { }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTone = useCallback((t: TonePreset) => { setToneState(t); }, []);
  const setCustomTone = useCallback((v: string) => { setCustomToneState(v); }, []);
  const setPersona = useCallback((v: string) => { setPersonaState(v); }, []);
  const setOnboardingComplete = useCallback((v: boolean) => { setOnboardingCompleteState(v); }, []);
  const setTourComplete = useCallback((v: boolean) => { setTourCompleteState(v); }, []);
  const setThemeMode = useCallback((m: ThemeMode) => { setThemeModeState(normalizeThemeMode(m)); }, []);
  const setThemeDarkShade = useCallback((v: string) => { setThemeDarkShadeState(v); }, []);
  const setThemeLightShade = useCallback((v: string) => { setThemeLightShadeState(v); }, []);
  const setThemeText = useCallback((v: "white" | "black") => { setThemeTextState(v); }, []);
  const setTranslucentMode = useCallback((v: boolean) => { setTranslucentModeState(v); }, []);
  const setWakewordEnabled = useCallback((v: boolean) => { setWakewordEnabledState(v); }, []);
  const setWakewordSensitivity = useCallback((v: number) => { setWakewordSensitivityState(Math.max(0.3, Math.min(0.95, v))); }, []);
  const setTerminalEnabled = useCallback((v: boolean) => { setTerminalEnabledState(v); }, []);
  const setBrowserEnabled = useCallback((v: boolean) => { setBrowserEnabledState(v); }, []);
  const setScreenCaptureInvisible = useCallback((v: boolean) => { setScreenCaptureInvisibleState(v); }, []);
  const setChatMode = useCallback((v: ChatMode) => { setChatModeState(v); }, []);
  const setChatModels = useCallback((v: ChatModelsConfig) => { setChatModelsState(v); }, []);
  const setTimezone = useCallback((v: string) => { setTimezoneState(v); }, []);
  const setTimezoneOverride = useCallback((v: boolean) => { setTimezoneOverrideState(v); }, []);

  return {
    tone,
    setTone,
    customTone,
    setCustomTone,
    persona,
    setPersona,
    onboardingComplete,
    setOnboardingComplete,
    tourComplete,
    setTourComplete,
    themeMode,
    setThemeMode,
    themeDarkShade,
    setThemeDarkShade,
    themeLightShade,
    setThemeLightShade,
    themeText,
    setThemeText,
    translucentMode,
    setTranslucentMode,
    wakewordEnabled,
    setWakewordEnabled,
    wakewordSensitivity,
    setWakewordSensitivity,
    terminalEnabled,
    setTerminalEnabled,
    browserEnabled,
    setBrowserEnabled,
    screenCaptureInvisible,
    setScreenCaptureInvisible,
    chatMode,
    setChatMode,
    chatModels,
    setChatModels,
    timezone,
    setTimezone,
    timezoneOverride,
    setTimezoneOverride,
    detectedTz,
  };
}
