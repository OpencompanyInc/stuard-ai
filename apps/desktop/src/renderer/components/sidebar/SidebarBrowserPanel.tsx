import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ExternalLink,
  Globe,
  Loader2,
  Monitor,
  MousePointer,
  RefreshCw,
  Square,
} from 'lucide-react';

interface BrowserStatus {
  ok?: boolean;
  installed?: boolean;
  running?: boolean;
  serverAlive?: boolean;
  mode?: string;
  profile?: string;
  currentUrl?: string;
  url?: string;
  title?: string;
  error?: string;
  sessionId?: string;
  lastActiveSessionId?: string;
}

function normalizeBrowserUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'about:blank';
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
}

/** Map DOM keyboard events to Playwright key names */
function toPlaywrightKey(e: React.KeyboardEvent): string | null {
  const map: Record<string, string> = {
    Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
    Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  };
  if (map[e.key]) return map[e.key];
  // Modifier combos
  if (e.ctrlKey || e.metaKey || e.altKey) {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    return parts.join('+');
  }
  return null; // normal printable char — handled as text
}

interface SidebarBrowserPanelProps {
  className?: string;
}

export const SidebarBrowserPanel: React.FC<SidebarBrowserPanelProps> = ({ className }) => {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('default');
  const [recentActivity, setRecentActivity] = useState(false);
  const activityResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screenshot mirror state — double-buffered to prevent flicker
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [viewportSize, setViewportSize] = useState({ w: 1280, h: 900 });
  const [address, setAddress] = useState('');
  const [interacting, setInteracting] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const mirrorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMirroringRef = useRef(false);
  // Double-buffer: pre-load new screenshot offscreen before swapping
  const pendingImgRef = useRef<HTMLImageElement | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);

  const api = (window as any).desktopAPI;

  // --- Status polling ---
  const refreshStatus = useCallback(async () => {
    try {
      const result = await api?.execTool?.('browser_use_status', {
        session_id: activeSessionId,
        follow_last_active: true,
      });
      if (result && typeof result === 'object') {
        const nextSessionId = String(result.sessionId || result.lastActiveSessionId || activeSessionId || 'default').trim() || 'default';
        if (nextSessionId !== activeSessionId) setActiveSessionId(nextSessionId);
        setStatus(result);
      }
    } catch (e: any) {
      setStatus({ ok: false, error: String(e?.message || e || 'Failed to load') });
    }
  }, [activeSessionId, api]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    const interval = setInterval(() => void refreshStatus(), recentActivity ? 2000 : 5000);
    return () => clearInterval(interval);
  }, [recentActivity, refreshStatus]);

  // --- Browser activity listener ---
  useEffect(() => {
    const unsub = api?.onBrowserActivity?.((data: any) => {
      const nextSessionId = String(data?.sessionId || 'default').trim() || 'default';
      setActiveSessionId(nextSessionId);
      setRecentActivity(true);
      if (activityResetRef.current) clearTimeout(activityResetRef.current);
      activityResetRef.current = setTimeout(() => setRecentActivity(false), 10000);
    });
    return () => {
      if (activityResetRef.current) { clearTimeout(activityResetRef.current); activityResetRef.current = null; }
      try { typeof unsub === 'function' && unsub(); } catch {}
    };
  }, [api]);

  // --- Screenshot mirror polling (double-buffered) ---
  const captureScreenshot = useCallback(async () => {
    if (isMirroringRef.current) return; // skip if previous capture still in flight
    isMirroringRef.current = true;
    try {
      const result = await api?.browserMirrorScreenshot?.(activeSessionId, 55);
      if (result?.ok && result.dataUrl) {
        // Double-buffer: load the new image offscreen first, then swap
        const dataUrl: string = result.dataUrl;
        const img = new Image();
        img.onload = () => {
          // Revoke previous blob URL if we created one
          if (prevBlobUrlRef.current) {
            try { URL.revokeObjectURL(prevBlobUrlRef.current); } catch {}
            prevBlobUrlRef.current = null;
          }
          setScreenshotUrl(dataUrl);
          pendingImgRef.current = null;
        };
        img.onerror = () => { pendingImgRef.current = null; };
        pendingImgRef.current = img;
        img.src = dataUrl;

        if (result.url) { setPageUrl(result.url); if (!interacting) setAddress(result.url); }
        if (result.title) setPageTitle(result.title);
        if (result.viewportWidth && result.viewportHeight) {
          setViewportSize({ w: result.viewportWidth, h: result.viewportHeight });
        }
      }
    } catch { /* ignore */ }
    isMirroringRef.current = false;
  }, [activeSessionId, api, interacting]);

  const isRunning = !!status?.running && !!status?.serverAlive;

  useEffect(() => {
    if (mirrorIntervalRef.current) { clearInterval(mirrorIntervalRef.current); mirrorIntervalRef.current = null; }
    if (!isRunning) { setScreenshotUrl(null); return; }

    // Immediate first capture
    void captureScreenshot();
    // Poll: moderate pace to avoid flicker — the double-buffer handles smoothness
    const ms = (recentActivity || interacting) ? 800 : 1500;
    mirrorIntervalRef.current = setInterval(() => void captureScreenshot(), ms);

    return () => {
      if (mirrorIntervalRef.current) { clearInterval(mirrorIntervalRef.current); mirrorIntervalRef.current = null; }
    };
  }, [isRunning, recentActivity, interacting, captureScreenshot]);

  // --- Click forwarding ---
  const handleMirrorClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || !isRunning) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = viewportSize.w / rect.width;
    const scaleY = viewportSize.h / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setInteracting(true);
    await api?.browserMirrorClickAt?.(activeSessionId, x, y, 'click');
    // Single delayed capture — polling handles the rest
    setTimeout(() => void captureScreenshot(), 350);
    setTimeout(() => setInteracting(false), 3000);
  }, [activeSessionId, api, captureScreenshot, isRunning, viewportSize]);

  // --- Scroll forwarding ---
  const handleMirrorWheel = useCallback((e: React.WheelEvent) => {
    if (!isRunning) return;
    e.preventDefault();
    const direction = e.deltaY > 0 ? 'down' : 'up';
    const amount = Math.min(800, Math.max(100, Math.abs(e.deltaY) * 2));
    api?.browserMirrorScroll?.(activeSessionId, direction, amount);
    // Single delayed capture — polling handles the rest
    setTimeout(() => void captureScreenshot(), 400);
  }, [activeSessionId, api, captureScreenshot, isRunning]);

  // --- Keyboard forwarding (when mirror is focused) ---
  const handleMirrorKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isRunning) return;
    const pwKey = toPlaywrightKey(e);
    if (pwKey) {
      e.preventDefault();
      api?.browserMirrorPressKey?.(activeSessionId, pwKey);
      setTimeout(() => void captureScreenshot(), 200);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      api?.browserMirrorType?.(activeSessionId, e.key);
      setTimeout(() => void captureScreenshot(), 200);
    }
  }, [activeSessionId, api, captureScreenshot, isRunning]);

  // --- Actions ---
  const runAction = useCallback(async (label: string, fn: () => Promise<any>) => {
    setLoading(true);
    setActionLabel(label);
    try {
      await fn();
      await refreshStatus();
    } finally {
      setLoading(false);
      setActionLabel('');
    }
  }, [refreshStatus]);

  const handleLaunch = useCallback(async () => {
    await runAction('Launching browser...', async () => {
      // Launch headless so no separate window appears — sidebar is the viewer
      await api?.execTool?.('browser_use_configure', {
        mode: 'headless',
        profile: 'default',
        session_id: activeSessionId,
      });
      setRecentActivity(true);
    });
  }, [activeSessionId, api, runAction]);

  const handleNavigate = useCallback(async () => {
    const target = normalizeBrowserUrl(address);
    setAddress(target);
    if (isRunning) {
      setInteracting(true);
      await api?.execTool?.('browser_use_navigate', {
        url: target,
        wait_until: 'domcontentloaded',
        timeout: 60000,
        session_id: activeSessionId,
      });
      setTimeout(() => void captureScreenshot(), 600);
      setTimeout(() => setInteracting(false), 3000);
    }
  }, [activeSessionId, address, api, captureScreenshot, isRunning]);

  const handleReload = useCallback(async () => {
    if (!isRunning || !pageUrl) return;
    setInteracting(true);
    await api?.execTool?.('browser_use_navigate', {
      url: pageUrl,
      wait_until: 'domcontentloaded',
      timeout: 60000,
      session_id: activeSessionId,
    });
    setTimeout(() => void captureScreenshot(), 500);
    setTimeout(() => setInteracting(false), 3000);
  }, [activeSessionId, api, captureScreenshot, isRunning, pageUrl]);

  const handleOpenExternal = useCallback(async () => {
    const url = pageUrl || address;
    if (url) { try { await api?.openExternal?.(url); } catch {} }
  }, [address, api, pageUrl]);

  const handleStop = useCallback(async () => {
    await runAction('Stopping...', async () => {
      await api?.execTool?.('browser_use_stop', { session_id: activeSessionId });
    });
    setScreenshotUrl(null);
  }, [activeSessionId, api, runAction]);

  const derived = useMemo(() => ({
    running: isRunning,
    currentUrl: pageUrl,
    title: pageTitle,
    installed: status?.installed !== false,
    error: status?.error ? String(status.error) : '',
    sessionId: String(status?.sessionId || activeSessionId || 'default'),
  }), [activeSessionId, isRunning, pageTitle, pageUrl, status]);

  return (
    <div className={clsx('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      {/* Address bar */}
      <div className="shrink-0 border-b border-theme/10 bg-theme-card/95 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              onClick={handleReload}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-theme/10 bg-theme-bg text-theme-fg transition-colors hover:bg-theme-hover"
              title="Reload"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <input
              value={address}
              onChange={(e) => { setAddress(e.target.value); setInteracting(true); }}
              onBlur={() => setInteracting(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleNavigate(); }
              }}
              placeholder={isRunning ? 'Enter URL...' : 'Browser not running'}
              disabled={!isRunning}
              className="w-full rounded-lg border border-theme/10 bg-theme-bg px-2.5 py-1.5 text-xs text-theme-fg outline-none placeholder:text-theme-muted focus:border-theme/25 disabled:opacity-50"
            />
          </div>
          {isRunning && (
            <>
              <button
                onClick={handleOpenExternal}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-theme/10 bg-theme-bg text-theme-fg transition-colors hover:bg-theme-hover"
                title="Open in system browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => void handleStop()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 transition-colors hover:bg-red-500/20"
                title="Stop browser"
              >
                <Square className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        {isRunning && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-theme-muted">
            <span className={clsx(
              'inline-flex items-center rounded-full px-1.5 py-0.5 font-bold uppercase tracking-wider',
              recentActivity ? 'bg-emerald-500/15 text-emerald-500' : 'bg-blue-500/10 text-blue-500'
            )}>
              {recentActivity ? 'Live' : 'Mirror'}
            </span>
            <span className="truncate flex-1">{derived.title || 'Untitled'}</span>
          </div>
        )}
      </div>

      {!!derived.error && (
        <div className="border-b border-red-500/10 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-600 dark:text-red-300">
          {derived.error}
        </div>
      )}

      {/* Main content area */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-neutral-900">
        {isRunning && screenshotUrl ? (
          /* Screenshot mirror — shows agent's actual browser */
          <div
            className="w-full h-full flex items-center justify-center overflow-hidden cursor-crosshair"
            tabIndex={0}
            onKeyDown={handleMirrorKeyDown}
            onWheel={handleMirrorWheel}
          >
            <img
              ref={imgRef}
              src={screenshotUrl}
              alt="Browser mirror"
              onClick={handleMirrorClick}
              draggable={false}
              className="max-w-full max-h-full object-contain select-none"
              style={{ imageRendering: 'auto', willChange: 'contents' }}
            />
          </div>
        ) : isRunning && !screenshotUrl ? (
          /* Loading first screenshot */
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-theme-muted">
              <Loader2 className="w-8 h-8 animate-spin opacity-50" />
              <span className="text-xs">Connecting to browser...</span>
            </div>
          </div>
        ) : (
          /* Not running — show launch prompt */
          <div className="flex items-center justify-center h-full p-6">
            <div className="flex flex-col items-center gap-4 text-center max-w-[280px]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-theme-card border border-theme/10">
                <Globe className="w-7 h-7 text-theme-muted" />
              </div>
              <div>
                <div className="text-sm font-semibold text-theme-fg mb-1">Browser Mirror</div>
                <div className="text-[11px] text-theme-muted leading-relaxed">
                  Launch the browser to see the agent's live view here. Clicks, scrolling, and typing are forwarded to the agent's browser.
                </div>
              </div>
              {!derived.installed && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-300">
                  Browser runtime not installed. It will be installed on first launch.
                </div>
              )}
              <button
                onClick={() => void handleLaunch()}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50 shadow-lg shadow-blue-600/20"
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {actionLabel}
                  </span>
                ) : 'Launch Browser'}
              </button>
            </div>
          </div>
        )}

        {/* Interaction hint overlay */}
        {isRunning && screenshotUrl && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] text-white/70">
              <MousePointer className="w-3 h-3" />
              Click to interact
            </span>
          </div>
        )}

        {loading && (
          <div className="absolute top-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white shadow-lg">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {actionLabel || 'Loading'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidebarBrowserPanel;
