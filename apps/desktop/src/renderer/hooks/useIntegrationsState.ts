import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { preloadIntegrationBrandLogos } from "../components/integrationIcons";

function deferUntilPaint(cb: () => void, timeoutMs = 180): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) cb();
  };
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      cancelled = true;
      cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(run, 32);
  return () => {
    cancelled = true;
    clearTimeout(id);
  };
}
import type { Session } from "@supabase/supabase-js";
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from "../../../../../shared/integration-flags";

/** Google product slugs whose connection state is resolved from the local OAuth store. */
const GOOGLE_INTEGRATION_SLUGS = [
  "gmail",
  "google-drive",
  "google-calendar",
  "google-sheets",
  "google-docs",
  "google-tasks",
] as const;

/** Scope → slug mapping — keep in sync with SCOPE_MAP in cloud-ai routes/integrations/google.ts */
const GOOGLE_SCOPE_TO_SLUG: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.send": "gmail",
  "https://www.googleapis.com/auth/drive.file": "google-drive",
  "https://www.googleapis.com/auth/calendar.events": "google-calendar",
  "https://www.googleapis.com/auth/spreadsheets": "google-sheets",
  "https://www.googleapis.com/auth/documents": "google-docs",
  "https://www.googleapis.com/auth/tasks": "google-tasks",
};

function isGoogleIntegrationSlug(slug: string): boolean {
  return (GOOGLE_INTEGRATION_SLUGS as readonly string[]).includes(slug);
}

function googleScopesToConnectedSlugs(scopes: unknown[]): Record<string, boolean> {
  const scopeSet = new Set(scopes.map((s) => String(s)));
  const out: Record<string, boolean> = {};
  for (const [scope, slug] of Object.entries(GOOGLE_SCOPE_TO_SLUG)) {
    if (scopeSet.has(scope)) out[slug] = true;
  }
  return out;
}

