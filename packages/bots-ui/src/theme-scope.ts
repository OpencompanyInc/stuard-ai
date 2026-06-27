import { useMemo } from 'react';

/**
 * Stuard Studio (the workflow editor) scopes its neutral off-black + subtle-red
 * palette under `[data-wf-theme]` on its root container, remapping the shared
 * `theme-*` / `--primary` tokens to the studio's `--wf-*` values.
 *
 * Modals in this package render through `createPortal(..., document.body)`,
 * which escapes that scope — so without help they fall back to the host app's
 * root theme and look subtly off against the studio. This reads the active
 * studio theme (if any) so a portal root can re-declare `data-wf-theme` and
 * pull the studio token mapping back into the portaled subtree.
 *
 * On surfaces that don't use the studio palette (desktop dashboard, website,
 * VM) there is no `[data-wf-theme]` element, so this returns `undefined` and
 * the portal simply inherits that surface's own root theme — unchanged.
 *
 * Pass a value that changes when the modal (re)opens as `reopenKey` so the
 * lookup re-runs if the surface theme toggles while mounted.
 */
export function useStudioThemeScope(reopenKey?: unknown): 'dark' | 'light' | undefined {
  return useMemo(() => {
    if (typeof document === 'undefined') return undefined;
    const attr = document.querySelector('[data-wf-theme]')?.getAttribute('data-wf-theme');
    return attr === 'dark' || attr === 'light' ? attr : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopenKey]);
}
