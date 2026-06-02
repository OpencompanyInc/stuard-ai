/**
 * UI Packages tools — install/manage local package sets for custom_ui
 * (install once, reference by name). Bundling runs in the main process via
 * esbuild.
 */

import { RouterContext } from '../types';
import {
  installUiPackages,
  getUiPackagesStatus,
  listUiPackageSets,
  removeUiPackageSet,
  CURATED_UI_PACKAGES,
} from '../../custom-ui/ui-packages';

function asPackages(args: any): string[] {
  const raw = args?.packages ?? args?.package ?? args?.libraries;
  if (Array.isArray(raw)) return raw.map((p) => String(p || '').trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveSetId(args: any): string {
  return String(args?.set || args?.setId || args?.name || args?.id || 'default').trim() || 'default';
}

export async function execUiPackagesInstall(args: any, ctx: RouterContext): Promise<any> {
  const setId = resolveSetId(args);
  const packages = asPackages(args);
  if (!packages.length) {
    return {
      ok: false,
      error: 'No packages provided. Pass packages: ["recharts", "lucide-react", ...]',
      curated: CURATED_UI_PACKAGES,
    };
  }

  const mode = args?.mode === 'set' ? 'set' : 'add';
  const allowNpm = args?.allowNpm === true || args?.allowNpm === 'true';
  const force = args?.force === true || args?.force === 'true';

  try {
    const status = await installUiPackages({
      setId,
      packages,
      mode,
      allowNpm,
      force,
      logFn: ctx.logFn,
    });
    const ok = status.built && (status.failed?.length ?? 0) === 0;
    const failedSummary = (status.failed || []).map((f) => `${f.name} (${f.reason})`).join('; ');
    const message = ok
      ? `Packages ready for set "${status.id}": ${status.modules.join(', ') || '(none)'}. Use them via custom_ui args { uiPackageSet: "${status.id}" }.`
      : `Set "${status.id}" built with issues. Failed: ${failedSummary}`;
    return {
      ok,
      set: status.id,
      installed: status.modules,
      packages: status.packages,
      failed: status.failed,
      jsBytes: status.jsBytes,
      cssBytes: status.cssBytes,
      hash: status.hash,
      message,
      error: ok ? undefined : failedSummary || `ui_packages_install failed for set "${status.id}"`,
    };
  } catch (e: any) {
    return { ok: false, set: setId, error: String(e?.message || e) };
  }
}

export async function execUiPackagesStatus(args: any, _ctx: RouterContext): Promise<any> {
  const setId = resolveSetId(args);
  const status = getUiPackagesStatus(setId);
  return { ok: true, ...status };
}

export async function execUiPackagesList(_args: any, _ctx: RouterContext): Promise<any> {
  return { ok: true, sets: listUiPackageSets(), curated: CURATED_UI_PACKAGES };
}

export async function execUiPackagesRemove(args: any, _ctx: RouterContext): Promise<any> {
  const setId = String(args?.set || args?.setId || args?.name || args?.id || '').trim();
  if (!setId) return { ok: false, error: 'set (package set name) is required' };
  const res = removeUiPackageSet(setId);
  return { ok: res.ok, set: setId };
}
