/**
 * Unified Search Engine with Fuzzy Matching & Apps-First Ranking
 *
 * Provides a single search entry point for the launcher that:
 * 1. Always shows matching apps first (from app-discovery)
 * 2. Supports typo tolerance via Levenshtein distance & bigram similarity
 * 3. Falls back to the existing file index for documents/files
 * 4. Returns merged, ranked results
 */

import { getInstalledApps, type DiscoveredApp } from "./app-discovery";
import { searchFiles } from "./file-indexing";
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
}

export interface UnifiedSearchOptions {
  limit?: number;
  rootId?: string;
  /** Include apps in results (default: true) */
  includeApps?: boolean;
  /** Include files in results (default: true) */
  includeFiles?: boolean;
}

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

  const q = (query || "").trim();
  if (q.length < 1) return [];

  const appLimit = Math.min(6, limit);
  const fileLimit = Math.max(6, limit - 2);

  // Run app search and file search in parallel
  const [appResults, fileResults] = await Promise.all([
    includeApps ? searchApps(q, appLimit) : Promise.resolve([]),
    includeFiles ? searchFileIndex(q, fileLimit, rootId) : Promise.resolve([]),
  ]);

  // Merge: apps first, then files, respecting the total limit
  const merged: SearchResult[] = [];

  // Add all app results first
  for (const r of appResults) {
    if (merged.length >= limit) break;
    merged.push(r);
  }

  // Fill remaining slots with file results
  for (const r of fileResults) {
    if (merged.length >= limit) break;
    // Skip files that duplicate an app entry (e.g. same .exe)
    const isDupe = appResults.some(
      (a) =>
        a.path.toLowerCase() === r.path.toLowerCase() ||
        a.name.toLowerCase() === r.name.toLowerCase()
    );
    if (!isDupe) merged.push(r);
  }

  return merged;
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

  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const qTokens = q.split(" ").filter(Boolean);

  // Score every app
  const scored: { app: DiscoveredApp; score: number }[] = [];
  for (const a of apps) {
    const score = scoreApp(a, q, qTokens);
    if (score > 0) {
      scored.push({ app: a, score });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ app: a, score }) => ({
    kind: "application",
    name: a.name,
    path: a.id,
    launchTarget: a.launchTarget,
    iconHint: a.iconHint,
    score: Math.round(score),
    source: "app-discovery",
    display_name: a.name,
  }));
}

function scoreApp(app: DiscoveredApp, query: string, qTokens: string[]): number {
  const name = app._searchName;
  const tokens = app._tokens;

  // ── Exact prefix match on full name: highest score ──
  if (name.startsWith(query)) return 100;

  // ── Full name contains the query ──
  if (name.includes(query)) return 90;

  // ── All query tokens found as prefixes of app tokens ──
  // e.g. "vs co" matches "visual studio code"
  const allTokensMatchAsPrefix = qTokens.every((qt) =>
    tokens.some((t) => t.startsWith(qt))
  );
  if (allTokensMatchAsPrefix) return 85;

  // ── All query tokens are substrings of some app token ──
  const allTokensSubstring = qTokens.every((qt) =>
    tokens.some((t) => t.includes(qt))
  );
  if (allTokensSubstring) return 75;

  // ── Acronym matching: "vsc" → "Visual Studio Code" ──
  // Moved before fuzzy so acronyms score higher than typo matches
  if (qTokens.length === 1 && query.length >= 2 && query.length <= tokens.length) {
    const acronym = tokens.map((t) => t[0]).join("");
    if (acronym.startsWith(query)) return 70;
    // Fuzzy acronym with 1 edit
    if (query.length >= 2 && levenshtein(query, acronym.slice(0, query.length + 1)) <= 1) return 55;
  }

  // ── Fuzzy: check each query token against app tokens with edit distance ──
  // More generous thresholds for typo tolerance
  let fuzzyScore = 0;
  let matchedTokens = 0;
  for (const qt of qTokens) {
    let bestTokenScore = 0;
    for (const t of tokens) {
      // More tolerant: allow 1 edit for 2-3 chars, 2 for 4-5, 3 for 6+
      const maxDist = qt.length <= 2 ? 1 : qt.length <= 4 ? 2 : 3;
      // Compare against slightly longer prefix to handle insertions
      const slice = t.slice(0, qt.length + maxDist);
      const dist = levenshtein(qt, slice);
      if (dist <= maxDist) {
        // Closer distance = higher score
        const s = (1 - dist / (maxDist + 1)) * 65;
        bestTokenScore = Math.max(bestTokenScore, s);
      }
      // Also try full token for short app names (e.g. "arc" for "Arc")
      if (t.length <= qt.length + 2) {
        const fullDist = levenshtein(qt, t);
        if (fullDist <= maxDist) {
          const s = (1 - fullDist / (maxDist + 1)) * 65;
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

  // ── Partial token match: at least one query token matches well ──
  // Helpful for multi-word queries where only part is misspelled
  if (matchedTokens > 0 && qTokens.length > 1) {
    return (fuzzyScore / qTokens.length) * (matchedTokens / qTokens.length);
  }

  // ── Bigram similarity as last resort for heavily misspelled queries ──
  const bigramScore = bigramSimilarity(query, name) * 55;
  if (bigramScore >= 15) return bigramScore;

  // ── Substring of any single token (handles partial typing) ──
  if (query.length >= 3) {
    for (const t of tokens) {
      if (t.includes(query)) return 40;
    }
  }

  // ── Last resort: full query vs full name Levenshtein ──
  // Catches cases like "discrd" → "discord" where single-token approach might miss
  {
    const maxDist = query.length <= 3 ? 1 : query.length <= 5 ? 2 : 3;
    const dist = levenshtein(query, name);
    if (dist <= maxDist) {
      return (1 - dist / (maxDist + 1)) * 55;
    }
    // Also try against each individual token directly
    for (const t of tokens) {
      const tokenDist = levenshtein(query, t);
      if (tokenDist <= maxDist) {
        return (1 - tokenDist / (maxDist + 1)) * 50;
      }
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

    return files.map((f: any, idx: number) => ({
      kind: String(f.kind || "file").toLowerCase(),
      name: f.display_name || f.filename || f.path,
      path: String(f.path || ""),
      score: Math.max(0, 60 - idx * 2), // Decreasing score based on rank
      source: "file-index",
      extension: f.extension,
      display_name: f.display_name,
      filename: f.filename,
      target_path: f.target_path,
      icon_path: f.icon_path,
    }));
  } catch (e) {
    logger.debug("[app-search] File search failed:", e);
    return [];
  }
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
