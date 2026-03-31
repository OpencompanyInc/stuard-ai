import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

interface UseIntegrationsStateArgs {
  session: Session | null;
  AGENT_HTTP: string;
  CLOUD_AI_HTTP: string;
}

/** Shape returned by the profiles API */
interface IntegrationProfile {
  provider: string;
  profile_label: string;
  is_default: boolean;
  account_email?: string | null;
  scopes_csv?: string | null;
}

export function useIntegrationsState({ session, AGENT_HTTP, CLOUD_AI_HTTP }: UseIntegrationsStateArgs) {
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({});
  const [intQuery, setIntQuery] = useState("");
  const [intCategory, setIntCategory] = useState("All");
  const [pyStatus, setPyStatus] = useState<any | null>(null);
  const [ffStatus, setFfStatus] = useState<any | null>(null);
  const [ffInstalling, setFfInstalling] = useState<boolean>(false);
  const [mpStatus, setMpStatus] = useState<any | null>(null);
  const [mpInstalling, setMpInstalling] = useState<boolean>(false);
  const [pyEnvId, setPyEnvId] = useState<string>("default");
  const [pyPackages, setPyPackages] = useState<string>("");
  const [pyReqTxt, setPyReqTxt] = useState<string>("");
  const [pyInstalling, setPyInstalling] = useState<boolean>(false);
  const [pyRunning, setPyRunning] = useState<boolean>(false);
  const [pyRunCode, setPyRunCode] = useState<string>("print(\"hello from python\")");
  const [pyRunResult, setPyRunResult] = useState<any | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<any | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState<boolean>(false);
  const [browserUseStatus, setBrowserUseStatus] = useState<any | null>(null);
  const [browserUseChecking, setBrowserUseChecking] = useState<boolean>(false);
  const [browserUseSetupProgress, setBrowserUseSetupProgress] = useState<string | null>(null);
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
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/outlook/status`, "outlook"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=drive`, "google-drive"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=calendar`, "google-calendar"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=gmail`, "gmail"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=sheets`, "google-sheets"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=docs`, "google-docs"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/discord/status`, "discord"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/reddit/status`, "reddit"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/facebook/status`, "facebook"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/instagram/status`, "instagram"),
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/threads/status`, "threads"),
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
        fetchStatus(`${CLOUD_AI_HTTP}/integrations/whatsapp/status`, "whatsapp"),
      ]);

      setConnectedMap((prev) => {
        const next: Record<string, boolean> = {};
        // Preserve local-only integration states
        if (prev.python) next.python = true;
        if (prev.webhooks) next.webhooks = true;
        if (prev.ffmpeg) next.ffmpeg = true;
        if (prev.mediapipe) next.mediapipe = true;
        if (prev.ollama) next.ollama = true;
        if (prev.browser_use) next.browser_use = true;

        for (const [slug, connected] of Object.entries(serverConnected)) {
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

        try {
          localStorage.setItem("integrations.connected", JSON.stringify(next));
        } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
  }, [session?.access_token, CLOUD_AI_HTTP]);

  useEffect(() => {
    (async () => {
      try {
        await syncConnectedFromServer();
      } catch {}
    })();
  }, [syncConnectedFromServer]);

  // Regular integrations (OAuth-based, not MCPs)
  const integrationLibraryRaw = useMemo(
    () => [
      { slug: "python", name: "Python", description: "Required for local tools. Stuard sets it up automatically when needed.", category: "Local", homepage: "https://www.python.org/", available: true },
      { slug: "ffmpeg", name: "FFmpeg", description: "Convert and edit audio & video files. Installs automatically when needed.", category: "Local", homepage: "https://ffmpeg.org/", available: true },
      { slug: "mediapipe", name: "MediaPipe", description: "See and understand images and video — hand tracking, face detection, body pose, and more.", category: "Local", homepage: "https://mediapipe.dev/", available: true },
      { slug: "ollama", name: "Ollama", description: "Run AI models privately on your computer — chat, vision, embeddings, no data leaves your device.", category: "Local", homepage: "https://ollama.com/", available: true },
      { slug: "browser-use", name: "Stuard Browser", description: "Let Stuard browse the web for you — fill forms, search, log in, and complete tasks. Saves your cookies and sessions.", category: "Local", homepage: "https://stuard.ai/", available: true },
      { slug: "outlook", name: "Outlook", description: "Connect Microsoft Outlook via PKCE to read mail (Mail.Read).", category: "Communication", homepage: "https://learn.microsoft.com/graph/", available: true },
      { slug: "github", name: "GitHub", description: "Read repos and issues.", category: "Development", homepage: "https://github.com/", available: true },
      { slug: "discord", name: "Discord", description: "Read and send messages, list servers and DMs.", category: "Communication", homepage: "https://discord.com/", available: true },
      { slug: "reddit", name: "Reddit", description: "Browse, search, post, and comment on Reddit.", category: "Communication", homepage: "https://reddit.com/", available: true },
      { slug: "facebook", name: "Facebook", description: "Connect your Facebook account with OAuth for social automations and account access.", category: "Communication", homepage: "https://www.facebook.com/", available: true },
      { slug: "instagram", name: "Instagram", description: "Connect Instagram with OAuth and securely store access tokens for account-based features.", category: "Communication", homepage: "https://www.instagram.com/", available: true },
      { slug: "threads", name: "Threads", description: "Connect your Threads account with OAuth for identity and future publishing workflows.", category: "Communication", homepage: "https://www.threads.net/", available: true },
      { slug: "google-drive", name: "Google Drive", description: "Access and search files.", category: "Files", homepage: "https://drive.google.com/", available: true },
      { slug: "webhooks", name: "Webhooks", description: "Trigger custom workflows via HTTP callbacks.", category: "Automation", homepage: "https://webhook.site/", available: true },
      { slug: "google-calendar", name: "Google Calendar", description: "Manage events and reminders.", category: "Productivity", homepage: "https://calendar.google.com/", available: true },
      { slug: "gmail", name: "Gmail", description: "Send and read email.", category: "Communication", homepage: "https://mail.google.com/", available: true },
      { slug: "google-sheets", name: "Google Sheets", description: "Read spreadsheet ranges.", category: "Data", homepage: "https://sheets.google.com/", available: true },
      { slug: "google-docs", name: "Google Docs", description: "Read document content.", category: "Files", homepage: "https://docs.google.com/", available: true },
      { slug: "telnyx", name: "Phone (SMS/Call)", description: "Verify your phone number to receive SMS and voice call notifications from Stuard.", category: "Communication", homepage: "https://telnyx.com/", available: true },
      { slug: "whatsapp", name: "WhatsApp", description: "Connect your WhatsApp number to receive messages, voice notes, images, and files from Stuard.", category: "Communication", homepage: "https://business.whatsapp.com/", available: true },
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

  const refreshPythonStatus = async () => {
    try {
      const resp = await fetch(`${AGENT_HTTP}/v1/runtime/python/status`);
      const j = await resp.json().catch(() => null);
      if (j && typeof j === "object") setPyStatus(j);
    } catch {}
  };

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

  useEffect(() => {
    (async () => {
      try {
        await refreshFfmpegStatus();
      } catch {}
    })();
  }, []);

  const refreshMediapipeStatus = async () => {
    try {
      const res = await (window as any).desktopAPI?.execTool?.('mediapipe_status', {});
      if (res && typeof res === 'object') setMpStatus(res);

      const available = !!(res && (res as any).available);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (available) next.mediapipe = true;
        else delete next.mediapipe;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {}
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

  useEffect(() => {
    (async () => {
      try {
        await refreshMediapipeStatus();
      } catch {}
    })();
  }, []);

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

  useEffect(() => {
    (async () => {
      try {
        await refreshOllamaStatus();
      } catch {}
    })();
  }, []);

  const refreshBrowserUseStatus = async () => {
    setBrowserUseChecking(true);
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_use_status', {});
      if (res && typeof res === 'object') {
        setBrowserUseStatus(res);
      }

      const running = !!(res && (res as any).running);
      const installed = !!(res && (res as any).installed);
      setConnectedMap((prev) => {
        const next = { ...prev } as Record<string, boolean>;
        if (running || installed) next.browser_use = true;
        else delete next.browser_use;
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    } catch {
    } finally {
      setBrowserUseChecking(false);
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

  useEffect(() => {
    (async () => {
      try {
        await refreshBrowserUseStatus();
      } catch {}
    })();
  }, []);

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
    try {
      await fetch(`${AGENT_HTTP}/v1/runtime/python/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await refreshPythonStatus();
    } catch {}
  };

  const installPython = async () => {
    setPyInstalling(true);
    try {
      const packages = pyPackages.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      const payload: any = { envId: pyEnvId, packages, requirementsTxt: pyReqTxt };
      await fetch(`${AGENT_HTTP}/v1/runtime/python/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
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
    if (slug === "outlook") return "outlook";
    if (slug === "discord") return "discord";
    if (slug === "reddit") return "reddit";
    if (slug === "facebook") return "facebook";
    if (slug === "instagram") return "instagram";
    if (slug === "threads") return "threads";
    if (slug.startsWith("google-") || slug === "gmail") return "google";
    return null;
  };

  /** Fetch all profiles for an optional provider */
  const refreshProfiles = useCallback(async (provider?: string) => {
    const token = session?.access_token;
    if (!token) return;
    setProfilesLoading(true);
    try {
      const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
      const resp = await fetch(`${CLOUD_AI_HTTP}/integrations/profiles${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await resp.json().catch(() => null);
      if (j && Array.isArray(j.profiles)) {
        // Map API field names to frontend interface
        // API returns: { profile, isDefault, email, scopes, provider }
        // Frontend expects: { profile_label, is_default, account_email, scopes_csv, provider }
        const mapped: IntegrationProfile[] = j.profiles.map((p: any) => ({
          provider: p.provider || '',
          profile_label: p.profile || p.profile_label || 'default',
          is_default: !!(p.isDefault ?? p.is_default),
          account_email: p.email || p.account_email || null,
          scopes_csv: (Array.isArray(p.scopes) ? p.scopes.join(',') : p.scopes) || p.scopes_csv || null,
        }));
        setProfiles(mapped);
      }
    } catch {} finally {
      setProfilesLoading(false);
    }
  }, [session?.access_token, CLOUD_AI_HTTP]);

  /** Set a given profile as the default for its provider */
  const setDefaultProfile = useCallback(async (provider: string, profileLabel: string) => {
    const token = session?.access_token;
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
  }, [session?.access_token, CLOUD_AI_HTTP, refreshProfiles, syncConnectedFromServer]);

  /** Delete a specific profile */
  const deleteProfile = useCallback(async (provider: string, profileLabel: string) => {
    const token = session?.access_token;
    if (!token || !profileLabel) return;
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
  }, [session?.access_token, CLOUD_AI_HTTP, refreshProfiles, syncConnectedFromServer]);

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
    if (!whatsappLinking || !session?.access_token) return;
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
        setConnectedMap((prev) => {
          const next = { ...prev, python: true };
          try {
            localStorage.setItem("integrations.connected", JSON.stringify(next));
          } catch {}
          emitConnectedChanged();
          return next;
        });
        if (!pyStatus) await refreshPythonStatus();
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

    if (slug === "telnyx") {
      await refreshTelnyxStatus();
      return;
    }

    if (slug === "whatsapp") {
      await refreshWhatsAppStatus();
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

    if (slug === "outlook") {
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

    if (slug === "discord") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/discord/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/discord/status${statusProfileParam}`, "discord");
      await refreshProfiles('discord');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "reddit") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/reddit/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/reddit/status${statusProfileParam}`, "reddit");
      await refreshProfiles('reddit');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "facebook") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/facebook/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/facebook/status${statusProfileParam}`, "facebook");
      await refreshProfiles('facebook');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "instagram") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/instagram/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/instagram/status${statusProfileParam}`, "instagram");
      await refreshProfiles('instagram');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "threads") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const statusProfileParam = profileLabel ? `?profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/threads/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/threads/status${statusProfileParam}`, "threads");
      await refreshProfiles('threads');
      await syncConnectedFromServer(token);
      return;
    }

    if (slug === "google-drive" || slug === "google-calendar" || slug === "gmail" || slug === "google-sheets" || slug === "google-docs") {
      const target = slug === "google-drive" ? "drive"
        : slug === "google-calendar" ? "calendar"
        : slug === "gmail" ? "gmail"
        : slug === "google-sheets" ? "sheets"
        : "docs";
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/google/connect?token=${encodeURIComponent(token)}&target=${encodeURIComponent(target)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=${encodeURIComponent(target)}${profileParam}`, slug);
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
    pyInstalling,
    ffInstalling,
    mpStatus,
    mpInstalling,
    pyRunning,
    pyRunCode,
    setPyRunCode,
    pyRunResult,
    ollamaStatus,
    ollamaChecking,
    browserUseStatus,
    browserUseChecking,
    browserUseSetupProgress,
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
    intCategories,
    filteredIntegrations,
    connectedCount,
    // actions
    handleConnect,
    handleDisconnect,
    handleLearnMore,
    refreshPythonStatus,
    refreshFfmpegStatus,
    refreshMediapipeStatus,
    refreshOllamaStatus,
    startOllama,
    refreshBrowserUseStatus,
    setupBrowserUse,
    startBrowserUse,
    stopBrowserUse,
    uninstallBrowserUse,
    setupPython,
    setupFfmpeg,
    setupMediapipe,
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
