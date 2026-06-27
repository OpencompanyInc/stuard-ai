export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function filterToolPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => filterToolPayload(item))
      .filter((item) => item !== null && item !== undefined);
    return items.length > 0 ? items : null;
  }

  if (isPlainRecord(value)) {
    const filtered: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/^(id|.*_id|.*Id|session.*|conversation.*|description)$/i.test(key)) {
        continue;
      }
      const next = filterToolPayload(entry);
      if (next !== null && next !== undefined) {
        filtered[key] = next;
      }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  return value;
}

export function truncatePreviewText(text: string, max = 96): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function summarizePreviewValue(value: unknown): string {
  if (typeof value === 'string') return truncatePreviewText(value, 88);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  if (isPlainRecord(value)) {
    if (typeof value.status === 'string') return truncatePreviewText(value.status, 64);
    if (typeof value.path === 'string') return truncatePreviewText(value.path, 72);
    const count = Object.keys(value).length;
    return count === 1 ? '1 field' : `${count} fields`;
  }
  return 'No data';
}

export function shouldShowRawDetails(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 5 || value.some((item) => typeof item === 'object' && item !== null);
  }

  if (isPlainRecord(value)) {
    const entries = Object.values(value);
    return (
      Object.keys(value).length > 5 ||
      entries.some((entry) => {
        if (typeof entry === 'string') return entry.length > 140;
        return Array.isArray(entry) || isPlainRecord(entry);
      })
    );
  }

  return false;
}

export function extractSearchSources(result: unknown): Array<{ title: string; url: string; snippet?: string }> | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;

  let items: unknown[] | null = null;
  if (Array.isArray(obj.results)) items = obj.results;
  else if (Array.isArray(obj.sources)) items = obj.sources;
  else if (Array.isArray(obj.data)) items = obj.data;
  else if (Array.isArray(result)) items = result as unknown[];

  if (!items || items.length === 0) return null;

  const sources = items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && typeof (item as any).url === 'string')
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title : '',
      url: item.url as string,
      snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
    }));

  return sources.length > 0 ? sources : null;
}

export function faviconUrl(siteUrl: string): string {
  try {
    const host = new URL(siteUrl).hostname;
    return `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
  } catch {
    return '';
  }
}
