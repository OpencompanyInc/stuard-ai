import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

interface UseIntegrationsStateArgs {
  session: Session | null;
  AGENT_HTTP: string;
  CLOUD_AI_HTTP: string;
}

export function useIntegrationsState({ session, AGENT_HTTP, CLOUD_AI_HTTP }: UseIntegrationsStateArgs) {
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({});
  const [intQuery, setIntQuery] = useState("");
  const [intCategory, setIntCategory] = useState("All");
  const [pyStatus, setPyStatus] = useState<any | null>(null);
  const [ffStatus, setFfStatus] = useState<any | null>(null);
  const [ffInstalling, setFfInstalling] = useState<boolean>(false);
  const [pyEnvId, setPyEnvId] = useState<string>("default");
  const [pyPackages, setPyPackages] = useState<string>("");
  const [pyReqTxt, setPyReqTxt] = useState<string>("");
  const [pyInstalling, setPyInstalling] = useState<boolean>(false);
  const [pyRunning, setPyRunning] = useState<boolean>(false);
  const [pyRunCode, setPyRunCode] = useState<string>("print(\"hello from python\")");
  const [pyRunResult, setPyRunResult] = useState<any | null>(null);

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
        ]);

        // Update state with server truth (this removes stale localStorage entries)
        setConnectedMap((prev) => {
          // Keep local-only integrations (like python) from previous state
          const next: Record<string, boolean> = {};
          if (prev.python) next.python = true;
          if (prev.webhooks) next.webhooks = true;
          if (prev.ffmpeg) next.ffmpeg = true;
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
      { slug: "outlook", name: "Outlook", description: "Connect Microsoft Outlook via PKCE to read mail (Mail.Read).", category: "Communication", homepage: "https://learn.microsoft.com/graph/", available: true },
      { slug: "github", name: "GitHub", description: "Read repos and issues.", category: "Development", homepage: "https://github.com/", available: true },
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

  const handleDisconnect = (slug: string) => {
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

  const handleLearnMore = (url: string) => {
    if (typeof url === "string" && url.startsWith("http")) {
      try {
        (window as any).desktopAPI?.openExternal?.(url);
      } catch {}
    }
  };

  const handleConnect = async (slug: string) => {
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

    if (slug === "outlook") {
      const url = `${CLOUD_AI_HTTP}/integrations/outlook/connect?token=${encodeURIComponent(token)}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/outlook/status`, "outlook");
      return;
    }

    if (slug === "github") {
      const url = `${CLOUD_AI_HTTP}/integrations/github/connect?token=${encodeURIComponent(token)}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/github/status`, "github");
      return;
    }

    if (slug === "google-drive" || slug === "google-calendar" || slug === "gmail" || slug === "google-sheets" || slug === "google-docs") {
      const target = slug === "google-drive" ? "drive"
        : slug === "google-calendar" ? "calendar"
        : slug === "gmail" ? "gmail"
        : slug === "google-sheets" ? "sheets"
        : "docs";
      const url = `${CLOUD_AI_HTTP}/integrations/google/connect?token=${encodeURIComponent(token)}&target=${encodeURIComponent(target)}`;
      openExternal(url);
      await pollStatus(`${CLOUD_AI_HTTP}/integrations/google/status?target=${encodeURIComponent(target)}`, slug);
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
    pyRunning,
    pyRunCode,
    setPyRunCode,
    pyRunResult,
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
    setupPython,
    setupFfmpeg,
    installPython,
    runPython,
  };
}
