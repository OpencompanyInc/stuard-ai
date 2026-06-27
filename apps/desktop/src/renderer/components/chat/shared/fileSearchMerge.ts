export function fileResultKey(result: any): string {
  return String(result?.id || result?.path || "").trim().toLowerCase();
}

export function isApplicationFileResult(result: any): boolean {
  return String(result?.kind || "").toLowerCase() === "application";
}

export function filterFileSearchResults(results: unknown): any[] {
  return Array.isArray(results)
    ? results.filter((r) => !isApplicationFileResult(r))
    : [];
}

/** Hybrid hits first, then quick results not already shown. */
export function mergeHybridAndQuickFileResults(
  hybrid: any[],
  quick: any[],
  maxResults = 12,
): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const result of hybrid) {
    const key = fileResultKey(result);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
  }

  for (const result of quick) {
    const key = fileResultKey(result);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
  }

  return merged.slice(0, maxResults);
}
