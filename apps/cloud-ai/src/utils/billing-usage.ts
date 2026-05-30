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

  // Positive override: file-index embedding batches are intentionally billed
  // (at the discounted Gemini Batch rate) even though they use an embedding
  // model. An explicit `billable: true` flag or the dedicated source type opts
  // back in, overriding the embedding-model auto-exclusion below.
  const billableOverride = (raw as any).billable ?? (raw as any).is_billable;
  if (isTruthyFlag(billableOverride) || sourceType === 'file_index_embedding') {
    return false;
  }

  return (
    isTruthyFlag(billingExcluded) ||
    sourceType === 'embedding' ||
    sourceLabel.startsWith('embedding') ||
    isEmbeddingModel(input?.model ?? raw.model)
  );
}
