
export function hexWithAlpha(hex: string, alpha: number): string {
  try {
    let h = hex.trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return hex;
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
    return `#${h}${a}`;
  } catch {
    return hex;
  }
}

