import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matchIntegrationSuggestion,
  type IntegrationSuggestion,
} from './integrationTriggers';
import {
  connectOAuth,
  installLocalTool,
  readConnectedMap,
} from './integrationInlineActions';

const DISMISSED_KEY = 'integrations.suggest.dismissed';

export type SuggestionPhase = 'idle' | 'working' | 'done' | 'error';

export interface UseIntegrationSuggestionArgs {
  query: string;
  accessToken?: string | null;
  /** When false the matcher is paused (e.g. file-nav overlay open / voice active). */
  enabled?: boolean;
}

export interface UseIntegrationSuggestionResult {
  suggestion: IntegrationSuggestion | null;
  phase: SuggestionPhase;
  progress: string;
  error: string;
  act: () => void;
  retry: () => void;
  dismiss: () => void;
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistDismissed(set: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {}
}

export function useIntegrationSuggestion({
  query,
  accessToken,
  enabled = true,
}: UseIntegrationSuggestionArgs): UseIntegrationSuggestionResult {
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>(() => readConnectedMap());
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [phase, setPhase] = useState<SuggestionPhase>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  // The suggestion captured when an action starts — held through working/done/error
  // so the chip doesn't vanish mid-flight when connectedMap updates.
  const [acting, setActing] = useState<IntegrationSuggestion | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep connectedMap in sync with the shared contract.
  useEffect(() => {
    const refresh = () => setConnectedMap(readConnectedMap());
    window.addEventListener('integrations.connected.changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('integrations.connected.changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Debounce the query so matching stays off the keystroke path.
  useEffect(() => {
    if (!enabled) {
      setDebouncedQuery('');
      return;
    }
    const id = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(id);
  }, [query, enabled]);

  const liveSuggestion = useMemo(() => {
    if (!enabled) return null;
    return matchIntegrationSuggestion(debouncedQuery, { connectedMap, dismissed });
  }, [enabled, debouncedQuery, connectedMap, dismissed]);

  const suggestion = phase === 'idle' ? liveSuggestion : acting;

  const reset = useCallback(() => {
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    setPhase('idle');
    setProgress('');
    setError('');
    setActing(null);
  }, []);

  const run = useCallback(
    async (s: IntegrationSuggestion) => {
      setActing(s);
      setPhase('working');
      setError('');
      setProgress('');

      // Connect needs a session — fall back to the dashboard if signed out.
      if (s.kind === 'connect' && !accessToken) {
        try {
          (window as any).desktopAPI?.openDashboard?.({ tab: 'integrations' });
        } catch {}
        reset();
        return;
      }

      const ctx = {
        token: accessToken,
        onProgress: (label: string) => setProgress(label),
      };
      const res =
        s.kind === 'install'
          ? await installLocalTool(s.slug, ctx)
          : await connectOAuth(s.slug, ctx);

      if (res.ok) {
        setPhase('done');
        setProgress('');
        doneTimerRef.current = setTimeout(reset, 1600);
      } else {
        setPhase('error');
        setError(res.error || 'Something went wrong.');
      }
    },
    [accessToken, reset],
  );

  const act = useCallback(() => {
    const s = phase === 'idle' ? liveSuggestion : acting;
    if (!s || phase === 'working') return;
    void run(s);
  }, [phase, liveSuggestion, acting, run]);

  const retry = useCallback(() => {
    if (acting) void run(acting);
  }, [acting, run]);

  const dismiss = useCallback(() => {
    const s = suggestion;
    if (s) {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(s.slug);
        persistDismissed(next);
        return next;
      });
    }
    reset();
  }, [suggestion, reset]);

  useEffect(() => () => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
  }, []);

  return { suggestion, phase, progress, error, act, retry, dismiss };
}
