export interface MarketplaceSearchRow {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  publisher_name?: string | null;
  tags?: string[] | null;
  similarity?: number | null;
}

/** True when the query literally appears in workflow metadata (compact search bar). */
export function marketplaceWorkflowMatchesQuery(
  workflow: MarketplaceSearchRow,
  query: string,
): boolean {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return false;

  const fields = [
    workflow.name,
    workflow.description,
    workflow.category,
    workflow.publisher_name,
    ...(Array.isArray(workflow.tags) ? workflow.tags : []),
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());

  if (fields.some((f) => f.includes(q))) return true;

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length <= 1) return false;
  return tokens.every((tok) => fields.some((f) => f.includes(tok)));
}

/**
 * Compact dropdown: prefer literal matches; allow semantic-only rows only at
 * very high confidence so weak/unrelated pgvector hits stay hidden.
 */
export function filterCompactMarketplaceResults<T extends MarketplaceSearchRow>(
  results: T[],
  query: string,
  options?: { max?: number; semanticOnlyMin?: number },
): T[] {
  const max = options?.max ?? 3;
  const semanticOnlyMin = options?.semanticOnlyMin ?? 0.62;
  const q = query.trim();
  if (!q) return [];

  const matched = results.filter((row) => {
    if (marketplaceWorkflowMatchesQuery(row, q)) return true;
    const sim = typeof row.similarity === 'number' ? row.similarity : null;
    return sim !== null && sim >= semanticOnlyMin;
  });

  return matched.slice(0, max);
}