async function execLocalAgentTool(
  agentHttp: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<any | null> {
  try {
    const resp = await fetch(`${agentHttp}/v1/tools/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    });
    return await resp.json().catch(() => null);
  } catch {
    return null;
  }
}

async function fetchLocalOAuthTokens(agentHttp: string): Promise<{ ok: boolean; tokens: any[] }> {
  const j = await execLocalAgentTool(agentHttp, "oauth_list", {});
  if (j && (j as any).ok && Array.isArray((j as any).tokens)) {
    return { ok: true, tokens: (j as any).tokens };
  }
  return { ok: false, tokens: [] };
}

/** Shape returned by the profiles API */
interface IntegrationProfile {
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email?: string | null;
  scopes_csv?: string | null;
}

function localOAuthTokenToProfile(token: any): IntegrationProfile {
  const scopes = Array.isArray(token?.scopes) ? token.scopes : [];
  return {
    provider: String(token?.provider || "").toLowerCase(),
    profile_label: String(token?.profileLabel || token?.profile_label || "default"),
    is_default: !!(token?.isDefault ?? token?.is_default),
    account_email: token?.accountEmail || token?.account_email || null,
    scopes_csv: scopes.length > 0 ? scopes.join(",") : null,
  };
}

interface UseIntegrationsStateArgs {
  session: Session | null;
  AGENT_HTTP: string;
  CLOUD_AI_HTTP: string;
  statusChecksEnabled?: boolean;
}

export function useIntegrationsState({ session, AGENT_HTTP, CLOUD_AI_HTTP, statusChecksEnabled = true }: UseIntegrationsStateArgs) {
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({});
  const [intQuery, setIntQuery] = useState("");
  const [intCategory, setIntCategory] = useState("All");
  const [pyStatus, setPyStatus] = useState<any | null>(null);
  const [ffStatus, setFfStatus] = useState<any | null>(null);
  const [ffInstalling, setFfInstalling] = useState<boolean>(false);
  const [mpStatus, setMpStatus] = useState<any | null>(null);
  const [mpInstalling, setMpInstalling] = useState<boolean>(false);
  // Local status (desktop main: integrations dir, running process state)
  const [mpLocalStatus, setMpLocalStatus] = useState<any | null>(null);
  const [mpUpdateInfo, setMpUpdateInfo] = useState<any | null>(null);
  const [mpUpdating, setMpUpdating] = useState<boolean>(false);
  // Data Analysis (pandas/numpy/scipy + matplotlib/seaborn in dedicated on-demand venv)
  const [daStatus, setDaStatus] = useState<any | null>(null);
  const [daInstalling, setDaInstalling] = useState<boolean>(false);
  const [daUninstalling, setDaUninstalling] = useState<boolean>(false);
  const [browserUseLocalStatus, setBrowserUseLocalStatus] = useState<any | null>(null);
  const [browserUseUpdateInfo, setBrowserUseUpdateInfo] = useState<any | null>(null);
  const [browserUseUpdating, setBrowserUseUpdating] = useState<boolean>(false);
  const [pyEnvId, setPyEnvId] = useState<string>("default");
  const [pyPackages, setPyPackages] = useState<string>("");
  const [pyReqTxt, setPyReqTxt] = useState<string>("");
  const [pyPackagesList, setPyPackagesList] = useState<Array<{ name: string; version: string }>>([]);
  const [pyPackagesLoading, setPyPackagesLoading] = useState<boolean>(false);
  const [pyInstallMessage, setPyInstallMessage] = useState<string | null>(null);
  const [pyInstalling, setPyInstalling] = useState<boolean>(false);
  const [pyRunning, setPyRunning] = useState<boolean>(false);
  const [pyRunCode, setPyRunCode] = useState<string>("print(\"hello from python\")");
  const [pyRunResult, setPyRunResult] = useState<any | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<any | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState<boolean>(false);
  const [browserUseStatus, setBrowserUseStatus] = useState<any | null>(null);
  const [browserUseChecking, setBrowserUseChecking] = useState<boolean>(false);
  const [browserUseSetupProgress, setBrowserUseSetupProgress] = useState<string | null>(null);
  const [cliAgentStatus, setCliAgentStatus] = useState<any | null>(null);
  const [cliAgentChecking, setCliAgentChecking] = useState<boolean>(false);
  const [telnyxPhones, setTelnyxPhones] = useState<Array<{phone: string, slot: number}>>([]);
  const [telnyxVerifying, setTelnyxVerifying] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState<string | null>(null);
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  const [whatsappLinking, setWhatsappLinking] = useState(false);
  const [whatsappLinkCode, setWhatsappLinkCode] = useState<string | null>(null);
  const [whatsappBotNumber, setWhatsappBotNumber] = useState<string | null>(null);

  // ── Profile state ──
  const [profiles, setProfiles] = useState<IntegrationProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

  const emitConnectedChanged = () => {
    try {
      window.dispatchEvent(new Event('integrations.connected.changed'));
    } catch {}
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("integrations.connected");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          try { delete (parsed as any)['browser-control']; } catch { }
          try { delete (parsed as any)['browser']; } catch { }
          // Google is resolved from the local OAuth store on sync — skip stale cache.
          for (const slug of GOOGLE_INTEGRATION_SLUGS) {
            try { delete (parsed as any)[slug]; } catch { }
          }
        }
        setConnectedMap(parsed);
      }
    } catch {}
  }, []);

  const syncConnectedFromServer = useCallback(async (authToken?: string) => {
    const token = authToken || session?.access_token;
    if (!token) return;

    try {
      const headers = { Authorization: `Bearer ${token}` } as const;
      const serverConnected: Record<string, boolean | null> = {};

      const fetchStatus = async (url: string, slug: string) => {
        try {
          const resp = await fetch(url, { headers });
          const j = await resp.json().catch(() => null);
          if (j && (j as any).ok) {
            // Server confirmed the check succeeded — trust the result
            serverConnected[slug] = !!(j as any).connected;
          } else {
            // Server returned an error (auth failure, 500, etc.) — treat as transient
            serverConnected[slug] = null;
          }
        } catch {
          // Keep previous state on transient errors.
          serverConnected[slug] = null;
        }
      };

      await Promise.all([
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/github/status`, "github"),
        ...(OUTLOOK_INTEGRATION_ENABLED
          ? [fetchStatus(`${CLOUD_AI_HTTP}/integrations/outlook/status`, "outlook")]
          : []),
        // Google status is resolved from the local encrypted store below — skip
        // server polls so stale Supabase/empty-VM responses can't override truth.
        ...(DISCORD_INTEGRATION_ENABLED
          ? [fetchStatus(`${CLOUD_AI_HTTP}/integrations/discord/status`, "discord")]
          : []),
        ...(REDDIT_INTEGRATION_ENABLED
          ? [fetchStatus(`${CLOUD_AI_HTTP}/integrations/reddit/status`, "reddit")]
          : []),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/x/status`, "x"),
        ...(META_INTEGRATION_ENABLED
          ? [
              fetchStatus(`${CLOUD_AI_HTTP}/integrations/facebook/status`, "facebook"),
              fetchStatus(`${CLOUD_AI_HTTP}/integrations/instagram/status`, "instagram"),
              fetchStatus(`${CLOUD_AI_HTTP}/integrations/threads/status`, "threads"),
            ]
          : []),
        (async () => {
          try {
            const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/status`, { headers });
            const j = await resp.json().catch(() => null);
            if (j && (j as any).ok) {
              serverConnected['telnyx'] = !!(j as any).connected;
              const phones = Array.isArray((j as any).phones) ? (j as any).phones : [];
              setTelnyxPhones(phones);
            } else {
              serverConnected['telnyx'] = null;
            }
          } catch {
            serverConnected['telnyx'] = null;
          }
        })(),
        ...(WHATSAPP_INTEGRATION_ENABLED
          ? [fetchStatus(`${CLOUD_AI_HTTP}/integrations/whatsapp/status`, "whatsapp")]
          : []),
      ]);

      // Device-local Google status — authoritative when the local agent responds.
      const localGoogleConnected: Record<string, boolean> = {};
      let localOAuthReachable = false;
      const { ok: localOAuthOk, tokens: localTokens } = await fetchLocalOAuthTokens(AGENT_HTTP);
      if (localOAuthOk) {
        localOAuthReachable = true;
        for (const token of localTokens) {
          if (String(token?.provider || "").toLowerCase() !== "google") continue;
          const slugs = googleScopesToConnectedSlugs(Array.isArray(token.scopes) ? token.scopes : []);
          for (const [slug, connected] of Object.entries(slugs)) {
            if (connected) localGoogleConnected[slug] = true;
          }
        }
      }

      startTransition(() => setConnectedMap((prev) => {
        const next: Record<string, boolean> = {};
        // Preserve local-only integration states
        if (prev.python) next.python = true;
        if (prev.webhooks) next.webhooks = true;
        if (prev.ffmpeg) next.ffmpeg = true;
        if (prev.mediapipe) next.mediapipe = true;
        if (prev['data-analysis']) next['data-analysis'] = true;
        if (prev.ollama) next.ollama = true;
        if (prev.browser_use) next.browser_use = true;
        if (prev['agent-cli']) next['agent-cli'] = true;

        // Google slugs: local store is source of truth when the agent is reachable.
        if (localOAuthReachable) {
          for (const slug of GOOGLE_INTEGRATION_SLUGS) {
            if (localGoogleConnected[slug]) next[slug] = true;
          }
        }

        for (const [slug, connected] of Object.entries(serverConnected)) {
          if (isGoogleIntegrationSlug(slug)) {
            // Already handled from local store above; never preserve stale cache.
            continue;
          }
          if (connected === true) {
            next[slug] = true;
            continue;
          }
          // Preserve previously-connected state on transient errors (null)
          // AND when server says not-connected (false) — the server's local
          // token DB may have been wiped by a redeploy.  Explicit disconnects
          // go through their own handlers that update connectedMap directly,
          // so this won't prevent real user-initiated disconnects.
          if (prev[slug]) {
            next[slug] = true;
          }
        }

        // Agent unreachable: fall back to cached Google state (offline/desktop asleep).
        if (!localOAuthReachable) {
          for (const slug of GOOGLE_INTEGRATION_SLUGS) {
            if (prev[slug]) next[slug] = true;
          }
        }

        try {
          localStorage.setItem("integrations.connected", JSON.stringify(next));
        } catch {}
        emitConnectedChanged();
        return next;
      }));
    } catch {}
  }, [session?.access_token, CLOUD_AI_HTTP, AGENT_HTTP]);

  useEffect(() => {
    if (!statusChecksEnabled) return;
    preloadIntegrationBrandLogos();
    (async () => {
      try {
        await syncConnectedFromServer();
      } catch {}
    })();
  }, [statusChecksEnabled, syncConnectedFromServer]);

  // Regular integrations (OAuth-based, not MCPs)
  const integrationLibraryRaw = useMemo(
    () => [
      { slug: "python", name: "Python", description: "Required for local tools. Stuard sets it up automatically when needed.", category: "Local", homepage: "https://www.python.org/", available: true },
      { slug: "ffmpeg", name: "FFmpeg", description: "Convert and edit audio & video files. Installs automatically when needed.", category: "Local", homepage: "https://ffmpeg.org/", available: true },
      { slug: "mediapipe", name: "MediaPipe", description: "See and understand images and video — hand tracking, face detection, body pose, and more.", category: "Local", homepage: "https://mediapipe.dev/", available: true },
      { slug: "data-analysis", name: "Data Analysis", description: "Analyze and visualize data with pandas, numpy, scipy, matplotlib, and seaborn. Installed on demand into an isolated environment.", category: "Local", homepage: "https://pandas.pydata.org/", available: true },
      { slug: "ollama", name: "Ollama", description: "Run AI models privately on your computer — chat, vision, embeddings, no data leaves your device.", category: "Local", homepage: "https://ollama.com/", available: true },
      { slug: "browser-use", name: "Stuard Browser", description: "Let Stuard browse the web for you — fill forms, search, log in, and complete tasks. Saves your cookies and sessions.", category: "Local", homepage: "https://stuard.ai/", available: true },
      { slug: "agent-cli", name: "Agent CLI", description: "Delegate coding work to installed CLIs: Codex, Cursor Agent, Antigravity, or Claude Code.", category: "Development", homepage: "https://github.com/openai/codex", available: true },
      // Disabled — Outlook/Discord/Reddit integrations temporarily hidden (see shared/integration-flags.ts)
      ...(OUTLOOK_INTEGRATION_ENABLED
        ? [{ slug: "outlook", name: "Outlook", description: "Connect Microsoft Outlook via PKCE to read mail (Mail.Read).", category: "Communication", homepage: "https://learn.microsoft.com/graph/", available: true }]
        : []),
      { slug: "github", name: "GitHub", description: "Read repos and issues.", category: "Development", homepage: "https://github.com/", available: true },
      ...(DISCORD_INTEGRATION_ENABLED
        ? [{ slug: "discord", name: "Discord", description: "Read and send messages, list servers and DMs.", category: "Communication", homepage: "https://discord.com/", available: true }]
        : []),
      ...(REDDIT_INTEGRATION_ENABLED
        ? [{ slug: "reddit", name: "Reddit", description: "Browse, search, post, and comment on Reddit.", category: "Communication", homepage: "https://reddit.com/", available: true }]
        : []),
      { slug: "x", name: "X (Twitter)", description: "Read timelines, post tweets, send DMs, and look up users. Pay-as-you-go API usage is deducted from your Stuard credits.", category: "Communication", homepage: "https://x.com/", available: true },
      // Disabled — Meta integrations temporarily hidden (see shared/integration-flags.ts)
      ...(META_INTEGRATION_ENABLED
        ? [
            { slug: "facebook", name: "Facebook", description: "Connect your Facebook account with OAuth for social automations and account access.", category: "Communication", homepage: "https://www.facebook.com/", available: true },
            { slug: "instagram", name: "Instagram", description: "Connect Instagram with OAuth and securely store access tokens for account-based features.", category: "Communication", homepage: "https://www.instagram.com/", available: true },
            { slug: "threads", name: "Threads", description: "Connect your Threads account with OAuth for identity and future publishing workflows.", category: "Communication", homepage: "https://www.threads.net/", available: true },
          ]
        : []),
      { slug: "google-drive", name: "Google Drive", description: "Access and search files.", category: "Files", homepage: "https://drive.google.com/", available: true },
      { slug: "webhooks", name: "Webhooks", description: "Trigger custom workflows via HTTP callbacks.", category: "Automation", homepage: "https://webhook.site/", available: true },
      { slug: "google-calendar", name: "Google Calendar", description: "Manage events and reminders.", category: "Productivity", homepage: "https://calendar.google.com/", available: true },
      { slug: "gmail", name: "Gmail", description: "Send and read email.", category: "Communication", homepage: "https://mail.google.com/", available: true },
      { slug: "google-sheets", name: "Google Sheets", description: "Read spreadsheet ranges.", category: "Data", homepage: "https://sheets.google.com/", available: true },
      { slug: "google-docs", name: "Google Docs", description: "Read document content.", category: "Files", homepage: "https://docs.google.com/", available: true },
      { slug: "google-tasks", name: "Google Tasks", description: "List, create, and complete tasks.", category: "Productivity", homepage: "https://tasks.google.com/", available: true },
      { slug: "telnyx", name: "Phone (SMS/Call)", description: "Verify your phone number to receive SMS and voice call notifications from Stuard.", category: "Communication", homepage: "https://telnyx.com/", available: true },
      // Disabled — WhatsApp integration temporarily hidden (see shared/integration-flags.ts)
      ...(WHATSAPP_INTEGRATION_ENABLED
        ? [{ slug: "whatsapp", name: "WhatsApp", description: "Connect your WhatsApp number to receive messages, voice notes, images, and files from Stuard.", category: "Communication", homepage: "https://business.whatsapp.com/", available: true }]
        : []),
    ],
    []
  );

  const integrationLibrary = useMemo(() => integrationLibraryRaw, [integrationLibraryRaw]);

  const intCategories = useMemo(() => {
    const set = new Set<string>();
    for (const i of integrationLibrary) set.add(i.category);
    return ["All", ...Array.from(set)];
  }, [integrationLibrary]);

  const filteredIntegrations = useMemo(() => {
    const q = intQuery.trim().toLowerCase();
    return integrationLibrary.filter((i: any) => {
      const matchesCat = intCategory === "All" || i.category === intCategory;
      const matchesQ = !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });
  }, [integrationLibrary, intQuery, intCategory]);

  const connectedCount = useMemo(() => Object.keys(connectedMap).length, [connectedMap]);

  const refreshPythonPackages = async (envId?: string) => {
    const targetEnv = (envId || pyEnvId || "default").trim() || "default";
    setPyPackagesLoading(true);
    try {
      const resp = await fetch(`${AGENT_HTTP}/v1/runtime/python/packages?envId=${encodeURIComponent(targetEnv)}`);
      const j = await resp.json().catch(() => null);
      if (j && typeof j === "object" && (j as any).ok) {
        const rows = Array.isArray((j as any).packages) ? (j as any).packages : [];
        setPyPackagesList(rows.filter((row: any) => row && row.name));
      }
    } catch {
    } finally {
      setPyPackagesLoading(false);
    }
  };

  const refreshPythonStatus = async () => {
    try {
      const resp = await fetch(`${AGENT_HTTP}/v1/runtime/python/status?envId=${encodeURIComponent(pyEnvId || "default")}`);
      const j = await resp.json().catch(() => null);
      if (j && typeof j === "object") {
        setPyStatus(j);
        const available = !!(j as any).available;
        const ready = !!(j as any).activeReady || !!(j as any).defaultReady;
        setConnectedMap((prev) => {
          const next = { ...prev } as Record<string, boolean>;
          if (available) next.python = true;
          else delete next.python;
          try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
          emitConnectedChanged();
          return next;
        });
        if (available && ready) {
          await refreshPythonPackages((j as any).activeEnvId || pyEnvId || "default");
        } else {
          setPyPackagesList([]);
        }
      }
    } catch {}
  };

  useEffect(() => {
    if (!statusChecksEnabled) return;
    (async () => {
      try {
        await refreshPythonStatus();
      } catch {}
    })();
  }, [statusChecksEnabled, pyEnvId]);

  const refreshFfmpegStatus = async () => {
    try {
      const res = await (window as any).desktopAPI?.execTool?.('ffmpeg_status', {});
      if (res && typeof res === 'object') setFfStatus(res);

      const available = !!(res && (res as any).available);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (available) next.ffmpeg = true;
        else delete next.ffmpeg;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
  };

  const refreshMediapipeStatus = async () => {
    try {
      const res = await (window as any).desktopAPI?.execTool?.('mediapipe_status', {});
      if (res && typeof res === 'object') setMpStatus(res);

      // Pull local binary + process state straight from desktop main (the
      // agent's `mediapipe_status` only tells us whether the sidecar is
      // currently reachable — not whether the binary is on disk or where).
      let local: any = null;
      try {
        local = await (window as any).desktopAPI?.serviceMediapipeGetLocalStatus?.();
        if (local && typeof local === 'object') setMpLocalStatus(local);
      } catch {}

      const reachable = !!(res && (res as any).available);
      const installed = !!(local && local.installed);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (reachable || installed) next.mediapipe = true;
        else delete next.mediapipe;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });

      // Check R2 for a newer binary — non-blocking; ignore errors.
      try {
        const upd = await (window as any).desktopAPI?.serviceMediapipeCheckForUpdate?.();
        if (upd && typeof upd === 'object') setMpUpdateInfo(upd);
      } catch {}
    } catch {}
  };

  const updateMediapipe = async () => {
    setMpUpdating(true);
    try {
      const res = await (window as any).desktopAPI?.serviceMediapipeUpdate?.();
      if (res && !res.ok && res.error) {
        console.error('[mediapipe:update] failed:', res.error);
      }
    } catch (e) {
      console.error('[mediapipe:update] exception:', e);
    } finally {
      await refreshMediapipeStatus();
      setMpUpdating(false);
    }
  };

  const setupMediapipe = async () => {
    setMpInstalling(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('mediapipe_setup', {});
      if (res && typeof res === 'object') {
        setMpStatus(res);
        if (!res.ok && res.error) {
          console.error('[mediapipe_setup] failed:', res.error);
        }
      }
    } catch (e) {
      console.error('[mediapipe_setup] exception:', e);
    } finally {
      await refreshMediapipeStatus();
      setMpInstalling(false);
    }
  };

  // ── Data Analysis ──────────────────────────────────────────────────────────

  const refreshDataAnalysisStatus = async () => {
    try {
      const res = await (window as any).desktopAPI?.execTool?.('data_analysis_status', {});
      if (res && typeof res === 'object') setDaStatus(res);
      const installed = !!(res && res.installed);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (installed) next['data-analysis'] = true;
        else delete next['data-analysis'];
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
  };

  const setupDataAnalysis = async () => {
    setDaInstalling(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('data_analysis_setup', {});
      if (res && typeof res === 'object' && !res.ok && res.error) {
        console.error('[data_analysis_setup] failed:', res.error);
      }
    } catch (e) {
      console.error('[data_analysis_setup] exception:', e);
    } finally {
      await refreshDataAnalysisStatus();
      setDaInstalling(false);
    }
  };

  const uninstallDataAnalysis = async () => {
    setDaUninstalling(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('data_analysis_uninstall', {});
      if (res && typeof res === 'object' && !res.ok && res.error) {
        console.error('[data_analysis_uninstall] failed:', res.error);
      }
    } catch (e) {
      console.error('[data_analysis_uninstall] exception:', e);
    } finally {
      await refreshDataAnalysisStatus();
      setDaUninstalling(false);
    }
  };

  const refreshOllamaStatus = async () => {
    setOllamaChecking(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('ollama_status', {});
      if (res && typeof res === 'object') setOllamaStatus(res);

      const available = !!(res && (res as any).available);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (available) next.ollama = true;
        else delete next.ollama;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {
    } finally {
      setOllamaChecking(false);
    }
  };

  const startOllama = async () => {
    setOllamaChecking(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('ollama_start', {});
      if (res && typeof res === 'object' && !res.ok) {
        setOllamaStatus((prev: any) => ({ ...(prev || {}), ...res }));
      }
      await refreshOllamaStatus();
    } catch {
    } finally {
      setOllamaChecking(false);
    }
  };

  const refreshCliAgentStatus = async () => {
    setCliAgentChecking(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('cli_agent_detect', { includeVersions: false });
      if (res && typeof res === 'object') setCliAgentStatus(res);

      const anyAvailable = !!(res && (res as any).anyAvailable);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (anyAvailable) next['agent-cli'] = true;
        else delete next['agent-cli'];
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {
    } finally {
      setCliAgentChecking(false);
    }
  };

  const refreshBrowserUseStatus = async () => {
    setBrowserUseChecking(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_use_status', {});
      if (res && typeof res === 'object') {
        setBrowserUseStatus(res);
      }

      const running = !!(res && (res as any).running);
      const installed = !!(res && (res as any).installed);

      // Pull local binary state from desktop main and check R2 for newer.
      let local: any = null;
      try {
        local = await (window as any).desktopAPI?.serviceBrowserUseGetLocalStatus?.();
        if (local && typeof local === 'object') setBrowserUseLocalStatus(local);
      } catch {}
      const installedLocally = !!(local && local.installed);

      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (running || installed || installedLocally) next.browser_use = true;
        else delete next.browser_use;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });

      try {
        const upd = await (window as any).desktopAPI?.serviceBrowserUseCheckForUpdate?.();
        if (upd && typeof upd === 'object') setBrowserUseUpdateInfo(upd);
      } catch {}
    } catch {
    } finally {
      setBrowserUseChecking(false);
    }
  };

  const updateBrowserUse = async () => {
    setBrowserUseUpdating(true);
    setBrowserUseSetupProgress('Updating...');
    try {
      const res = await (window as any).desktopAPI?.serviceBrowserUseUpdate?.();
      if (res && !res.ok && res.error) {
        console.error('[browserUse:update] failed:', res.error);
      }
    } catch (e) {
      console.error('[browserUse:update] exception:', e);
    } finally {
      setBrowserUseSetupProgress(null);
      await refreshBrowserUseStatus();
      setBrowserUseUpdating(false);
    }
  };

  /** One-click: installs Stuard Browser and starts the server */
  const setupBrowserUse = async () => {
    setBrowserUseChecking(true);
    setBrowserUseSetupProgress('Setting up...');
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_use_setup', {});
      if (res && typeof res === 'object' && !res.ok) {
        setBrowserUseSetupProgress(null);
        setBrowserUseStatus((prev: any) => ({ ...prev, error: res.error, step: res.step }));
        await refreshBrowserUseStatus();
        return;
      }
      setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: null, step: null }));
      setBrowserUseSetupProgress(null);
      await refreshBrowserUseStatus();
    } catch {
      setBrowserUseSetupProgress(null);
      setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: 'Failed to set up Stuard Browser.' }));
    } finally {
      setBrowserUseChecking(false);
    }
  };

  const startBrowserUse = async () => {
    setBrowserUseChecking(true);
    setBrowserUseSetupProgress('Starting...');
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_use_start', {});
      if (res && typeof res === 'object' && !res.ok) {
        setBrowserUseStatus((prev: any) => ({
          ...(prev || {}),
          error: res.error || 'Failed to start Stuard Browser.',
        }));
      } else {
        setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: null }));
      }
      await refreshBrowserUseStatus();
    } catch {
      setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: 'Failed to start Stuard Browser.' }));
    } finally {
      setBrowserUseSetupProgress(null);
      setBrowserUseChecking(false);
    }
  };

  const stopBrowserUse = async () => {
    setBrowserUseChecking(true);
    try {
      await (window as any).desktopAPI?.execTool?.('browser_use_stop', {});
      await refreshBrowserUseStatus();
    } catch {
    } finally {
      setBrowserUseChecking(false);
    }
  };

  const uninstallBrowserUse = async () => {
    setBrowserUseChecking(true);
    setBrowserUseSetupProgress('Uninstalling...');
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_use_uninstall', {});
      if (res && typeof res === 'object' && !res.ok) {
        setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: res.error || 'Uninstall failed.' }));
      } else {
        setBrowserUseStatus(null);
        setConnectedMap((prev) => {
          const next = { ...prev };
          delete next.browser_use;
          try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
          emitConnectedChanged();
          return next;
        });
      }
    } catch {
      setBrowserUseStatus((prev: any) => ({ ...(prev || {}), error: 'Uninstall failed.' }));
    } finally {
      setBrowserUseSetupProgress(null);
      setBrowserUseChecking(false);
      await refreshBrowserUseStatus();
    }
  };

  const localStatusSweepStarted = useRef(false);

  useEffect(() => {
    if (!statusChecksEnabled) {
      localStatusSweepStarted.current = false;
      return;
    }
    if (localStatusSweepStarted.current) return;
    localStatusSweepStarted.current = true;

    return deferUntilPaint(() => {
      void Promise.allSettled([
        refreshFfmpegStatus(),
        refreshMediapipeStatus(),
        refreshDataAnalysisStatus(),
        refreshOllamaStatus(),
        refreshCliAgentStatus(),
        refreshBrowserUseStatus(),
      ]);
    });
  }, [statusChecksEnabled]);

  const setupFfmpeg = async () => {
    setFfInstalling(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('ffmpeg_setup', {});
      if (res && typeof res === 'object') setFfStatus(res);
    } catch {
    } finally {
      await refreshFfmpegStatus();
      setFfInstalling(false);
    }
  };

  const setupPython = async () => {
    setPyInstallMessage(null);
    try {
      await fetch(`${AGENT_HTTP}/v1/runtime/python/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envId: pyEnvId || "default" }),
      });
      await refreshPythonStatus();
    } catch {}
  };

  const installPython = async () => {
    setPyInstalling(true);
    setPyInstallMessage(null);
    try {
      const packages = pyPackages.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const payload: any = { envId: pyEnvId, packages, requirementsTxt: pyReqTxt };
      const resp = await fetch(`${AGENT_HTTP}/v1/runtime/python/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await resp.json().catch(() => null);
      if (j && typeof j === "object") {
        const installed = Array.isArray((j as any).packagesInstalled) ? (j as any).packagesInstalled.length : 0;
        const skipped = Array.isArray((j as any).packagesSkipped) ? (j as any).packagesSkipped.length : 0;
        if ((j as any).ok) {
          if (installed > 0 && skipped > 0) {
            setPyInstallMessage(`Installed ${installed}, skipped ${skipped} already present`);
          } else if (installed > 0) {
            setPyInstallMessage(`Installed ${installed} package${installed === 1 ? "" : "s"}`);
          } else if (skipped > 0) {
            setPyInstallMessage(`All ${skipped} package${skipped === 1 ? " is" : "s are"} already installed`);
          } else {
            setPyInstallMessage("Nothing to install");
          }
          setPyPackages("");
          setPyReqTxt("");
        } else if ((j as any).error) {
          setPyInstallMessage(String((j as any).error));
        }
      }
      await refreshPythonStatus();
    } finally {
      setPyInstalling(false);
    }
  };

  const runPython = async () => {
    setPyRunning(true);
    setPyRunResult(null);
    try {
      const payload: any = { envId: pyEnvId, code: pyRunCode, timeoutMs: 20000 };
      const resp = await fetch(`${AGENT_HTTP}/v1/runtime/python/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await resp.json().catch(() => null);
      setPyRunResult(j);
    } finally {
      setPyRunning(false);
    }
  };

  const handleDisconnect = async (slug: string, profileLabel?: string) => {
    const token = session?.access_token;
    const provider = slugToProvider(slug);

    // Google tokens live in the local encrypted store — not Supabase.
    if (provider === "google") {
      let profileToDelete = profileLabel?.trim() || "";
      if (!profileToDelete) {
        const { ok, tokens } = await fetchLocalOAuthTokens(AGENT_HTTP);
        if (ok) {
          const googleTokens = tokens.filter((t) => String(t?.provider || "").toLowerCase() === "google");
          const defaultProfile = googleTokens.find((t) => t.isDefault) || googleTokens[0];
          profileToDelete = String(defaultProfile?.profileLabel || "default").trim();
        }
      }

      if (profileToDelete) {
        await execLocalAgentTool(AGENT_HTTP, "remove_oauth_tokens", {
          provider: "google",
          profileLabel: profileToDelete,
        });
        // Best-effort cleanup of any legacy Supabase row from before migration.
        if (token) {
          try {
            await fetch(
              `${CLOUD_AI_HTTP}/integrations/profiles?provider=google&profile=${encodeURIComponent(profileToDelete)}`,
              { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
            );
          } catch {}
        }
      }

      await refreshProfiles("google");
      if (token) await syncConnectedFromServer(token);
      return;
    }

    if (token && provider) {
      let profileToDelete = profileLabel?.trim() || '';

      // If no explicit profile was passed, delete the provider's current default profile.
      if (!profileToDelete) {
        try {
          const resp = await fetch(
            `${CLOUD_AI_HTTP}/integrations/profiles?provider=${encodeURIComponent(provider)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const j = await resp.json().catch(() => null);
          const providerProfiles = Array.isArray(j?.profiles) ? j.profiles : [];
          const defaultProfile = providerProfiles.find((p: any) => !!(p?.isDefault ?? p?.is_default));
          profileToDelete = String(defaultProfile?.profile || defaultProfile?.profile_label || providerProfiles[0]?.profile || providerProfiles[0]?.profile_label || '').trim();
        } catch {}
      }

      if (profileToDelete) {
        try {
          await fetch(
            `${CLOUD_AI_HTTP}/integrations/profiles?provider=${encodeURIComponent(provider)}&profile=${encodeURIComponent(profileToDelete)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          );
        } catch {}
        await refreshProfiles(provider);
        await syncConnectedFromServer(token);
        return;
      }
    }

    if (slug === "data-analysis") {
      try {
        await uninstallDataAnalysis();
      } catch {}
      return;
    }

    // Fallback for local-only or unknown integrations.
    setConnectedMap((prev) => {
      const next = { ...prev };
      delete next[slug];
      try {
        localStorage.setItem("integrations.connected", JSON.stringify(next));
      } catch {}
      emitConnectedChanged();
      return next;
    });
  };

  // ── Profile helpers ──

  /** Map UI slug → provider string used by the backend */
  const slugToProvider = (slug: string): string | null => {
    if (slug === "github") return "github";
    if (OUTLOOK_INTEGRATION_ENABLED && slug === "outlook") return "outlook";
    if (DISCORD_INTEGRATION_ENABLED && slug === "discord") return "discord";
    if (REDDIT_INTEGRATION_ENABLED && slug === "reddit") return "reddit";
    if (slug === "x") return "x";
    if (META_INTEGRATION_ENABLED) {
      if (slug === "facebook") return "facebook";
      if (slug === "instagram") return "instagram";
      if (slug === "threads") return "threads";
    }
    if (slug.startsWith("google-") || slug === "gmail") return "google";
    return null;
  };

  /** Fetch all profiles for an optional provider */
  const refreshProfiles = useCallback(async (provider?: string) => {
    const token = session?.access_token;
    setProfilesLoading(true);
    try {
      const localGoogleProfiles: IntegrationProfile[] = [];
      const { ok: localOk, tokens: localTokens } = await fetchLocalOAuthTokens(AGENT_HTTP);
      if (localOk) {
        for (const t of localTokens) {
          if (String(t?.provider || "").toLowerCase() === "google") {
            localGoogleProfiles.push(localOAuthTokenToProfile(t));
          }
        }
      }

      const mapServerProfiles = (rows: any[]): IntegrationProfile[] =>
        rows
          .filter((p) => String(p?.provider || "").toLowerCase() !== "google")
          .map((p: any) => ({
            provider: p.provider || "",
            profile_label: p.profile || p.profile_label || "default",
            is_default: !!(p.isDefault ?? p.is_default),
            account_email: p.email || p.account_email || null,
            scopes_csv: (Array.isArray(p.scopes) ? p.scopes.join(",") : p.scopes) || p.scopes_csv || null,
          }));

      if (provider === "google") {
        setProfiles(localGoogleProfiles);
        return;
      }

      if (!token) {
        setProfiles(provider ? [] : localGoogleProfiles);
        return;
      }

      const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/profiles${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null);
      const serverProfiles = j && Array.isArray(j.profiles) ? mapServerProfiles(j.profiles) : [];

      startTransition(() => {
        if (provider) {
          setProfiles(serverProfiles);
        } else {
          setProfiles([...localGoogleProfiles, ...serverProfiles]);
        }
      });
    } catch {} finally {
      setProfilesLoading(false);
    }
  }, [session?.access_token, CLOUD_AI_HTTP, AGENT_HTTP]);

  useEffect(() => {
    if (!statusChecksEnabled) {
      setProfiles([]);
      return;
    }
    void refreshProfiles();
  }, [statusChecksEnabled, session?.access_token, refreshProfiles]);

  /** Set a given profile as the default for its provider */
  const setDefaultProfile = useCallback(async (provider: string, profileLabel: string) => {
    const token = session?.access_token;
    if (provider === "google") {
      await execLocalAgentTool(AGENT_HTTP, "set_oauth_default", {
        provider: "google",
        profileLabel,
      });
      await refreshProfiles("google");
      if (token) await syncConnectedFromServer(token);
      return;
    }
    if (!token) return;
    try {
      await fetch(`${CLOUD_AI_HTTP}/integrations/profiles/default`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, profile: profileLabel }),
      });
    } catch {}
    await refreshProfiles(provider);
    await syncConnectedFromServer(token);
  }, [session?.access_token, CLOUD_AI_HTTP, AGENT_HTTP, refreshProfiles, syncConnectedFromServer]);

  /** Delete a specific profile */
  const deleteProfile = useCallback(async (provider: string, profileLabel: string) => {
    const token = session?.access_token;
    if (!profileLabel) return;

    if (provider === "google") {
      await execLocalAgentTool(AGENT_HTTP, "remove_oauth_tokens", {
        provider: "google",
        profileLabel,
      });
      if (token) {
        try {
          await fetch(
            `${CLOUD_AI_HTTP}/integrations/profiles?provider=google&profile=${encodeURIComponent(profileLabel)}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          );
        } catch {}
      }
      await refreshProfiles("google");
      if (token) await syncConnectedFromServer(token);
      return;
    }

    if (!token) return;
    try {
      const resp = await fetch(
        `${CLOUD_AI_HTTP}/integrations/profiles?provider=${encodeURIComponent(provider)}&profile=${encodeURIComponent(profileLabel)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await resp.json().catch(() => null);
      if (j && !j.ok) {
        console.warn('[deleteProfile] Server error:', j);
      }
    } catch (e) {
      console.warn('[deleteProfile] Network error:', e);
    }
    await refreshProfiles(provider);
    await syncConnectedFromServer(token);
  }, [session?.access_token, CLOUD_AI_HTTP, AGENT_HTTP, refreshProfiles, syncConnectedFromServer]);

  // OAuth completes in an external browser tab; when the user returns to the
  // desktop window we re-pull profiles + connected state so a freshly-linked
  // account shows up without a manual Refresh click.
  useEffect(() => {
    if (!statusChecksEnabled) return;
    if (!session?.access_token) return;
    const onFocus = () => {
      void refreshProfiles();
      void syncConnectedFromServer();
      emitConnectedChanged();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [statusChecksEnabled, session?.access_token, refreshProfiles, syncConnectedFromServer]);

  const telnyxRequestCode = async (phone: string, slot: number = 0): Promise<{ ok: boolean; error?: string }> => {
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      setTelnyxVerifying(true);
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/request-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, slot }),
      });
      const j = await resp.json().catch(() => null) as any;
      return { ok: !!j?.ok, error: j?.error };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setTelnyxVerifying(false);
    }
  };

  const telnyxVerifyCode = async (code: string, slot: number = 0): Promise<{ ok: boolean; phone?: string; error?: string }> => {
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      setTelnyxVerifying(true);
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/verify-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, slot }),
      });
      const j = await resp.json().catch(() => null) as any;
      if (j?.ok && j?.verified) {
        await refreshTelnyxStatus();
      }
      return { ok: !!j?.ok, phone: j?.phone, error: j?.error };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setTelnyxVerifying(false);
    }
  };

  const telnyxDisconnect = async (): Promise<void> => {
    const token = session?.access_token;
    if (!token) return;
    try {
      await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setTelnyxPhones([]);
      setConnectedMap((prev) => {
        const next = { ...prev };
        delete next.telnyx;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
  };

  const telnyxRemovePhone = async (slot: number): Promise<void> => {
    const token = session?.access_token;
    if (!token) return;
    try {
      await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/remove-phone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
      });
      await refreshTelnyxStatus();
    } catch {}
  };

  const refreshTelnyxStatus = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    try {
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/telnyx/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null) as any;
      if (j?.ok) {
        const phones = Array.isArray(j.phones) ? j.phones : [];
        setTelnyxPhones(phones);
        if (phones.length > 0) {
          setConnectedMap((prev) => {
            const next = { ...prev, telnyx: true };
            try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
            emitConnectedChanged();
            return next;
          });
        }
      }
    } catch {}
  }, [session?.access_token, CLOUD_AI_HTTP]);

  const whatsappConnect = async (phone: string): Promise<{ ok: boolean; error?: string }> => {
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/whatsapp/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const j = await resp.json().catch(() => null) as any;
      if (j?.ok) {
        setWhatsappPhone(j.phone || null);
        setConnectedMap((prev) => {
          const next = { ...prev, whatsapp: true };
          try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
          emitConnectedChanged();
          return next;
        });
      }
      return { ok: !!j?.ok, error: j?.error };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  };

  const whatsappInitiateLink = async (): Promise<{ ok: boolean; error?: string }> => {
    const token = session?.access_token;
    if (!token) return { ok: false, error: 'Not signed in.' };
    try {
      setWhatsappConnecting(true);
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/whatsapp/initiate-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null) as any;
      if (j?.ok) {
        setWhatsappLinkCode(j.code || null);
        setWhatsappBotNumber(j.botNumber || null);
        setWhatsappLinking(true);
      }
      return { ok: !!j?.ok, error: j?.error };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setWhatsappConnecting(false);
    }
  };

  const whatsappDisconnect = async (): Promise<void> => {
    const token = session?.access_token;
    if (!token) return;
    try {
      await fetch(`${CLOUD_AI_HTTP}/integrations/whatsapp/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setWhatsappPhone(null);
      setConnectedMap((prev) => {
        const next = { ...prev };
        delete next.whatsapp;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
  };

  const refreshWhatsAppStatus = useCallback(async (): Promise<boolean> => {
    const token = session?.access_token;
    if (!token) return false;
    try {
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/whatsapp/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null) as any;
      if (j?.ok && j?.connected) {
        setWhatsappPhone(j.phone || null);
        setConnectedMap((prev) => {
          const next = { ...prev, whatsapp: true };
          try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
          emitConnectedChanged();
          return next;
        });
        return true;
      }
    } catch {}
    return false;
  }, [session?.access_token, CLOUD_AI_HTTP]);

  // Poll for WhatsApp link confirmation while waiting for the user to send the code
  useEffect(() => {
    if (!WHATSAPP_INTEGRATION_ENABLED || !whatsappLinking || !session?.access_token) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 2500));
        if (cancelled) break;
        const connected = await refreshWhatsAppStatus();
        if (connected) {
          if (!cancelled) {
            setWhatsappLinking(false);
            setWhatsappLinkCode(null);
          }
          break;
        }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [whatsappLinking, session?.access_token, refreshWhatsAppStatus]);

  const handleLearnMore = (url: string) => {
    if (typeof url === "string" && url.startsWith("http")) {
      try {
        (window as any).desktopAPI?.openExternal?.(url);
      } catch {}
    }
  };

  const handleConnect = async (slug: string, profileLabel?: string) => {
    if (slug === "python") {
      try {
        await setupPython();
        // refreshPythonStatus() inside setupPython() reconciles connectedMap.python
        // with the actual runtime state — don't override it here, otherwise a
        // failed setup (e.g. Python not installed) would still mark Active.
      } catch {}
      return;
    }

    if (slug === "ffmpeg") {
      try {
        await setupFfmpeg();
      } catch {}
      return;
    }

    if (slug === "mediapipe") {
      try {
        await setupMediapipe();
      } catch {}
      return;
    }

    if (slug === "data-analysis") {
      try {
        await setupDataAnalysis();
      } catch {}
      return;
    }

    if (slug === "ollama") {
      try {
        const status = await (window as any).desktopAPI?.execTool?.('ollama_status', {});
        if (status?.installed && !status?.running) {
          await startOllama();
        } else {
          await refreshOllamaStatus();
        }
      } catch {}
      return;
    }

    if (slug === "browser-use") {
      try {
        await setupBrowserUse();
      } catch {}
      return;
    }

    if (slug === "agent-cli") {
      try {
        await refreshCliAgentStatus();
      } catch {}
      return;
    }

    if (slug === "telnyx") {
      await refreshTelnyxStatus();
      return;
    }

    if (slug === "whatsapp") {
      if (WHATSAPP_INTEGRATION_ENABLED) await refreshWhatsAppStatus();
      return;
    }

    const token = session?.access_token;
    if (!token) {
      alert("Please sign in first.");
      return;
    }

    const openExternal = (url: string) => {
      try {
        (window as any).desktopAPI?.openExternal?.(url);
      } catch {
        window.open(url, "_blank");
      }
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Device-local OAuth: after the browser consent completes, cloud-ai stages
    // the freshly-minted token for one-time pickup. Claim it over the
    // authenticated endpoint and write it into the local encrypted store via the
    // local agent — the token never lands in Supabase. Returns true once stored.
    const claimAndStoreLocally = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/oauth/claim`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const j = await resp.json().catch(() => null);
          const tokens = j && (j as any).ok && Array.isArray((j as any).tokens) ? (j as any).tokens : [];
          if (tokens.length > 0) {
            const sj = await execLocalAgentTool(AGENT_HTTP, "store_oauth_tokens", {
              replace: false,
              tokens,
            });
            return !!(sj && (sj as any).ok);
          }
        } catch {}
        await sleep(2000);
      }
      return false;
    };

    const pollStatus = async (url: string, slugKey: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const j = await resp.json().catch(() => null);
          if (j && (j as any).ok && (j as any).connected) {
            setConnectedMap((prev) => {
              const next = { ...prev, [slugKey]: true };
              try {
                localStorage.setItem("integrations.connected", JSON.stringify(next));
              } catch {}
              emitConnectedChanged();
              return next;
            });
            return true;
          }
        } catch {}
        await sleep(2000);
      }
      return false;
    };

    if (OUTLOOK_INTEGRATION_ENABLED && slug === "outlook") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/outlook/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/outlook/status${statusProfileParam}`, "outlook");
      await refreshProfiles('outlook');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "github") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/github/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/github/status${statusProfileParam}`, "github");
      await refreshProfiles('github');
      await syncConnectedFromServer(token);
      return;
    }

    if (DISCORD_INTEGRATION_ENABLED && slug === "discord") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/discord/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/discord/status${statusProfileParam}`, "discord");
      await refreshProfiles('discord');
      await syncConnectedFromServer(token);
      return;
    }

    if (REDDIT_INTEGRATION_ENABLED && slug === "reddit") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/reddit/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/reddit/status${statusProfileParam}`, "reddit");
      await refreshProfiles('reddit');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "x") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/x/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/x/status${statusProfileParam}`, "x");
      await refreshProfiles('x');
      await syncConnectedFromServer(token);
      return;
    }

    if (META_INTEGRATION_ENABLED && slug === "facebook") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/facebook/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/facebook/status${statusProfileParam}`, "facebook");
      await refreshProfiles('facebook');
      await syncConnectedFromServer(token);
      return;
    }

    if (META_INTEGRATION_ENABLED && slug === "instagram") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/instagram/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/instagram/status${statusProfileParam}`, "instagram");
      await refreshProfiles('instagram');
      await syncConnectedFromServer(token);
      return;
    }

    if (META_INTEGRATION_ENABLED && slug === "threads") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/threads/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/threads/status${statusProfileParam}`, "threads");
      await refreshProfiles('threads');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "google-drive" || slug === "google-calendar" || slug === "gmail" || slug === "google-sheets" || slug === "google-docs" || slug === "google-tasks") {
      const target = slug === "google-drive" ? "drive"
        : slug === "google-calendar" ? "calendar"
        : slug === "gmail" ? "gmail"
        : slug === "google-sheets" ? "sheets"
        : slug === "google-docs" ? "docs"
        : "tasks";
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/google/connect?token=${encodeURIComponent(token)}&target=${encodeURIComponent(target)}${profileParam}`;
      openExternal(url);
      // Desktop holds the token locally: claim + store it. On success mark
      // connected (the cloud status can't see device-held tokens). If nothing is
      // claimed (e.g. a VM-primary user), fall back to cloud status polling,
      // which reflects the VM's authoritative view.
      const stored = await claimAndStoreLocally();
      if (!stored) {
        // VM-primary users: fall back to cloud status (VM authoritative view).
        await pollStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=${encodeURIComponent(target)}${profileParam}`, slug);
      }
      await refreshProfiles('google');
      await syncConnectedFromServer(token);
      return;
    }

    setConnectedMap((prev) => {
      const next = { ...prev, [slug]: true };
      try {
        localStorage.setItem("integrations.connected", JSON.stringify(next));
      } catch {}
      emitConnectedChanged();
      return next;
    });
  };

  return {
    // state
    connectedMap,
    intQuery,
    setIntQuery,
    intCategory,
    setIntCategory,
    pyStatus,
    ffStatus,
    pyEnvId,
    setPyEnvId,
    pyPackages,
    setPyPackages,
    pyReqTxt,
    setPyReqTxt,
    pyPackagesList,
    pyPackagesLoading,
    pyInstallMessage,
    pyInstalling,
    ffInstalling,
    mpStatus,
    mpInstalling,
    mpLocalStatus,
    mpUpdateInfo,
    mpUpdating,
    daStatus,
    daInstalling,
    daUninstalling,
    browserUseLocalStatus,
    browserUseUpdateInfo,
    browserUseUpdating,
    pyRunning,
    pyRunCode,
    setPyRunCode,
    pyRunResult,
    ollamaStatus,
    ollamaChecking,
    browserUseStatus,
    browserUseChecking,
    browserUseSetupProgress,
    cliAgentStatus,
    cliAgentChecking,
    telnyxPhones,
    telnyxVerifying,
    whatsappPhone,
    whatsappConnecting,
    whatsappLinking,
    whatsappLinkCode,
    whatsappBotNumber,
    // profiles
    profiles,
    profilesLoading,
    // derived
    integrationLibrary,
    intCategories,
    filteredIntegrations,
    connectedCount,
    // actions
    handleConnect,
    handleDisconnect,
    handleLearnMore,
    refreshPythonStatus,
    refreshPythonPackages,
    refreshFfmpegStatus,
    refreshMediapipeStatus,
    refreshOllamaStatus,
    startOllama,
    refreshBrowserUseStatus,
    refreshCliAgentStatus,
    setupBrowserUse,
    startBrowserUse,
    stopBrowserUse,
    uninstallBrowserUse,
    updateBrowserUse,
    setupPython,
    setupFfmpeg,
    setupMediapipe,
    updateMediapipe,
    refreshDataAnalysisStatus,
    setupDataAnalysis,
    uninstallDataAnalysis,
    installPython,
    runPython,
    // profile actions
    refreshProfiles,
    setDefaultProfile,
    deleteProfile,
    // telnyx
    telnyxRequestCode,
    telnyxVerifyCode,
    telnyxDisconnect,
    telnyxRemovePhone,
    refreshTelnyxStatus,
    // whatsapp
    whatsappConnect,
    whatsappInitiateLink,
    whatsappDisconnect,
    refreshWhatsAppStatus,
  };
}
