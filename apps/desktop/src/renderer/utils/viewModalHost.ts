/**
 * Host resolution for view-scoped overlays (file preview, share dialog).
 *
 * Inside the dashboard, overlays portal into #dashboard-view-host (the
 * `relative` content wrapper) with `absolute` positioning so the backdrop
 * covers the current view area — not the sidebar/top-bar chrome. Outside the
 * dashboard (or if the host is missing) they fall back to a body portal with
 * `fixed` positioning, which also dodges transformed-ancestor containment.
 */
export function getViewModalHost(): { host: HTMLElement; positionClass: 'absolute' | 'fixed' } {
  const host = document.getElementById('dashboard-view-host');
  if (host) return { host, positionClass: 'absolute' };
  return { host: document.body, positionClass: 'fixed' };
}
