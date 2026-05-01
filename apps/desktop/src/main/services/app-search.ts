/**
 * Unified Search Engine with Fuzzy Matching & Apps-First Ranking
 *
 * Provides a single search entry point for the launcher that:
 * 1. Always shows matching apps first (from app-discovery)
 * 2. Supports typo tolerance via Levenshtein distance & bigram similarity
 * 3. Falls back to the existing file index for documents/files
 * 4. Returns merged, ranked results
 */

import * as path from "path";
import { getInstalledApps, type DiscoveredApp } from "./app-discovery";
import { searchFiles } from "./file-indexing";
import { peekCachedFileIcon } from "./icon-cache";
import logger from "../utils/logger";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface SearchResult {
  /** "app" | "file" | "folder" | "document" | etc. */
  kind: string;
  /** Display name */
  name: string;
  /** File system path or app id */
  path: string;
  /** How to open this result */
  launchTarget?: string;
  /** Icon hint path */
  iconHint?: string;
  /** Warmed icon data when available */
  iconDataUrl?: string;
  /** Relevance score (0-100, higher = better) */
  score: number;
  /** Source system: "app-discovery" | "file-index" */
  source: string;
  /** For file results — passthrough from file indexer */
  extension?: string;
  display_name?: string;
  filename?: string;
  target_path?: string;
  icon_path?: string;
  preview_kind?: "icon" | "thumbnail";
  preview_eligible?: boolean;
}

export interface UnifiedSearchOptions {
  limit?: number;
  rootId?: string;
  /** Include apps in results (default: true) */
  includeApps?: boolean;
  /** Include files in results (default: true) */
  includeFiles?: boolean;
}

const SEARCH_CACHE_TTL_MS = 30_000;
const FILE_SEARCH_TIMEOUT_MS = 600;
const searchCache = new Map<string, { expiresAt: number; results: SearchResult[] }>();
const inFlightSearches = new Map<string, Promise<SearchResult[]>>();

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

/**
 * Perform a unified search across apps and files.
 * Apps always rank first, results are fuzzy-matched with typo tolerance.
 */
export async function unifiedSearch(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<SearchResult[]> {
  const {
    limit = 12,
    rootId,
    includeApps = true,
    includeFiles = true,
  } = options;

  const rawQuery = String(query || "").trim();
  const q = normalizeSearchText(rawQuery);
  if (q.length < 2) return [];

  const cacheKey = JSON.stringify({
    rawQuery,
    q,
    limit,
    rootId: rootId || "",
    includeApps,
    includeFiles,
  });
  const now = Date.now();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.results;
  }

  const existing = inFlightSearches.get(cacheKey);
  if (existing) return existing;

  const searchPromise = (async () => {
    const appLimit = Math.min(5, limit);
    const fileLimit = Math.max(6, limit - 1);

    const fileSearchWithTimeout: Promise<SearchResult[]> = includeFiles
      ? Promise.race([
          searchFileIndex(rawQuery, fileLimit, rootId),
          new Promise<SearchResult[]>((resolve) =>
            setTimeout(() => resolve([]), FILE_SEARCH_TIMEOUT_MS)
          ),
        ])
      : Promise.resolve([]);

    const [appResults, fileResults] = await Promise.all([
      includeApps ? searchApps(q, appLimit) : Promise.resolve([]),
      fileSearchWithTimeout,
    ]);

    // Merge: keep strong app matches visible first, then fill with files.
    const merged: SearchResult[] = [];
    for (const r of appResults) {
      if (merged.length >= limit) break;
      merged.push(r);
    }

    for (const r of fileResults) {
      if (merged.length >= limit) break;
      const isDupe = appResults.some(
        (a) =>
          a.path.toLowerCase() === r.path.toLowerCase() ||
          a.name.toLowerCase() === r.name.toLowerCase()
      );
      if (!isDupe) merged.push(r);
    }

    const results = merged.slice(0, limit);
    // Cache empty/file-less results for the same window as full results — the previous
    // 2s window meant the same keystroke would re-hit the agent on every paint, which
    // dominated the perceived "search is slow" feel when the file index was cold.
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      results,
    });
    if (searchCache.size > 100) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    return results;
  })();

  inFlightSearches.set(cacheKey, searchPromise);
  try {
    return await searchPromise;
  } finally {
    inFlightSearches.delete(cacheKey);
  }
}

// ─────────────────────────────────────────────────────────
// App Search (local fuzzy match on the cached app list)
// ─────────────────────────────────────────────────────────

