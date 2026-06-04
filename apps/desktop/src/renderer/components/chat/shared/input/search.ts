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
  // Keep this identical to the launcher (shouldRunLauncherSemanticSearch): fire on
  // any reasonably-meaningful query, including a single concept word ("beach",
  // "invoice", "selfie"). Query embedding is non-billable and debounced, so the
  // only cost of the broader trigger is a little latency — worth it so meaning-
  // based file/image results actually surface in compact quick search too.
  return compactLen >= 4;
};
