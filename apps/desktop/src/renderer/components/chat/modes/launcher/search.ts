export const normalizeLauncherSearchText = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[/\\]+/g, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const shouldRunLauncherSemanticSearch = (query: string): boolean => {
  const normalized = normalizeLauncherSearchText(query);
  const compactLen = normalized.replace(/\s+/g, "").length;
  // Fire on any reasonably-meaningful query, including a single concept word
  // ("beach", "selfie", "invoice"). Query embedding is non-billable and the
  // call is debounced, so the cost of a broader trigger is just a little
  // latency — worth it for meaning-based image/doc search to actually show up.
  return compactLen >= 4;
};
