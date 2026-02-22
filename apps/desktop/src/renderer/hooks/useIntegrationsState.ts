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
  const [browserStatus, setBrowserStatus] = useState<{ connected: boolean; clients: number }>({ connected: false, clients: 0 });

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
        }
        setConnectedMap(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = session?.access_token;
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` } as const;

        // Track which integrations are actually connected (server truth)
        const serverConnected: Record<string, boolean> = {};

        const fetchStatus = async (url: string, slug: string) => {
          try {
            const resp = await fetch(url, { headers });
            const j = await resp.json().catch(() => null);
            // Mark as connected ONLY if server confirms it
            serverConnected[slug] = !!(j && (j as any).ok && (j as any).connected);
          } catch {
            // On error, mark as not connected
            serverConnected[slug] = false;
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
        ]);

        // Update state with server truth (this removes stale localStorage entries)
        setConnectedMap((prev) => {
          // Keep local-only integrations (like python) from previous state
          const next: Record<string, boolean> = {};
          if (prev.python) next.python = true;
          if (prev.webhooks) next.webhooks = true;
          if (prev.ffmpeg) next.ffmpeg = true;
          if (prev.mediapipe) next.mediapipe = true;
          // Add server-confirmed integrations
          for (const [slug, connected] of Object.entries(serverConnected)) {
            if (connected) next[slug] = true;
          }
          try {
            localStorage.setItem("integrations.connected", JSON.stringify(next));
          } catch {}
          emitConnectedChanged();
          return next;
        });
      } catch {}
    })();
  }, [session?.access_token, CLOUD_AI_HTTP]);

  // Regular integrations (OAuth-based, not MCPs)
  const integrationLibrary = useMemo(
    () => [
      { slug: "python", name: "Python", description: "Local Python runtime and managed envs.", category: "Local", homepage: "https://www.python.org/", available: true },
      { slug: "ffmpeg", name: "FFmpeg", description: "Local media conversion and editing (auto-installs when needed).", category: "Local", homepage: "https://ffmpeg.org/", available: true },
      { slug: "mediapipe", name: "MediaPipe", description: "Computer vision: pose estimation, hand tracking, face detection, face mesh, segmentation.", category: "Local", homepage: "https://mediapipe.dev/", available: true },
      { slug: "browser", name: "Browser", description: "Web automation and page interaction via browser extension.", category: "Local", homepage: "https://stuard.ai/extension", available: true },
      { slug: "outlook", name: "Outlook", description: "Connect Microsoft Outlook via PKCE to read mail (Mail.Read).", category: "Communication", homepage: "https://learn.microsoft.com/graph/", available: true },
      { slug: "github", name: "GitHub", description: "Read repos and issues.", category: "Development", homepage: "https://github.com/", available: true },
      { slug: "discord", name: "Discord", description: "Read and send messages, list servers and DMs.", category: "Communication", homepage: "https://discord.com/", available: true },
      { slug: "reddit", name: "Reddit", description: "Browse, search, post, and comment on Reddit.", category: "Communication", homepage: "https://reddit.com/", available: true },
      { slug: "google-drive", name: "Google Drive", description: "Access and search files.", category: "Files", homepage: "https://drive.google.com/", available: true },
      { slug: "webhooks", name: "Webhooks", description: "Trigger custom workflows via HTTP callbacks.", category: "Automation", homepage: "https://webhook.site/", available: true },
      { slug: "google-calendar", name: "Google Calendar", description: "Manage events and reminders.", category: "Productivity", homepage: "https://calendar.google.com/", available: true },
      { slug: "gmail", name: "Gmail", description: "Send and read email.", category: "Communication", homepage: "https://mail.google.com/", available: true },
      { slug: "google-sheets", name: "Google Sheets", description: "Read spreadsheet ranges.", category: "Data", homepage: "https://sheets.google.com/", available: true },
      { slug: "google-docs", name: "Google Docs", description: "Read document content.", category: "Files", homepage: "https://docs.google.com/", available: true },
    ],
    []
  );

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

  const refreshBrowserStatus = async () => {
    try {
      const res = await (window as any).desktopAPI?.execTool?.('browser_status', {});
      if (res && typeof res === 'object') {
        setBrowserStatus({ connected: !!res.connected, clients: res.clients || 0 });
      }
    } catch {}
  };

  useEffect(() => {
    // Initial poll
    refreshBrowserStatus();
    // Poll fallback every 8s
    const interval = setInterval(refreshBrowserStatus, 8000);

    // Real-time push from browser-server (instant status updates)
    let unsub: (() => void) | undefined;
    try {
      unsub = (window as any).desktopAPI?.onBrowserExtensionStatus?.((status: { connected: boolean; clients: number }) => {
        setBrowserStatus({ connected: !!status.connected, clients: status.clients || 0 });
      });
    } catch {}

    return () => {
      clearInterval(interval);
      try { unsub?.(); } catch {}
    };
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
      if (res && typeof res === 'object') setMpStatus(res);
    } catch {
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
    if (slug === "browser") {
      try {
        localStorage.setItem("stuard.pref.browser_enabled", "false");
        window.dispatchEvent(new StorageEvent('storage', { key: 'stuard.pref.browser_enabled', newValue: 'false' }));
      } catch {}
    }
    // If a profile label is given, delete that specific profile via the API
    const token = session?.access_token;
    if (token && profileLabel) {
      const provider = slugToProvider(slug);
      if (provider) {
        try {
          await fetch(
            `${CLOUD_AI_HTTP}/integrations/profiles?provider=${encodeURIComponent(provider)}&profile=${encodeURIComponent(profileLabel)}`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
          );
        } catch {}
        await refreshProfiles();
      }
    }
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
  }, [session?.access_token, CLOUD_AI_HTTP, refreshProfiles]);

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
    // Also remove from connectedMap if this was the only/last profile for the provider
    await refreshProfiles(provider);
    // For google provider, refresh all Google statuses since removing a profile may affect connected products
    if (provider === 'google') {
      const googleSlugs = ['google-drive', 'google-calendar', 'gmail', 'google-sheets', 'google-docs'];
      setConnectedMap((prev) => {
        // After profile deletion, we'll let the next status check update this
        // For now, keep existing connected state
        return prev;
      });
    }
  }, [session?.access_token, CLOUD_AI_HTTP, refreshProfiles]);

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

    if (slug === "browser") {
      try {
        const raw = localStorage.getItem("stuard.pref.browser_enabled");
        const isEnabled = raw === "true";
        if (!isEnabled) {
          localStorage.setItem("stuard.pref.browser_enabled", "true");
          window.dispatchEvent(new StorageEvent('storage', { key: 'stuard.pref.browser_enabled', newValue: 'true' }));
        }
        await refreshBrowserStatus();
      } catch {}
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

    const pollStatus = async (url: string, slugKey: string) => {
      let attempts = 0;
      const h = setInterval(async () => {
        attempts++;
        if (attempts > 30) {
          clearInterval(h);
          return;
        }
        try {
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const j = await resp.json().catch(() => null);
          if (j && (j as any).ok && (j as any).connected) {
            clearInterval(h);
            setConnectedMap((prev) => {
              const next = { ...prev, [slugKey]: true };
              try {
                localStorage.setItem("integrations.connected", JSON.stringify(next));
              } catch {}
              emitConnectedChanged();
              return next;
            });
          }
        } catch {}
      }, 2000);
    };

    /** After connecting one Google product, re-check all Google product statuses */
    const refreshAllGoogleStatuses = async (authToken: string) => {
      const googleSlugs = [
        { target: 'drive', slug: 'google-drive' },
        { target: 'calendar', slug: 'google-calendar' },
        { target: 'gmail', slug: 'gmail' },
        { target: 'sheets', slug: 'google-sheets' },
        { target: 'docs', slug: 'google-docs' },
      ];
      const results: Record<string, boolean> = {};
      await Promise.all(
        googleSlugs.map(async ({ target, slug }) => {
          try {
            const resp = await fetch(
              `${CLOUD_AI_HTTP}/integrations/google/status?target=${target}`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            const j = await resp.json().catch(() => null);
            results[slug] = !!(j && (j as any).ok && (j as any).connected);
          } catch {
            results[slug] = false;
          }
        }),
      );
      setConnectedMap((prev) => {
        const next = { ...prev };
        for (const [slug, connected] of Object.entries(results)) {
          if (connected) next[slug] = true;
          else delete next[slug];
        }
        try { localStorage.setItem("integrations.connected", JSON.stringify(next)); } catch {}
        emitConnectedChanged();
        return next;
      });
    };

    if (slug === "outlook") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/outlook/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/outlook/status`, "outlook");
      await refreshProfiles('outlook');
      return;
    }

    if (slug === "github") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/github/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/github/status`, "github");
      await refreshProfiles('github');
      return;
    }

    if (slug === "discord") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/discord/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/discord/status`, "discord");
      await refreshProfiles('discord');
      return;
    }

    if (slug === "reddit") {
      const profileParam = profileLabel ? `&profile=${encodeURIComponent(profileLabel)}` : '';
      const url = `${CLOUD_AI_HTTP}/integrations/reddit/connect?token=${encodeURIComponent(token)}${profileParam}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/reddit/status`, "reddit");
      await refreshProfiles('reddit');
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
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=${encodeURIComponent(target)}`, slug);
      // After connecting one Google product, refresh ALL Google product statuses
      // since scopes are now merged — connecting Gmail no longer breaks Drive
      await refreshAllGoogleStatuses(token);
      await refreshProfiles('google');
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
    browserStatus,
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
    refreshBrowserStatus,
    setupPython,
    setupFfmpeg,
    setupMediapipe,
    installPython,
    runPython,
    // profile actions
    refreshProfiles,
    setDefaultProfile,
    deleteProfile,
  };
}
