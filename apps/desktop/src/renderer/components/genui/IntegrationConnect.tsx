import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { Check, ExternalLink, Loader2, Plug, RefreshCw, Unplug, AlertCircle } from 'lucide-react';
import { getCloudAiHttp } from '../../utils/cloud';

export interface IntegrationItem {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
}

export interface IntegrationConnectProps {
  title?: string;
  message?: string;
  integrations: IntegrationItem[];
  onConnect: (slug: string) => void;
  disabled?: boolean;
  connectedSlugs?: string[];
}

// Map integration slugs to their OAuth connect endpoints
function getConnectUrl(slug: string, token: string): string | null {
  const base = getCloudAiHttp();
  const tokenParam = `token=${encodeURIComponent(token)}`;
  switch (slug) {
    case 'google-sheets': return `${base}/integrations/google/connect?${tokenParam}&target=sheets`;
    case 'google-drive': return `${base}/integrations/google/connect?${tokenParam}&target=drive`;
    case 'google-calendar': return `${base}/integrations/google/connect?${tokenParam}&target=calendar`;
    case 'google-docs': return `${base}/integrations/google/connect?${tokenParam}&target=docs`;
    case 'gmail': return `${base}/integrations/google/connect?${tokenParam}&target=gmail`;
    case 'github': return `${base}/integrations/github/connect?${tokenParam}`;
    case 'discord': return `${base}/integrations/discord/connect?${tokenParam}`;
    case 'reddit': return `${base}/integrations/reddit/connect?${tokenParam}`;
    case 'outlook': return `${base}/integrations/outlook/connect?${tokenParam}`;
    default: return null;
  }
}

function getStatusUrl(slug: string): string | null {
  const base = getCloudAiHttp();
  switch (slug) {
    case 'google-sheets': return `${base}/integrations/google/status?target=sheets`;
    case 'google-drive': return `${base}/integrations/google/status?target=drive`;
    case 'google-calendar': return `${base}/integrations/google/status?target=calendar`;
    case 'google-docs': return `${base}/integrations/google/status?target=docs`;
    case 'gmail': return `${base}/integrations/google/status?target=gmail`;
    case 'github': return `${base}/integrations/github/status`;
    case 'discord': return `${base}/integrations/discord/status`;
    case 'reddit': return `${base}/integrations/reddit/status`;
    case 'outlook': return `${base}/integrations/outlook/status`;
    default: return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const raw = localStorage.getItem('supabase.auth.token') || localStorage.getItem('sb-auth-token');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.currentSession?.access_token || parsed?.access_token || null;
    }
    // Try getting from supabase client if available
    const url = (window as any).__SUPABASE_URL__ || (import.meta as any).env?.VITE_SUPABASE_URL;
    const key = (window as any).__SUPABASE_ANON_KEY__ || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
    if (url && key) {
      const sb = createClient(url, key);
      const { data } = await sb.auth.getSession();
      return data?.session?.access_token || null;
    }
  } catch {}
  return null;
}

// Icons for known integration slugs
const INTEGRATION_ICONS: Record<string, { bg: string; fg: string; emoji: string }> = {
  'google-sheets': { bg: 'from-green-500/20 to-emerald-600/20', fg: 'text-green-500', emoji: '📊' },
  'google-drive': { bg: 'from-blue-500/20 to-cyan-500/20', fg: 'text-blue-400', emoji: '📁' },
  'google-calendar': { bg: 'from-yellow-500/20 to-orange-500/20', fg: 'text-yellow-500', emoji: '📅' },
  'google-docs': { bg: 'from-blue-500/20 to-indigo-500/20', fg: 'text-blue-500', emoji: '📄' },
  'gmail': { bg: 'from-red-500/20 to-rose-500/20', fg: 'text-red-400', emoji: '📧' },
  'github': { bg: 'from-gray-500/20 to-neutral-600/20', fg: 'text-gray-300', emoji: '🐙' },
  'discord': { bg: 'from-indigo-500/20 to-violet-500/20', fg: 'text-indigo-400', emoji: '💬' },
  'reddit': { bg: 'from-orange-500/20 to-red-500/20', fg: 'text-orange-400', emoji: '🔴' },
  'outlook': { bg: 'from-blue-500/20 to-sky-500/20', fg: 'text-blue-400', emoji: '📬' },
  'python': { bg: 'from-yellow-500/20 to-blue-500/20', fg: 'text-yellow-400', emoji: '🐍' },
  'ffmpeg': { bg: 'from-green-600/20 to-lime-500/20', fg: 'text-green-400', emoji: '🎬' },
  'browser': { bg: 'from-purple-500/20 to-fuchsia-500/20', fg: 'text-purple-400', emoji: '🌐' },
  'webhooks': { bg: 'from-cyan-500/20 to-teal-500/20', fg: 'text-cyan-400', emoji: '🔗' },
  'mediapipe': { bg: 'from-pink-500/20 to-rose-500/20', fg: 'text-pink-400', emoji: '👁️' },
};

