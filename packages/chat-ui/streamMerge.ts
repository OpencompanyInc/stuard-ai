function normalizeStreamText(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n');
}

export function getStreamingOverlapLength(previous: string, incoming: string): number {
  const left = normalizeStreamText(previous);
  const right = normalizeStreamText(incoming);
  const max = Math.min(left.length, right.length);

  for (let size = max; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return size;
    }
  }

  return 0;
}

export function mergeStreamingText(previous: string, incoming: string): string {
  const left = normalizeStreamText(previous);
  const right = normalizeStreamText(incoming);

  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (right.startsWith(left)) return right;
  if (left.endsWith(right)) return left;
  if (left.includes(right) && right.length >= Math.max(12, Math.floor(left.length * 0.6))) {
    return left;
  }
  if (right.includes(left) && left.length >= Math.max(12, Math.floor(right.length * 0.6))) {
    return right;
  }

  const overlap = getStreamingOverlapLength(left, right);
  if (overlap > 0) {
    return left + right.slice(overlap);
  }

  return left + right;
}

/**
 * Merge two consecutive reasoning/thought blocks into one coherent string.
 *
 * Providers stream reasoning differently: some re-send the running text each
 * delta (overlapping snapshots), others emit non-overlapping increments — and
 * an agent's reasoning often gets split around hidden tool calls. We de-dupe the
 * snapshot case and concatenate the rest, restoring a single separating space
 * only when the seam would otherwise glue two word characters together. This
 * keeps a fragmented stream ("…button 3" + ". Click" + "the appropriate…") from
 * rendering as a pile of ugly mid-sentence steps.
 */
export function joinReasoningBlocks(previous: string, incoming: string): string {
  const left = normalizeStreamText(previous);
  const right = normalizeStreamText(incoming);
  if (!left.trim()) return right;
  if (!right.trim()) return left;

  const merged = mergeStreamingText(left, right);
  // mergeStreamingText concatenates raw when there's no overlap; if that fused
  // two word characters at the seam, reinsert the space the chunk split dropped.
  if (merged === left + right) {
    const lastChar = left.slice(-1);
    const firstChar = right.slice(0, 1);
    if (/\w/.test(lastChar) && /\w/.test(firstChar)) {
      return `${left} ${right}`;
    }
  }
  return merged;
}

export function isRedundantStreamingUpdate(previous: string, incoming: string): boolean {
  const left = normalizeStreamText(previous).trim();
  const right = normalizeStreamText(incoming).trim();

  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = Math.min(left.length, right.length);
  if (shorter >= 12 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  const forwardOverlap = getStreamingOverlapLength(left, right);
  const reverseOverlap = getStreamingOverlapLength(right, left);
  const requiredOverlap = Math.max(12, Math.floor(shorter * 0.6));

  return forwardOverlap >= requiredOverlap || reverseOverlap >= requiredOverlap;
}
