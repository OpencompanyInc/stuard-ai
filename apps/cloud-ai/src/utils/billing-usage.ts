function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  const normalized = normalizeText(value);
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function isEmbeddingModel(model: string | null | undefined): boolean {
  const normalized = normalizeText(model);
  if (!normalized) return false;
  return (
    normalized.includes('embedding') ||
    normalized.includes('embed-text') ||
    normalized.includes('nomic-embed') ||
    normalized.includes('mxbai-embed')
  );
}

export function isNonBillableUsageEvent(input: {
  model?: string | null;
  raw?: any;
  sourceType?: string | null;
  sourceLabel?: string | null;
  billingExcluded?: boolean | string | null;
} | null | undefined): boolean {
  const raw = input?.raw && typeof input.raw === 'object' ? input.raw : {};
  const sourceType = normalizeText(input?.sourceType ?? raw.sourceType ?? raw.source_type);
  const sourceLabel = normalizeText(input?.sourceLabel ?? raw.source_label ?? raw.sourceLabel);
  const billingExcluded = input?.billingExcluded
    ?? raw.billingExcluded
    ?? raw.billing_excluded
    ?? raw.nonBillable
    ?? raw.non_billable;

  return (
    isTruthyFlag(billingExcluded) ||
    sourceType === 'embedding' ||
    sourceLabel.startsWith('embedding') ||
    isEmbeddingModel(input?.model ?? raw.model)
  );
}