export const IntegrationConnect: React.FC<IntegrationConnectProps> = ({
  title,
  message,
  integrations,
  onConnect,
  disabled,
  connectedSlugs: externalConnected,
}) => {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set(externalConnected || []));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync external connected state
  useEffect(() => {
    if (externalConnected) {
      setConnected(new Set(externalConnected));
    }
  }, [externalConnected]);

  // Listen for integration status changes
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem('integrations.connected');
        if (raw) {
          const parsed = JSON.parse(raw);
          const slugs = Object.keys(parsed).filter(k => parsed[k]);
          setConnected(new Set(slugs));
          // Clear connecting state if the integration just connected
          if (connecting && slugs.includes(connecting)) {
            setConnecting(null);
          }
        }
      } catch {}
    };
    window.addEventListener('integrations.connected.changed', handler);
    return () => window.removeEventListener('integrations.connected.changed', handler);
  }, [connecting]);

  const handleConnect = useCallback(async (slug: string) => {
    if (disabled || connecting || connected.has(slug)) return;
    setConnecting(slug);
    setErrors(prev => { const n = { ...prev }; delete n[slug]; return n; });

    try {
      // Get access token for OAuth flow
      const token = await getAccessToken();
      if (!token) {
        setErrors(prev => ({ ...prev, [slug]: 'Please sign in first' }));
        setConnecting(null);
        return;
      }

      const connectUrl = getConnectUrl(slug, token);
      if (!connectUrl) {
        // Fall back to parent handler for local integrations (python, ffmpeg, etc.)
        onConnect(slug);
        return;
      }

      // Open OAuth URL in browser
      try {
        (window as any).desktopAPI?.openExternal?.(connectUrl);
      } catch {
        window.open(connectUrl, '_blank');
      }

      // Poll for connection status
      const statusUrl = getStatusUrl(slug);
      if (statusUrl) {
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          if (attempts > 60) {
            clearInterval(poll);
            setErrors(prev => ({ ...prev, [slug]: 'Connection timed out' }));
            setConnecting(null);
            return;
          }
          try {
            const resp = await fetch(statusUrl, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const j = await resp.json().catch(() => null);
            if (j && (j as any).ok && (j as any).connected) {
              clearInterval(poll);
              setConnected(prev => new Set([...prev, slug]));
              setConnecting(null);
              // Update localStorage so dashboard stays in sync
              try {
                const raw = localStorage.getItem('integrations.connected');
                const map = raw ? JSON.parse(raw) : {};
                map[slug] = true;
                localStorage.setItem('integrations.connected', JSON.stringify(map));
                window.dispatchEvent(new Event('integrations.connected.changed'));
              } catch {}
              // Notify parent
              onConnect(slug);
            }
          } catch {}
        }, 2000);
      }
    } catch (err: any) {
      setErrors(prev => ({ ...prev, [slug]: err?.message || 'Connection failed' }));
      setConnecting(null);
    }
  }, [disabled, connecting, connected, onConnect]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div className="w-full my-3" onClick={handleContainerClick}>
      {/* Header */}
      {(title || message) && (
        <div className="mb-3 px-1">
          {title && (
            <div className="flex items-center gap-2 mb-1">
              <Plug className="w-4 h-4 text-primary" />
              <h4 className="text-sm font-bold text-theme-fg">{title}</h4>
            </div>
          )}
          {message && (
            <p className="text-xs text-theme-muted leading-relaxed">{message}</p>
          )}
        </div>
      )}

      {/* Integration Cards */}
      <div className="flex overflow-x-auto gap-3 pb-2 -mx-1 px-1 genui-scrollbar">
        {integrations.map((integration) => {
          const isConnected = connected.has(integration.slug);
          const isConnecting = connecting === integration.slug;
          const hasError = !!errors[integration.slug];
          const iconData = INTEGRATION_ICONS[integration.slug];

          return (
            <motion.button
              key={integration.slug}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                if (!isConnected && !isConnecting) {
                  handleConnect(integration.slug);
                }
              }}
              type="button"
              layout
              whileHover={!disabled && !isConnected && !isConnecting ? { y: -2, scale: 1.02 } : undefined}
              whileTap={!disabled && !isConnected && !isConnecting ? { scale: 0.98 } : undefined}
              className={clsx(
                "flex-shrink-0 flex flex-col items-start min-w-[180px] max-w-[240px] p-4 rounded-xl border text-left transition-all relative overflow-hidden",
                isConnected
                  ? "bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30 shadow-md shadow-emerald-500/5"
                  : isConnecting
                    ? "bg-primary/5 border-primary/30 ring-1 ring-primary/20 shadow-md"
                    : hasError
                      ? "bg-red-500/5 border-red-500/30 hover:border-red-500/50"
                      : "bg-theme-card border-theme/20 hover:border-primary/40 hover:shadow-lg hover:bg-theme-hover/50 cursor-pointer",
                disabled && !isConnected && "opacity-50 grayscale cursor-not-allowed"
              )}
            >
              {/* Glow effect for connecting state */}
              <AnimatePresence>
                {isConnecting && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gradient-to-br from-primary/5 to-primary/10 pointer-events-none"
                  />
                )}
              </AnimatePresence>

              {/* Icon + Status */}
              <div className="flex items-center justify-between w-full mb-3 relative z-10">
                <div className={clsx(
                  "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold bg-gradient-to-br",
                  iconData ? iconData.bg : "from-gray-500/20 to-gray-600/20"
                )}>
                  {integration.icon || iconData?.emoji || '🔌'}
                </div>

                {/* Status indicator */}
                <div className={clsx(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                  isConnected
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : isConnecting
                      ? "bg-primary/20 text-primary border-primary/30"
                      : hasError
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-theme-hover text-theme-muted border-theme/20"
                )}>
                  {isConnected ? (
                    <><Check className="w-3 h-3" /> Connected</>
                  ) : isConnecting ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Connecting</>
                  ) : hasError ? (
                    <><AlertCircle className="w-3 h-3" /> Error</>
                  ) : (
                    <><Plug className="w-3 h-3" /> Connect</>
                  )}
                </div>
              </div>

              {/* Name */}
              <span className={clsx(
                "font-bold text-sm block mb-1 leading-snug relative z-10",
                isConnected ? "text-emerald-400" : isConnecting ? "text-primary" : "text-theme-fg"
              )}>
                {integration.name}
              </span>

              {/* Description */}
              {integration.description && (
                <span className={clsx(
                  "text-xs block w-full opacity-80 leading-relaxed line-clamp-2 relative z-10",
                  isConnected ? "text-emerald-400/70" : "text-theme-muted"
                )}>
                  {integration.description}
                </span>
              )}

              {/* Error message */}
              {hasError && (
                <span className="text-[10px] text-red-400/80 mt-1 relative z-10">
                  {errors[integration.slug]}
                </span>
              )}

              {/* Category badge */}
              {integration.category && (
                <span className={clsx(
                  "text-[9px] font-bold uppercase tracking-widest mt-2 px-1.5 py-0.5 rounded border relative z-10",
                  isConnected
                    ? "bg-emerald-500/10 text-emerald-500/60 border-emerald-500/20"
                    : "bg-theme-hover text-theme-muted/60 border-theme/10"
                )}>
                  {integration.category}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
