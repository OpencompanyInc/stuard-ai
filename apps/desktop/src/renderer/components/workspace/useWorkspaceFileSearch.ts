import { useCallback, useEffect, useRef, useState } from 'react';
import {
  filterFileSearchResults,
  mergeHybridAndQuickFileResults,
} from '../chat/shared/fileSearchMerge';
import { shouldRunInputSemanticSearch } from '../chat/shared/input/search';

const CLOUD_AI_HTTP =
  (window as any).__CLOUD_AI_HTTP__ ||
  (import.meta as any).env?.VITE_CLOUD_AI_URL ||
  'http://127.0.0.1:8082';

const RESULT_LIMIT = 16;

export function useWorkspaceFileSearch(accessToken?: string | null) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [error, setError] = useState('');
  const [indexStats, setIndexStats] = useState<any>(null);
  const [searchMode, setSearchMode] = useState<'quick' | 'hybrid'>('quick');

  const searchReqIdRef = useRef(0);
  const semanticReqIdRef = useRef(0);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickRef = useRef<any[]>([]);
  const hybridRef = useRef<any[]>([]);

  const applyMerged = useCallback(() => {
    setResults(mergeHybridAndQuickFileResults(hybridRef.current, quickRef.current, RESULT_LIMIT));
    setSearchMode(hybridRef.current.length > 0 ? 'hybrid' : 'quick');
  }, []);

  const refreshIndexMeta = useCallback(async () => {
    try {
      const api = (window as any).desktopAPI;
      if (!api?.execTool) return;
      const stats = await api.execTool('file_index_stats', {});
      if (stats?.ok) setIndexStats(stats);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshIndexMeta();
  }, [refreshIndexMeta]);

  const runQuickSearch = useCallback(async (q: string) => {
    const api = (window as any).desktopAPI;
    if (!api?.execTool || !q.trim()) {
      quickRef.current = [];
      hybridRef.current = [];
      setResults([]);
      setError('');
      return;
    }
    const reqId = ++searchReqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.execTool('file_search', {
        query: q,
        mode: 'quick',
        limit: RESULT_LIMIT,
      });
      if (searchReqIdRef.current !== reqId) return;
      if (res?.ok) {
        quickRef.current = filterFileSearchResults(res.results);
        applyMerged();
      } else {
        quickRef.current = [];
        hybridRef.current = [];
        setResults([]);
        setError(String(res?.error || 'Search failed'));
      }
    } catch (e: any) {
      if (searchReqIdRef.current !== reqId) return;
      quickRef.current = [];
      hybridRef.current = [];
      setResults([]);
      setError(String(e?.message || 'Search failed'));
    } finally {
      if (searchReqIdRef.current === reqId) setLoading(false);
    }
  }, [applyMerged]);

  const runSemanticSearch = useCallback(async (q: string) => {
    const token = typeof accessToken === 'string' ? accessToken : '';
    const indexed = Number(indexStats?.indexed_files || 0);
    if (!token || indexed <= 0 || !shouldRunInputSemanticSearch(q)) return;
    const api = (window as any).desktopAPI;
    if (!api?.execTool) return;

    const reqId = ++semanticReqIdRef.current;
    setSemanticLoading(true);
    try {
      const resp = await fetch(`${String(CLOUD_AI_HTTP).replace(/\/$/, '')}/inference/ai/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: q,
          model: 'google/gemini-embedding-2-preview',
          outputDimensionality: 3072,
        }),
      });
      const j = await resp.json().catch(() => ({}));
      if (semanticReqIdRef.current !== reqId) return;
      if (!resp.ok || !j?.ok || !Array.isArray(j.embedding)) return;

      const res = await api.execTool('file_search', {
        query: q,
        vector: j.embedding,
        mode: 'hybrid',
        limit: RESULT_LIMIT,
      });
      if (semanticReqIdRef.current !== reqId) return;
      if (res?.ok) {
        hybridRef.current = filterFileSearchResults(res.results);
        applyMerged();
      }
    } catch { /* ignore */ }
    finally {
      if (semanticReqIdRef.current === reqId) setSemanticLoading(false);
    }
  }, [accessToken, indexStats?.indexed_files, applyMerged]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);

    const q = query.trim();
    if (!q) {
      quickRef.current = [];
      hybridRef.current = [];
      setResults([]);
      setError('');
      setLoading(false);
      setSemanticLoading(false);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      void runQuickSearch(q);
    }, 120);

    semanticDebounceRef.current = setTimeout(() => {
      void runSemanticSearch(q);
    }, 320);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [query, runQuickSearch, runSemanticSearch]);

  const clearSearch = useCallback(() => {
    setQuery('');
    quickRef.current = [];
    hybridRef.current = [];
    setResults([]);
    setError('');
  }, []);

  const isSearching = query.trim().length > 0;

  return {
    query,
    setQuery,
    results,
    loading,
    semanticLoading,
    error,
    searchMode,
    indexStats,
    isSearching,
    clearSearch,
  };
}
