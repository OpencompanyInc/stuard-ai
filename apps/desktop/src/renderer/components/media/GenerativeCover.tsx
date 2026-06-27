import React, { useMemo } from 'react';
import { File, Film, Music } from 'lucide-react';
import type { MediaKind } from '../../hooks/useMediaLibrary';

/**
 * GenerativeCover — deterministic, on-brand "album art" for media with no real
 * thumbnail (audio, documents, generated audio…). ONE consistent visual
 * language: a soft blurred field of warm Stuard-red hues bleeding into each
 * other — no lines, no waves, no charts. Variation comes only from the seed
 * (which warm hues, where they sit, how big). Same seed → same cover, so the
 * grid stays stable between renders.
 */

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warm, red-led brand hues split into tonal zones. Every cover takes a BRIGHT
// highlight + a MID body + a DEEP shadow so there's real luminance & hue
// contrast — never a flat one-colour wash — while staying in the Stuard family.
type RGB = [number, number, number];
const BRIGHT: RGB[] = [
  [255, 196, 107], // warm gold
  [255, 138, 76],  // orange
  [255, 138, 160], // light rose
];
const MID: RGB[] = [
  [255, 56, 60],   // brand red
  [236, 42, 108],  // magenta
  [255, 99, 90],   // coral red
];
const DEEP: RGB[] = [
  [140, 30, 64],   // maroon
  [104, 34, 86],   // plum
  [84, 22, 44],    // dark wine
];
const BASE = '#150f11';

function rgba([r, g, b]: RGB, a: number) {
  return `rgba(${r},${g},${b},${a})`;
}

function GlyphFor({ kind, className }: { kind: MediaKind; className?: string }) {
  if (kind === 'audio') return <Music className={className} />;
  if (kind === 'video') return <Film className={className} />;
  return <File className={className} />;
}

export function GenerativeCover({
  seed,
  kind,
  className,
  glyph = true,
}: {
  seed: string;
  kind: MediaKind;
  className?: string;
  /** Show a small frosted media glyph in the corner. */
  glyph?: boolean;
}) {
  const bg = useMemo(() => {
    const h = hashSeed(seed || kind || 'stuard');
    const rand = mulberry32(h);
    const from = (zone: RGB[]) => zone[Math.floor(rand() * zone.length)];
    const pos = () => ({ x: (4 + rand() * 92).toFixed(0), y: (4 + rand() * 92).toFixed(0) });
    const blob = (c: RGB, alpha: number, lo: number, hi: number) => {
      const { x, y } = pos();
      const spread = (lo + rand() * (hi - lo)).toFixed(0);
      // fade to the SAME hue at 0 alpha (not `transparent`) to avoid grey fringing
      return `radial-gradient(circle at ${x}% ${y}%, ${rgba(c, alpha)} 0%, ${rgba(c, 0)} ${spread}%)`;
    };
    // CSS paints the FIRST gradient on top → list front-to-back: bright
    // highlight(s) → two mid bodies → broad deep shadow at the back.
    const layers: string[] = [];
    if (rand() > 0.5) layers.push(blob(from(BRIGHT), 0.7, 22, 36)); // occasional 2nd highlight
    layers.push(blob(from(BRIGHT), 0.92, 30, 48));
    layers.push(blob(from(MID), 0.78, 40, 58));
    layers.push(blob(from(MID), 0.9, 44, 64));
    layers.push(blob(from(DEEP), 0.85, 58, 82));
    return layers.join(', ');
  }, [seed, kind]);

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', background: BASE }}>
      <div
        style={{
          position: 'absolute',
          inset: '-24%',
          backgroundColor: BASE,
          backgroundImage: bg,
          filter: 'blur(16px) saturate(1.15)',
        }}
      />
      {/* subtle top sheen for depth */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%, rgba(0,0,0,0.18))',
        }}
      />
      {glyph && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {kind === 'audio' ? (
            // Vinyl disc with a brand-red label — reads as album art.
            <svg
              viewBox="0 0 100 100"
              style={{ width: 'min(52%, 140px)', height: 'auto', display: 'block', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.45))' }}
              aria-hidden="true"
            >
              <circle cx="50" cy="50" r="48" fill="rgba(8,7,8,0.55)" />
              <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.8" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.6" />
              <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.6" />
              <circle cx="50" cy="50" r="22" fill="rgba(255,255,255,0.05)" />
              <circle cx="50" cy="50" r="15" fill="var(--primary)" />
              <circle cx="50" cy="50" r="6" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
              <circle cx="50" cy="50" r="2.4" fill="rgba(0,0,0,0.55)" />
            </svg>
          ) : (
            <span
              className="flex items-center justify-center rounded-full"
              style={{
                width: 'min(38%, 56px)',
                aspectRatio: '1',
                background: 'rgba(0,0,0,0.30)',
                backdropFilter: 'blur(6px)',
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              <GlyphFor kind={kind} className="h-1/2 w-1/2" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default GenerativeCover;