async function searchApps(query: string, limit: number): Promise<SearchResult[]> {
  let apps: DiscoveredApp[];
  try {
    apps = await getInstalledApps();
  } catch {
    return [];
  }
  if (!apps.length) return [];

  const q = normalizeSearchText(query);
  const qTokens = tokenizeSearchText(query);
  const minScore = getAppScoreThreshold(q);

  // Score every app
  const scored: { app: DiscoveredApp; score: number }[] = [];
  for (const a of apps) {
    const score = scoreApp(a, q, qTokens);
    if (score >= minScore) {
      scored.push({ app: a, score });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score || a.app.name.localeCompare(b.app.name));

  return scored.slice(0, limit).map(({ app: a, score }) => ({
    kind: "application",
    name: a.name,
    path: a.id,
    launchTarget: a.launchTarget,
    iconHint: a.iconHint,
    iconDataUrl: peekCachedFileIcon([a.iconHint, a.launchTarget, a.id], "normal"),
    score: clampScore(score),
    source: "app-discovery",
    display_name: a.name,
  }));
}

function scoreApp(app: DiscoveredApp, query: string, qTokens: string[]): number {
  const name = app._searchName || normalizeSearchText(app.name);
  const tokens = (app._tokens && app._tokens.length > 0)
    ? app._tokens
    : tokenizeSearchText(app.name);
  if (!name || query.length < 2) return 0;

  if (name === query) return 100;
  if (tokens.some((t) => t === query)) return 98;
  if (name.startsWith(query)) return 96;
  if (tokens.some((t) => t.startsWith(query))) return 91;

  // Short queries should feel precise, not fuzzy.
  if (query.length <= 2) return 0;

  if (name.includes(query)) return 84;

  const allTokensExact = qTokens.length > 1 && qTokens.every((qt) => tokens.some((t) => t === qt));
  if (allTokensExact) return 92;

  const allTokensMatchAsPrefix = qTokens.length > 1 && qTokens.every((qt) =>
    tokens.some((t) => t.startsWith(qt))
  );
  if (allTokensMatchAsPrefix) return 87;

  const allTokensSubstring = qTokens.length > 1 && qTokens.every((qt) =>
    qt.length >= 3 && tokens.some((t) => t.includes(qt))
  );
  if (allTokensSubstring) return 74;

  // Acronym matching: "vsc" -> "Visual Studio Code"
  if (qTokens.length === 1 && query.length >= 2 && query.length <= tokens.length) {
    const acronym = tokens.map((t) => t[0]).join("");
    if (acronym.startsWith(query)) return 76;
    if (query.length >= 3 && levenshtein(query, acronym.slice(0, query.length + 1)) <= 1) return 60;
  }

  if (query.length >= 3) {
    for (const t of tokens) {
      if (t.includes(query)) return 68;
    }
  }

  // Near-exact token typos should still feel "obviously right".
  if (qTokens.length === 1) {
    let bestSingleTokenScore = 0;
    for (const t of tokens) {
      const compactLen = Math.max(query.length, t.length);
      const maxDist = compactLen >= 7 ? 2 : 1;
      const dist = levenshtein(query, t);
      if (dist <= maxDist) {
        const score = dist === 0
          ? 96
          : dist === 1
            ? (compactLen >= 5 ? 80 : 72)
            : 64;
        bestSingleTokenScore = Math.max(bestSingleTokenScore, score);
      }
    }
    if (bestSingleTokenScore > 0) return bestSingleTokenScore;
  }

  // Fuzzy matching is only worth the cost for longer queries.
  if (query.length >= 4) {
    let fuzzyScore = 0;
    let matchedTokens = 0;
    for (const qt of qTokens) {
      let bestTokenScore = 0;
      for (const t of tokens) {
        const maxDist = qt.length <= 4 ? 1 : 2;
        const slice = t.slice(0, qt.length + maxDist);
        const dist = levenshtein(qt, slice);
        if (dist <= maxDist) {
          const s = (1 - dist / (maxDist + 1)) * 62;
          bestTokenScore = Math.max(bestTokenScore, s);
        }
        if (t.length <= qt.length + 2) {
          const fullDist = levenshtein(qt, t);
          if (fullDist <= maxDist) {
            const s = (1 - fullDist / (maxDist + 1)) * 60;
            bestTokenScore = Math.max(bestTokenScore, s);
          }
        }
      }
      if (bestTokenScore > 0) {
        matchedTokens++;
        fuzzyScore += bestTokenScore;
      }
    }

    if (matchedTokens === qTokens.length && qTokens.length > 0) {
      return fuzzyScore / qTokens.length;
    }
    if (matchedTokens > 0 && qTokens.length > 1) {
      return (fuzzyScore / qTokens.length) * (matchedTokens / qTokens.length);
    }

    const bigramScore = bigramSimilarity(query, name) * 54;
    if (bigramScore >= 26) return bigramScore;

    const maxDist = query.length <= 5 ? 1 : 2;
    const dist = levenshtein(query, name);
    if (dist <= maxDist) {
      return (1 - dist / (maxDist + 1)) * 52;
    }
  }

  return 0;
}

// ─────────────────────────────────────────────────────────
// File Index search (delegates to existing agent)
// ─────────────────────────────────────────────────────────

async function searchFileIndex(
  query: string,
  limit: number,
  rootId?: string
): Promise<SearchResult[]> {
  try {
    const files = await searchFiles(query, {
      limit,
      rootId,
    });
    if (!Array.isArray(files)) return [];
    const q = normalizeSearchText(query);
    const qTokens = tokenizeSearchText(query);
    const minScore = getFileScoreThreshold(q, qTokens.length);

    const scored = files
      .map((f: any, idx: number) => ({
        file: f,
        score: scoreFileResult(f, q, qTokens, idx),
      }))
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return scored
      .filter(({ file: f }) => String(f.kind || "").toLowerCase() !== "application")
      .slice(0, limit)
      .map(({ file: f, score }) => ({
      kind: String(f.kind || "file").toLowerCase(),
      name: f.display_name || f.filename || f.path,
      path: String(f.path || ""),
      score: clampScore(score),
      source: "file-index",
      extension: f.extension,
      display_name: f.display_name,
      filename: f.filename,
      target_path: f.target_path,
      icon_path: f.icon_path,
      preview_kind: f.preview_kind,
      preview_eligible: f.preview_eligible,
    }));
  } catch (e) {
    logger.debug("[app-search] File search failed:", e);
    return [];
  }
}

function scoreFileResult(file: any, query: string, qTokens: string[], index: number): number {
  const rawPath = String(file?.path || "");
  const fileNameRaw = String(file?.filename || path.basename(rawPath) || "");
  const displayRaw = String(file?.display_name || fileNameRaw || rawPath);
  const display = normalizeSearchText(displayRaw);
  const fileName = normalizeSearchText(fileNameRaw);
  const pathText = normalizeSearchText(rawPath);
  const tokens = Array.from(new Set([
    ...tokenizeSearchText(displayRaw),
    ...tokenizeSearchText(fileNameRaw),
    ...tokenizeSearchText(rawPath),
  ]));

  let score = 0;

  if (display === query || fileName === query) {
    score = 100;
  } else if (fileName.startsWith(query) || display.startsWith(query)) {
    score = 96;
  } else if (tokens.some((t) => t === query)) {
    score = 92;
  } else if (tokens.some((t) => t.startsWith(query))) {
    score = 84;
  } else if (query.length > 2 && (fileName.includes(query) || display.includes(query))) {
    score = 72;
  } else if (query.length >= 4 && pathText.includes(query)) {
    score = 58;
  }

  if (score === 0 && qTokens.length > 1) {
    let exactMatches = 0;
    let prefixMatches = 0;
    let substringMatches = 0;
    for (const qt of qTokens) {
      if (tokens.some((t) => t === qt)) exactMatches++;
      else if (tokens.some((t) => t.startsWith(qt))) prefixMatches++;
      else if (qt.length >= 3 && tokens.some((t) => t.includes(qt))) substringMatches++;
    }

    if (exactMatches === qTokens.length) score = 94;
    else if (exactMatches + prefixMatches === qTokens.length) score = 88;
    else if (prefixMatches === qTokens.length) score = 82;
    else if (exactMatches + prefixMatches + substringMatches === qTokens.length) score = 70;
    else score = exactMatches * 10 + prefixMatches * 8 + substringMatches * 5;
  }

  if (score === 0 && query.length >= 5) {
    const candidate = fileName || display;
    const maxDist = query.length <= 6 ? 1 : 2;
    const dist = levenshtein(query, candidate);
    if (dist <= maxDist) {
      score = dist === 1 ? 64 : 56;
    }
  }

  const kind = String(file?.kind || "").toLowerCase();
  if (kind === "application") score += 4;
  if (kind === "folder") score -= 2;
  score += Math.max(0, 10 - index);

  const depth = rawPath.split(/[/\\]+/).filter(Boolean).length;
  score -= Math.min(8, Math.max(0, depth - 3)) * 0.5;

  return clampScore(score);
}

function normalizeSearchText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[/\\]+/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(" ").filter(Boolean)));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getAppScoreThreshold(query: string): number {
  const compactLen = query.replace(/\s+/g, "").length;
  if (compactLen <= 2) return 90;
  if (compactLen <= 4) return 58;
  if (compactLen <= 7) return 46;
  return 36;
}

function getFileScoreThreshold(query: string, tokenCount: number): number {
  const compactLen = query.replace(/\s+/g, "").length;
  if (tokenCount > 1) {
    if (compactLen <= 5) return 44;
    return 36;
  }
  if (compactLen <= 2) return 82;
  if (compactLen <= 4) return 58;
  if (compactLen <= 7) return 44;
  return 34;
}

// ─────────────────────────────────────────────────────────
// Fuzzy string matching utilities
// ─────────────────────────────────────────────────────────

/**
 * Levenshtein edit distance (optimized with single-row DP)
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Early exit for very different lengths
  if (Math.abs(a.length - b.length) > 5) return Math.max(a.length, b.length);

  const m = a.length;
  const n = b.length;
  const row = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) row[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j];
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev;
      } else {
        row[j] = 1 + Math.min(prev, row[j], row[j - 1]);
      }
      prev = cur;
    }
  }
  return row[n];
}

/**
 * Bigram (character pair) similarity ratio [0..1]
 * Good for catching heavy misspellings like "firefxo" → "firefox"
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg);
    if (count && count > 0) {
      matches++;
      bigramsA.set(bg, count - 1);
    }
  }

  return (2 * matches) / (a.length + b.length - 2);
}
