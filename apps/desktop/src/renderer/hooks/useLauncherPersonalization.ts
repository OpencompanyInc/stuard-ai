import { useEffect, useMemo, useState } from 'react';
import {
  buildFallbackSuggestions,
  cacheLocalUserName,
  cacheLauncherSuggestions,
  createLauncherSuggestionsCacheKey,
  extractFirstName,
  formatDiverseMemoryPrompt,
  getTimeGreeting,
  LAUNCHER_SUGGESTION_COUNT,
  parseSuggestionJson,
  readCachedLauncherSuggestions,
  readLocalUserName,
  resolveIdentityName,
  type KnowledgeFact,
  type MemoryContextItem,
} from '../components/chat/modes/launcher/greeting';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';
const CLOUD_AI_HTTP =
  (window as any).__CLOUD_AI_HTTP__ ||
  (import.meta as any).env?.VITE_CLOUD_AI_URL ||
  'http://127.0.0.1:8082';

export interface LauncherPersonalization {
  greeting: string;
  displayName: string | null;
  firstName: string | null;
  suggestions: string[];
  isLoading: boolean;
  suggestionsLoading: boolean;
}

async function fetchKnowledgeIdentity(): Promise<KnowledgeFact[]> {
  try {
    const res = await fetch(`${AGENT_HTTP}/v1/knowledge/identity`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.facts) ? data.facts : [];
  } catch {
    return [];
  }
}

async function fetchDiverseMemoryContext(limit = 12): Promise<MemoryContextItem[]> {
  try {
    const res = await fetch(`${AGENT_HTTP}/v1/knowledge/context?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.items)) return [];
    return data.items
      .map((item: any) => ({
        type: String(item?.type || 'bio'),
        text: String(item?.text || '').trim(),
      }))
      .filter((item: MemoryContextItem) => item.text);
  } catch {
    return [];
  }
}

async function fetchInferenceSuggestions(
  accessToken: string | null | undefined,
  name: string | null,
  memoryLines: string[],
): Promise<string[] | null> {
  if (!accessToken) return null;

  try {
    const res = await fetch(
      `${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/inference/ai/launcher-suggestions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name,
          memories: memoryLines,
          count: LAUNCHER_SUGGESTION_COUNT,
        }),
      },
    );

    if (!res.ok) return null;
    const data = await res.json();

    const fromApi = Array.isArray(data?.suggestions)
      ? data.suggestions.map((s: unknown) => String(s || '').trim()).filter(Boolean)
      : parseSuggestionJson(String(data?.text || ''));

    const cleaned = fromApi.filter((s: string) => !s.toLowerCase().startsWith('help me with'));
    return cleaned.length > 0 ? cleaned.slice(0, LAUNCHER_SUGGESTION_COUNT) : null;
  } catch {
    return null;
  }
}

export function useLauncherPersonalization(accessToken?: string | null): LauncherPersonalization {
  const greeting = useMemo(() => getTimeGreeting(), []);
  const [displayName, setDisplayName] = useState<string | null>(() => readLocalUserName());
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setSuggestionsLoading(true);

      const [identityFacts, contextItems] = await Promise.all([
        fetchKnowledgeIdentity(),
        fetchDiverseMemoryContext(12),
      ]);

      if (!active) return;

      const memoryName = resolveIdentityName(identityFacts);
      const resolvedName = memoryName || readLocalUserName();
      if (resolvedName) cacheLocalUserName(resolvedName);

      setDisplayName(resolvedName);
      setIsLoading(false);

      const memoryLines = formatDiverseMemoryPrompt(contextItems, 12);
      const firstName = resolvedName ? extractFirstName(resolvedName) : null;
      const fallback = buildFallbackSuggestions(memoryLines, firstName, LAUNCHER_SUGGESTION_COUNT);
      const cacheKey = createLauncherSuggestionsCacheKey(
        resolvedName,
        memoryLines,
        LAUNCHER_SUGGESTION_COUNT,
      );
      const cachedSuggestions = readCachedLauncherSuggestions(cacheKey);
      if (cachedSuggestions?.length) {
        setSuggestions(cachedSuggestions);
        setSuggestionsLoading(false);
        return;
      }

      const aiSuggestions = await fetchInferenceSuggestions(accessToken, resolvedName, memoryLines);
      if (!active) return;

      if (aiSuggestions?.length) {
        cacheLauncherSuggestions(cacheKey, aiSuggestions);
      }

      setSuggestions(aiSuggestions?.length ? aiSuggestions : fallback);
      setSuggestionsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [accessToken]);

  const firstName = useMemo(() => {
    if (!displayName) return null;
    const first = extractFirstName(displayName);
    return first || null;
  }, [displayName]);

  return {
    greeting,
    displayName,
    firstName,
    suggestions,
    isLoading,
    suggestionsLoading,
  };
}
