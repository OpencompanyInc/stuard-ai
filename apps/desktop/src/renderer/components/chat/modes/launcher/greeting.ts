export const LOCAL_USER_NAME_KEY = 'stuard_user_name';
export const LAUNCHER_SUGGESTIONS_CACHE_KEY = 'stuard_launcher_suggestions_cache';
export const LAUNCHER_SUGGESTIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const LAUNCHER_SUGGESTIONS_CACHE_VERSION = 1;

/** Time-of-day greeting for the launcher empty state. */
export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();

  if (hour >= 0 && hour < 5) return 'Up late';
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Staying up late';
}

export function extractFirstName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function readLocalUserName(): string | null {
  try {
    const value = localStorage.getItem(LOCAL_USER_NAME_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function cacheLocalUserName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(LOCAL_USER_NAME_KEY, trimmed);
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function resolveAuthUserName(metadata: Record<string, unknown> | undefined, email?: string | null): string {
  const fullName = metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();

  const name = metadata?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();

  const emailPrefix = email?.split('@')[0]?.trim();
  return emailPrefix || '';
}

export function resolveProfileName(profile: {
  full_name?: string | null;
  display_name?: string | null;
  username?: string | null;
} | null | undefined): string {
  if (!profile) return '';
  return (
    profile.full_name?.trim() ||
    profile.display_name?.trim() ||
    profile.username?.trim() ||
    ''
  );
}

export interface KnowledgeFact {
  attribute_key?: string | null;
  text?: string | null;
  category?: string | null;
  subtype?: string | null;
}

export interface MemoryContextItem {
  type: string;
  text: string;
}

export const LAUNCHER_SUGGESTION_COUNT = 4;

interface LauncherSuggestionsCachePayload {
  version: number;
  key: string;
  expiresAt: number;
  suggestions: string[];
}

export type SuggestionIconKind =
  | 'message'
  | 'search'
  | 'calendar'
  | 'sparkles'
  | 'workflow'
  | 'file'
  | 'zap';

const SUGGESTION_ICON_ROTATION: SuggestionIconKind[] = [
  'message',
  'sparkles',
  'search',
  'workflow',
];

/** Pick an icon flavor from suggestion text; rotate defaults for variety. */
export function pickSuggestionIcon(text: string, index = 0): SuggestionIconKind {
  const q = text.toLowerCase();

  if (/(search|find|file|folder|look up)/.test(q)) return 'search';
  if (/(today|week|plan|schedule|calendar|focus)/.test(q)) return 'calendar';
  if (/(workflow|automate|run|trigger)/.test(q)) return 'workflow';
  if (/(summarize|recap|catch me up|know about|remember)/.test(q)) return 'sparkles';
  if (/(draft|write|email|reply|compose)/.test(q)) return 'file';
  if (/(help|quick|start)/.test(q)) return 'zap';

  return SUGGESTION_ICON_ROTATION[index % SUGGESTION_ICON_ROTATION.length];
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  bio: 'preference',
  project: 'project',
  procedural: 'workflow',
  event: 'recent activity',
};

export function formatMemoryForPrompt(item: MemoryContextItem): string {
  const label = MEMORY_TYPE_LABELS[item.type] || item.type;
  return `[${label}] ${item.text}`;
}

/** Round-robin diverse memory lines for inference (not just newest bio rows). */
export function formatDiverseMemoryPrompt(items: MemoryContextItem[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of items) {
    const text = item.text?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(formatMemoryForPrompt({ type: item.type, text }));
    if (out.length >= limit) break;
  }

  return out;
}

/** Read the user's name from SQLite knowledge core facts (`personal.core`). */
export function resolveIdentityName(facts: KnowledgeFact[] | null | undefined): string | null {
  if (!facts?.length) return null;

  const nameFact = facts.find(
    (f) => String(f.attribute_key || '').toLowerCase() === 'name' && f.text?.trim(),
  );
  if (nameFact?.text?.trim()) return nameFact.text.trim();

  // Fallback: any core fact that looks like a human name key
  for (const key of ['preferred_name', 'first_name', 'display_name', 'full_name']) {
    const fact = facts.find(
      (f) => String(f.attribute_key || '').toLowerCase() === key && f.text?.trim(),
    );
    if (fact?.text?.trim()) return fact.text.trim();
  }

  return null;
}

export function collectRecentMemoryTexts(
  bioFacts: KnowledgeFact[] | null | undefined,
  limit = 8,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const fact of bioFacts || []) {
    const text = fact.text?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }

  return out;
}

/** Generic chips only — never echo raw memory titles. */
export function buildFallbackSuggestions(_memories: string[], firstName?: string | null, limit = LAUNCHER_SUGGESTION_COUNT): string[] {
  const generic = [
    'What should I focus on today?',
    'Search my recent files',
    'Summarize what you know about me',
    'Draft a plan for this week',
  ];

  if (firstName) {
    return [`Catch me up, ${firstName}`, ...generic.slice(0, limit - 1)].slice(0, limit);
  }

  return generic.slice(0, limit);
}

export function parseSuggestionJson(raw: string, limit = LAUNCHER_SUGGESTION_COUNT): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, limit);
    }
  } catch {
    /* fall through */
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, limit);
      }
    } catch {
      /* ignore */
    }
  }

  return [];
}

function hashLauncherSuggestionContext(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createLauncherSuggestionsCacheKey(
  name: string | null | undefined,
  memories: string[],
  count = LAUNCHER_SUGGESTION_COUNT,
): string {
  return hashLauncherSuggestionContext(JSON.stringify({
    name: String(name || '').trim().toLowerCase(),
    memories: memories.map((m) => String(m || '').trim()).filter(Boolean),
    count,
  }));
}

export function readCachedLauncherSuggestions(cacheKey: string, now = Date.now()): string[] | null {
  if (!cacheKey) return null;

  try {
    const raw = localStorage.getItem(LAUNCHER_SUGGESTIONS_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as Partial<LauncherSuggestionsCachePayload>;
    if (
      cached.version !== LAUNCHER_SUGGESTIONS_CACHE_VERSION ||
      cached.key !== cacheKey ||
      !Array.isArray(cached.suggestions) ||
      Number(cached.expiresAt || 0) <= now
    ) {
      localStorage.removeItem(LAUNCHER_SUGGESTIONS_CACHE_KEY);
      return null;
    }

    const suggestions = cached.suggestions
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, LAUNCHER_SUGGESTION_COUNT);

    return suggestions.length > 0 ? suggestions : null;
  } catch {
    return null;
  }
}

export function cacheLauncherSuggestions(
  cacheKey: string,
  suggestions: string[],
  now = Date.now(),
): void {
  if (!cacheKey || suggestions.length === 0) return;

  try {
    const payload: LauncherSuggestionsCachePayload = {
      version: LAUNCHER_SUGGESTIONS_CACHE_VERSION,
      key: cacheKey,
      expiresAt: now + LAUNCHER_SUGGESTIONS_CACHE_TTL_MS,
      suggestions: suggestions
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, LAUNCHER_SUGGESTION_COUNT),
    };
    localStorage.setItem(LAUNCHER_SUGGESTIONS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / privacy mode */
  }
}
