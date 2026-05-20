/**
 * Loads declarative integration manifests from apps/cloud-ai/src/integrations/packs/.
 *
 * For the test phase manifests live as static JSON in the repo. Once the
 * marketplace is live, these get read from the marketplace_integrations
 * table — the resolveManifest() function below is the swap-out point.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntegrationManifest } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(__dirname, 'packs');

let cache: Map<string, IntegrationManifest> | null = null;

/** Load every JSON pack from the packs/ folder. Cached. */
export function loadAllPacks(): Map<string, IntegrationManifest> {
  if (cache) return cache;
  const out = new Map<string, IntegrationManifest>();
  let files: string[];
  try {
    files = readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'));
  } catch {
    cache = out;
    return out;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(PACKS_DIR, file), 'utf-8');
      const parsed = JSON.parse(raw) as IntegrationManifest;
      if (!parsed.slug) {
        console.warn(`[integrations] pack ${file} missing slug — skipped`);
        continue;
      }
      if (out.has(parsed.slug)) {
        console.warn(`[integrations] duplicate slug "${parsed.slug}" in ${file} — using first`);
        continue;
      }
      out.set(parsed.slug, parsed);
    } catch (e: any) {
      console.warn(`[integrations] failed to load ${file}:`, e?.message || e);
    }
  }

  cache = out;
  return out;
}

/** Get one manifest by slug, or null when missing. */
export function resolveManifest(slug: string): IntegrationManifest | null {
  return loadAllPacks().get(slug) || null;
}

/** Drop the cache — useful for tests that mutate pack files. */
export function clearManifestCache(): void {
  cache = null;
}
