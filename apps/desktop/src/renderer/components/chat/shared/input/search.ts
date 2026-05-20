export const normalizeInputSearchText = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[/\\]+/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const shouldRunInputSemanticSearch = (query: string): boolean => {
  const normalized = normalizeInputSearchText(query);
  const compactLen = normalized.replace(/\s+/g, '').length;
  const tokenCount = normalized ? normalized.split(' ').length : 0;
  return tokenCount > 1 && compactLen >= 6;
};
