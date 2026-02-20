import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./scrollbar.css";
import { supabase } from "./lib/supabaseClient";
import { startBrowserSignIn } from "./auth/browserSignIn";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { usePreferences } from "./hooks/usePreferences";
import { useIntegrationsState } from "./hooks/useIntegrationsState";
import { UnifiedPlannerView } from "./components/UnifiedPlannerView";
import { OverviewView } from "./components/OverviewView";
import { HistoryView } from "./components/HistoryView";
import { AutomationsView } from "./components/AutomationsView";
import { SettingsView } from "./components/SettingsView";
import { IntegrationsView } from "./components/IntegrationsView";
import { MemoriesView } from "./components/MemoriesView";
import { TasksView } from "./components/TasksView";
import {
  LayoutDashboard,
  Clock,
  Settings,
  Zap,
  Link,
  Calendar,
  LogOut,
  RefreshCw,
  Archive,
  User,
  ListTodo
} from "lucide-react";
import { clsx } from 'clsx';
import 'katex/dist/katex.min.css';
import EnvironmentBadge from './components/EnvironmentBadge';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

function parseLocalDateOrIso(value: string): Date {
  const s = String(value || '').trim();
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(y, mo - 1, d, 0, 0, 0, 0);
  }
  return new Date(s);
}

function formatLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pickNextUpcomingBlockId(blocks: any[], now: Date): string | null {
  const nowKey = formatLocalDateKey(now);
  const items = Array.isArray(blocks) ? blocks : [];
  const candidates = items
    .map((b) => {
      let start: Date | null = null;
      let end: Date | null = null;
      try {
        start = b?.start ? parseLocalDateOrIso(String(b.start)) : null;
        end = b?.end ? parseLocalDateOrIso(String(b.end)) : null;
      } catch {
        start = null;
        end = null;
      }
      if (!start || Number.isNaN(start.getTime())) return null;
      if (!end || Number.isNaN(end.getTime())) end = new Date(start.getTime() + 3600000);
      return { id: b?.id, start, end, startKey: formatLocalDateKey(start) };
    })
    .filter(Boolean) as Array<{ id: any; start: Date; end: Date; startKey: string }>;

  const isEnded = (c: { end: Date }) => c.end.getTime() < now.getTime();
  const notEnded = candidates.filter((c) => !isEnded(c));

  const futureToday = notEnded
    .filter((c) => c.startKey === nowKey && c.start.getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (futureToday[0]?.id != null) return String(futureToday[0].id);

  const ongoingToday = notEnded
    .filter((c) => c.startKey === nowKey && c.start.getTime() <= now.getTime() && c.end.getTime() >= now.getTime())
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  if (ongoingToday[0]?.id != null) return String(ongoingToday[0].id);

  const futureAny = notEnded
    .filter((c) => c.start.getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (futureAny[0]?.id != null) return String(futureAny[0].id);

  const pastAny = notEnded
    .filter((c) => c.start.getTime() < now.getTime())
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  if (pastAny[0]?.id != null) return String(pastAny[0].id);

  return null;
}

class ErrorBoundary extends React.Component<any, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("Dashboard Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 flex flex-col items-center justify-center h-full text-red-400 bg-red-900/10 rounded-xl border border-red-500/20 m-4">
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <pre className="text-xs bg-black/20 p-4 rounded border border-red-500/20 overflow-auto max-w-full text-red-300">
            {String(this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SidebarItem({ id, label, icon: Icon, current, onClick }: { id: string; label: string; icon: any; current: string; onClick: (id: string) => void }) {
  const active = current === id;
  return (
    <button
      className={clsx(
        "w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[13.5px] font-bold transition-all duration-300 group relative overflow-hidden",
        active
          ? "bg-primary/10 text-theme-fg shadow-[0_4px_12px_rgba(0,0,0,0.03)] border border-primary/5"
          : "text-theme-muted hover:text-theme-fg hover:bg-theme-active/40"
      )}
      onClick={() => onClick(id)}
    >
      <Icon className={clsx("w-[18px] h-[18px] transition-all duration-300",
        active ? "text-primary scale-110 drop-shadow-[0_0_8px_rgba(0,122,204,0.4)]" : "text-theme-muted group-hover:text-theme-fg group-hover:scale-110")}
      />
      <span className={clsx("transition-all duration-300", active ? "translate-x-0.5" : "group-hover:translate-x-0.5")}>
        {label}
      </span>
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-r-full bg-primary shadow-[0_0_12px_rgba(0,122,204,0.5)]" />
      )}
    </button>
  );
}

function DashboardApp() {
  // Read initial tab from URL query param
  const [tab, setTab] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const initialTab = params.get('tab');
      if (initialTab && ['overview', 'history', 'planner', 'tasks', 'memories', 'automations', 'integrations', 'settings'].includes(initialTab)) {
        return initialTab;
      }
    } catch { }
    return "overview";
  });
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any | null>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [convLoading, setConvLoading] = useState<boolean>(false);
  const [creditsInfo, setCreditsInfo] = useState<null | { ok?: boolean; plan?: string; limit?: number; used?: number; remaining?: number; unlimited?: boolean; creditsPerUsd?: number }>(null);

  // Preferences
  const { tone, setTone, customTone, setCustomTone, setOnboardingComplete, themeMode, setThemeMode, themeDarkShade, setThemeDarkShade, themeLightShade, setThemeLightShade, themeText, setThemeText, persona, setPersona, translucentMode, setTranslucentMode, wakewordEnabled, setWakewordEnabled, terminalEnabled, setTerminalEnabled, browserEnabled, setBrowserEnabled, screenCaptureInvisible, setScreenCaptureInvisible, chatMode, setChatMode, chatModels, setChatModels } = usePreferences();
  const [personaDraft, setPersonaDraft] = useState<string>(persona || "");
  useEffect(() => { setPersonaDraft(persona || ""); }, [persona]);

  const {
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
    intCategories,
    filteredIntegrations,
    connectedCount,
    handleConnect,
    handleDisconnect,
    handleLearnMore,
    refreshPythonStatus,
    refreshFfmpegStatus,
    refreshMediapipeStatus,
    refreshBrowserStatus,
    setupPython,
    installPython,
    runPython,
    // profiles
    profiles,
    profilesLoading,
    refreshProfiles,
    setDefaultProfile,
    deleteProfile,
  } = useIntegrationsState({ session, AGENT_HTTP, CLOUD_AI_HTTP });

  // Local automations (Deployed Stuards)
  const [stuards, setStuards] = useState<any[]>([]);
  const [stuardsLoading, setStuardsLoading] = useState(false);
  // Calendar (Google-backed, Stuard blocks)
  const [calendarView, setCalendarView] = useState<'today' | 'month'>('today');
  const [calendarRefDate, setCalendarRefDate] = useState<Date>(new Date());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [calendarRange, setCalendarRange] = useState<{ start: string; end: string } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [calendarReloadToken, setCalendarReloadToken] = useState(0);
  
  // Unified Tasks (New System)
  const [unifiedTasks, setUnifiedTasks] = useState<any[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);

  const creditsFallback = useMemo(() => {
    const planKey = (p: string) => String(p || '').trim().toLowerCase();
    const limitForPlan = (p?: string) => {
      const k = planKey(p || 'free');
      if (k === 'team') return 50000;
      if (k === 'business') return 200000;
      if (k === 'enterprise') return 1000000;
      if (k === 'pro') return 2000; // ($25 - $5 profit) * 100
      if (k === 'ultra') return 5500; // ($60 - $5 profit) * 100
      return 250; // free: $2.5 * 100
    };
    try {
      const plan = planKey((profile?.plan || profile?.plan_name || 'free') as string);
      const limit = limitForPlan(plan);
      let usd = 0;
      for (const u of usage) {
        const cu = Number((u as any)?.cost_usd || (u as any)?.costUsd || 0);
        if (isFinite(cu) && cu > 0) usd += cu;
      }
      const used = Math.max(0, Math.ceil(usd * 100));
      const remaining = Math.max(0, limit - used);
      return { plan, limit, used, remaining, unlimited: false };
    } catch {
      return null;
    }
  }, [profile, usage]);
  const handleSaveTonePersona = async () => {
    try {
      setPersona(personaDraft || "");
      try { (window as any).desktopAPI?.notify?.('Saved', 'Tone & Persona will be used as system instructions.'); } catch { }
    } catch { }
  };

  const handleRefresh = async () => {
    await fetchData();
    if (tab === 'automations') {
      await loadStuards();
    }
    if (tab === 'planner') {
      await loadPlannerData();
    }
  };

  // Local automations loaders
  const loadStuards = async () => {
    setStuardsLoading(true);
    try {
      const res = await (window as any).desktopAPI?.stuardsList?.();
      if (res && res.ok && Array.isArray(res.items)) setStuards(res.items);
    } finally {
      setStuardsLoading(false);
    }
  };
  useEffect(() => {
    if (tab === 'automations') {
      loadStuards();
    }
  }, [tab]);

  // Listen for navigation events from main process (when dashboard is already open)
  useEffect(() => {
    const unsub = window.desktopAPI?.onDashboardNavigate?.((data) => {
      if (data?.tab && ['overview', 'history', 'planner', 'memories', 'automations', 'integrations', 'settings'].includes(data.tab)) {
        setTab(data.tab);
      }
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    let unsub: any;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      unsub = supabase.auth.onAuthStateChange((_e: AuthChangeEvent, s: Session | null) => {
        setSession(s);
      }).data?.subscription;
    })();
    return () => {
      if (unsub) unsub.unsubscribe();
    };
  }, []);

  const signInViaBrowser = async () => {
    setStatus("Opening browser…");
    const res = await startBrowserSignIn();
    if (!res.ok) setStatus(`Error: ${res.error}`);
    else setStatus("Signed in");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setStatus("");
    setProfile(null);
    setUsage([]);
    setConversations([]);
  };

  const handleSaveTheme = async () => {
    try {
      await (window as any).desktopAPI?.themeApply?.({
        themeMode,
        themeDarkShade,
        themeLightShade,
        themeText,
      });
    } catch { }
  };

  const fetchData = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const userId = session.user.id;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [p, u, c] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).limit(1),
        supabase.from("usage_events").select("*").eq("user_id", userId).gte("created_at", monthStart).order("created_at", { ascending: false }).limit(100),
        supabase.from("conversations").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!p.error) {
        const profileData = (p.data as any[])?.[0] ?? null;
        setProfile(profileData);
        // Sync name to local knowledge graph for agent personalization
        if (profileData?.full_name || profileData?.display_name || profileData?.username) {
          const name = profileData.full_name || profileData.display_name || profileData.username;
          try {
            // Fire and forget sync
            postJsonPlanner([`${AGENT_HTTP}/v1/knowledge/facts`], {
              action: 'upsert_core', // Helper alias handled by bridge or direct tool call
              key: 'name',
              value: name,
              source: 'profile_sync'
            }).catch(() => { });
          } catch { }
        }
      }
      if (!u.error) setUsage((u.data as any[]) ?? []);
      if (!c.error) setConversations((c.data as any[]) ?? []);
      // Reset selection if the selected conversation no longer exists
      try {
        if (selectedConversation) {
          const exists = (c.data as any[])?.some((it: any) => String(it.id) === String(selectedConversation.id));
          if (!exists) { setSelectedConversation(null); setConvMessages([]); }
        }
      } catch { }
      // Fetch credits from cloud server
      try {
        const token = session?.access_token;
        if (token) {
          const resp = await fetch(`${CLOUD_AI_HTTP}/v1/credits`, { headers: { Authorization: `Bearer ${token}` } });
          const j = await resp.json().catch(() => null);
          if (j && typeof j === 'object' && (j.ok === true || j.plan)) setCreditsInfo(j);
        }
      } catch { }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      // 1. Delete from local agent
      try {
        await fetch(`${AGENT_HTTP}/memory/conversations/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        console.error('Failed to delete from local agent:', err);
      }

      // 2. Delete from Supabase
      if (session) {
        await supabase.from('conversations').delete().eq('id', id);
      }

      // 3. Refresh list
      setConversations(prev => prev.filter(c => String(c.id) !== String(id)));
      if (selectedConversation && String(selectedConversation.id) === String(id)) {
        setSelectedConversation(null);
        setConvMessages([]);
      }

      try { (window as any).desktopAPI?.notify?.('Deleted', 'Conversation removed.'); } catch { }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  useEffect(() => {
    if (!session) return;
    fetchData();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (tab === 'overview' || tab === 'history') {
      fetchData();
    }
  }, [tab, session]);

  const firstOkJsonPlanner = async (urls: string[]) => {
    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) continue;
        const j = await resp.json().catch(() => null);
        if (j && typeof j === 'object') return j;
      } catch { }
    }
    return { ok: false } as any;
  };

  const postJsonPlanner = async (urls: string[], body: any) => {
    for (const u of urls) {
      try {
        const resp = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await resp.json().catch(() => null);
        if (resp.ok && j && typeof j === 'object') return j;
      } catch { }
    }
    return { ok: false } as any;
  };

  const loadUnifiedTasks = async () => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksList?.();
      if (res?.ok) {
        setUnifiedTasks(res.tasks || []);
      }
    } catch (e) {
      console.error("Failed to load unified tasks", e);
    }
  };

  const loadPlannerData = async () => {
    setPlannerLoading(true);
    try {
      await loadUnifiedTasks();
    } finally {
      setPlannerLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'planner') {
      loadPlannerData();
    }
  }, [tab]);

  useEffect(() => {
    (async () => {
      if (tab !== 'planner') return;
      const accessToken = session?.access_token;
      if (!accessToken) {
        setCalendarBlocks([]);
        setCalendarRange(null);
        setCalendarError('Cloud calendar unavailable (not signed in).');
        return;
      }
      setCalendarLoading(true);
      setCalendarError(null);
      try {
        const view = 'month';
        const dateIso = calendarRefDate.toISOString();
        const resp = await fetch(`${CLOUD_AI_HTTP}/v1/calendar/events?view=${encodeURIComponent(view)}&date=${encodeURIComponent(dateIso)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const j = await resp.json().catch(() => null);
        if (!j || (j as any).ok !== true) {
          const err = (j as any)?.error || 'failed';
          if (err === 'google_not_connected') {
            setCalendarError('Connect Google Calendar in Integrations to see events.');
          } else if (err === 'missing_scopes') {
            setCalendarError('Grant calendar access in Google integration to see events.');
          } else if (err === 'unauthorized') {
            setCalendarError('Session expired. Please sign in again.');
          } else {
            setCalendarError((j as any)?.message || 'Cloud calendar unavailable.');
          }
          setCalendarBlocks([]);
          setCalendarRange(null);
          return;
        }
        const blocks = Array.isArray((j as any).blocks) ? (j as any).blocks : [];
        setCalendarBlocks(blocks);
        const r = (j as any).range;
        if (r && typeof r === 'object') {
          setCalendarRange({ start: String(r.start || ''), end: String(r.end || '') });
        } else {
          setCalendarRange(null);
        }
        setSelectedBlockId((prev) => {
          if (prev && blocks.find((b: any) => String(b.id) === String(prev))) return prev;
          return null;
        });
      } catch {
        setCalendarError('Cloud calendar unavailable.');
        setCalendarBlocks([]);
        setCalendarRange(null);
      } finally {
        setCalendarLoading(false);
      }
    })();
  }, [tab, calendarView, session?.access_token, calendarReloadToken, calendarRefDate]);

  const parseLocalDay = (iso: string) => {
    if (typeof iso === 'string' && iso.length === 10 && iso.includes('-')) {
      const parts = iso.split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        const [y, m, d] = parts;
        return new Date(y, m - 1, d);
      }
    }
    return new Date(iso);
  };

  const handleRescheduleBlock = async (block: any, newDateIso: string) => {
    try {
      const computeNewIso = () => {
        try {
          if (newDateIso) {
            let d = parseLocalDay(newDateIso);
            // If dropping on a month-view day (YYYY-MM-DD), preserve original time
            if (newDateIso.length === 10 && block?.start) {
              const original = new Date(block.start);
              if (!isNaN(original.getTime())) {
                d.setHours(
                  original.getHours(),
                  original.getMinutes(),
                  original.getSeconds(),
                  original.getMilliseconds()
                );
              }
            }
            if (!Number.isNaN(d.getTime())) return d.toISOString();
          }
        } catch { }
        try {
          // Fallback to simply using the start time if no valid new date (shouldn't happen often)
          const start = block?.start ? new Date(block.start) : null;
          if (start && !Number.isNaN(start.getTime())) return start.toISOString();
        } catch { }
        return '';
      };

      const newTimeIso = computeNewIso();
      if (!newTimeIso) return;

      // Google/Outlook/External Event Reschedule
      if (block?.source === 'google' || block?.source === 'outlook') {
        // Attempt to update via cloud endpoint
        const accessToken = session?.access_token;
        if (!accessToken) {
          try { (window as any).desktopAPI?.notify?.('Error', 'You must be signed in to update external calendars.'); } catch { }
          return;
        }

        // Optimistic UI update could go here, but let's rely on refresh
        try {
          const resp = await fetch(`${CLOUD_AI_HTTP}/v1/calendar/events/${encodeURIComponent(block.id)}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              start: { dateTime: newTimeIso },
              // Calculate end time based on duration
              end: {
                dateTime: (() => {
                  const s = new Date(block.start);
                  const e = new Date(block.end);
                  const dur = e.getTime() - s.getTime();
                  return new Date(new Date(newTimeIso).getTime() + dur).toISOString();
                })()
              }
            })
          });

          if (resp.ok) {
            try { (window as any).desktopAPI?.notify?.('Success', 'Event rescheduled.'); } catch { }
            // Refresh calendar
            setCalendarReloadToken(t => t + 1);
          } else {
            const err = await resp.json().catch(() => ({}));
            console.warn('Update failed', err);
            try { (window as any).desktopAPI?.notify?.('Not Supported', 'Rescheduling this external event is not supported yet.'); } catch { }
          }
        } catch (e) {
          try { (window as any).desktopAPI?.notify?.('Error', 'Failed to reach calendar service.'); } catch { }
        }
        return;
      }

      // Unified Task reschedule
      if (block?.type === 'task' && block?.source === 'unified-tasks') {
         // Call update
         try {
           const updated = { id: block.id.replace('task:', ''), dueDate: newTimeIso };
           await (window as any).desktopAPI?.unifiedTasksUpdate?.(updated);
           await loadUnifiedTasks();
         } catch { }
         return;
      }
    } catch {
      // ignore
    }
  };

  const loadConversationMessages = async (id: string) => {
    setConvLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('role, content, metadata, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500);
      if (!error && Array.isArray(data)) setConvMessages(data as any[]);
    } finally {
      setConvLoading(false);
    }
  };

  // Notify on low/out-of-credits
  useEffect(() => {
    try {
      if (!creditsInfo || creditsInfo.unlimited || typeof creditsInfo.limit !== 'number' || creditsInfo.limit <= 0) return;
      const used = Math.max(0, creditsInfo.used || 0);
      const remaining = Math.max(0, creditsInfo.remaining || (creditsInfo.limit - used));
      const pctLeft = creditsInfo.limit > 0 ? remaining / creditsInfo.limit : 1;
      const ym = new Date().toISOString().slice(0, 7);
      const lowKey = `credits.low.notified.${ym}`;
      const outKey = `credits.out.notified.${ym}`;
      if (remaining <= 0) {
        const was = localStorage.getItem(outKey);
        if (!was) {
          try { (window as any).desktopAPI?.notify?.('Out of credits', 'You have used all monthly credits. Consider upgrading or buying more.'); } catch { }
          try { localStorage.setItem(outKey, '1'); } catch { }
        }
        return;
      }
      if (pctLeft <= 0.1) {
        const was = localStorage.getItem(lowKey);
        if (!was) {
          try { (window as any).desktopAPI?.notify?.('Low credits', `Only ${remaining} credits left this month.`); } catch { }
          try { localStorage.setItem(lowKey, '1'); } catch { }
        }
      }
    } catch { }
  }, [creditsInfo]);

  // Load messages whenever a conversation is selected
  useEffect(() => {
    if (selectedConversation && selectedConversation.id) {
      loadConversationMessages(String(selectedConversation.id));
    } else {
      setConvMessages([]);
    }
  }, [selectedConversation?.id]);

  const unifiedBlocks = useMemo(() => {
    const blocks: any[] = [];
    const base = Array.isArray(calendarBlocks) ? calendarBlocks : [];
    for (const b of base) {
      blocks.push({ ...b, type: (b as any).type || 'event' });
    }
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;
    try {
      if (calendarRange && calendarRange.start && calendarRange.end) {
        const s = new Date(calendarRange.start);
        const e = new Date(calendarRange.end);
        if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
          rangeStart = s;
          rangeEnd = e;
        }
      }
    } catch { }
    const inRange = (d: Date | null) => {
      if (!d) return false;
      if (rangeStart && rangeEnd) {
        const t = d.getTime();
        return t >= rangeStart.getTime() && t < rangeEnd.getTime();
      }
      return true;
    };
    
    // Unified Tasks
    for (const t of unifiedTasks) {
      if (!t || !t.dueDate || t.status === 'completed' || t.status === 'cancelled') continue;
      if (t.showInCalendar === false) continue;

      let dt: Date | null = null;
      try {
        dt = new Date(t.dueDate);
        if (Number.isNaN(dt.getTime())) dt = null;
      } catch { dt = null; }

      if (!dt || !inRange(dt)) continue;
      
      const iso = dt.toISOString();
      const isAllDay = t.allDay || iso.includes('T00:00:00.000Z'); // Heuristic if allDay prop missing
      
      blocks.push({
        id: `task:${String(t.id)}`,
        source: 'unified-tasks',
        type: 'task',
        title: String(t.title || '(task)'),
        description: t.description,
        start: iso,
        end: isAllDay ? iso : new Date(dt.getTime() + 30 * 60000).toISOString(), // 30 min duration for timed tasks
        allDay: isAllDay,
        priority: t.priority,
        original: t,
      });
    }

    return blocks.sort((a, b) => {
      const ta = a.start ? new Date(a.start).getTime() : 0;
      const tb = b.start ? new Date(b.start).getTime() : 0;
      return ta - tb;
    });
  }, [calendarBlocks, unifiedTasks, calendarRange]);

  const calendarBlocksSorted = useMemo(() => {
    const arr = Array.isArray(unifiedBlocks) ? [...unifiedBlocks] : [];
    arr.sort((a, b) => {
      try {
        const ta = a?.start ? new Date(a.start).getTime() : 0;
        const tb = b?.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      } catch {
        return 0;
      }
    });
    return arr;
  }, [unifiedBlocks]);

  const calendarDays = useMemo(() => {
    const byDate: Record<string, any[]> = {};
    for (const b of calendarBlocksSorted) {
      let key = 'unknown';
      if (b.allDay) {
        // All day events use the date string directly (YYYY-MM-DD)
        key = typeof b.start === 'string' ? b.start.slice(0, 10) : '';
      } else {
        // Timed events: convert to local date string
        const iso = typeof b?.start === 'string' && b.start ? b.start : (typeof b?.end === 'string' ? b.end : '');
        if (iso) {
          try {
            const d = new Date(iso);
            if (!isNaN(d.getTime())) {
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              key = `${y}-${m}-${day}`;
            }
          } catch { }
        }
      }

      if (!key) key = 'unknown';
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(b);
    }
    const entries = Object.entries(byDate);
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([date, blocks]) => ({ date, blocks }));
  }, [calendarBlocksSorted]);

  const selectedBlock = useMemo(() => {
    if (!selectedBlockId) return null;
    return calendarBlocksSorted.find((b: any) => String(b.id) === selectedBlockId) || null;
  }, [calendarBlocksSorted, selectedBlockId]);

  useEffect(() => {
    if (tab !== 'planner') return;
    const now = new Date();
    setSelectedBlockId((prev) => {
      if (prev && calendarBlocksSorted.find((b: any) => String(b.id) === String(prev))) return prev;
      return pickNextUpcomingBlockId(calendarBlocksSorted, now);
    });
  }, [tab, calendarBlocksSorted]);

  const userEmail = session?.user?.email ?? null;


  // Apply theme to body
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark' || themeMode === 'custom') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }

    // Apply custom theme colors if in custom mode
    if (themeMode === 'custom') {
      root.style.setProperty('--custom-gradient-start', themeDarkShade);
      root.style.setProperty('--custom-gradient-end', themeLightShade);
      root.style.setProperty('--custom-text-color', themeText === 'white' ? '#ffffff' : '#000000');
    } else {
      root.style.removeProperty('--custom-gradient-start');
      root.style.removeProperty('--custom-gradient-end');
      root.style.removeProperty('--custom-text-color');
    }
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);

  return (
    <ErrorBoundary>
      <div className="w-screen h-screen flex overflow-hidden bg-theme-bg text-theme-fg font-sans selection:bg-primary selection:text-white">
        {/* Sidebar */}
        <div className="w-[280px] border-r border-theme-sidebar bg-theme-sidebar/80 backdrop-blur-2xl flex flex-col z-20 transition-all duration-300">
          <div className="drag h-10 w-full" />
          <div className="px-8 pb-10 flex items-center gap-4 select-none">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-blue-600 text-primary-fg flex items-center justify-center shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95">
              <span className="font-black text-lg tracking-tighter">S</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[15px] text-theme-fg tracking-tight leading-none">Stuard</span>
                <EnvironmentBadge variant="minimal" />
              </div>
              <div className="text-[10px] text-theme-muted font-bold uppercase tracking-[0.15em] mt-1 opacity-60">Dashboard</div>
            </div>
          </div>

          <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar" data-onboarding="sidebar-nav">
            <div className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em] px-4 mb-2 opacity-40">Main</div>
            <SidebarItem id="overview" label="Overview" icon={LayoutDashboard} current={tab} onClick={setTab} />
            <SidebarItem id="history" label="History" icon={Clock} current={tab} onClick={setTab} />
            <SidebarItem id="planner" label="Planner" icon={Calendar} current={tab} onClick={setTab} />
            <SidebarItem id="tasks" label="Tasks" icon={ListTodo} current={tab} onClick={setTab} />

            <div className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em] px-4 mt-6 mb-2 opacity-40">Intelligence</div>
            <SidebarItem id="memories" label="Memories" icon={Archive} current={tab} onClick={setTab} />
            <SidebarItem id="automations" label="Automations" icon={Zap} current={tab} onClick={setTab} />

            <div className="text-[10px] font-black text-theme-muted uppercase tracking-[0.2em] px-4 mt-6 mb-2 opacity-40">System</div>
            <SidebarItem id="integrations" label="Integrations" icon={Link} current={tab} onClick={setTab} />
            <SidebarItem id="settings" label="Settings" icon={Settings} current={tab} onClick={setTab} />
          </nav>

          <div className="p-4 mt-auto">
            {userEmail ? (
              <div className="flex items-center gap-4 p-3 rounded-2xl bg-theme-hover/50 border border-theme/10 hover:bg-theme-hover transition-all duration-200 cursor-default group shadow-sm">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-black text-primary border border-primary/20 shadow-inner">
                  {userEmail[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-theme-fg truncate">{userEmail.split('@')[0]}</div>
                  <button
                    onClick={signOut}
                    className="text-[10px] text-theme-muted hover:text-red-500 font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors mt-0.5"
                  >
                    <LogOut className="w-3 h-3" />
                    Secure Logout
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={signInViaBrowser}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-primary text-primary-fg text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20"
              >
                Sign in to Stuard
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-theme-bg relative transition-colors duration-200">
          <div className="drag h-10 w-full shrink-0 absolute top-0 left-0 right-0 z-50 pointer-events-none" />

          {/* Content Wrapper */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            {tab === 'memories' ? (
              <div className="flex-1 overflow-hidden animate-in fade-in duration-500">
                <MemoriesView />
              </div>
            ) : (
              <main className="flex-1 overflow-y-auto custom-scrollbar p-10 pt-16">
                <div className="max-w-6xl mx-auto h-full">
                  {!userEmail && !['planner', 'automations'].includes(tab) ? (
                    <div className="flex flex-col items-center justify-center h-[70vh] text-center space-y-8 animate-in fade-in zoom-in duration-700">
                      <div className="h-32 w-32 rounded-[2.5rem] bg-theme-card/50 flex items-center justify-center mb-4 shadow-2xl border border-theme backdrop-blur-xl relative group">
                        <div className="absolute inset-0 bg-primary/20 rounded-[2.5rem] blur-2xl group-hover:blur-3xl transition-all duration-500 opacity-50" />
                        <User className="w-14 h-14 text-primary relative z-10" />
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-4xl font-black text-theme-fg tracking-tight">Identity Required</h2>
                        <p className="text-theme-muted max-w-sm mt-2 text-base font-medium leading-relaxed mx-auto opacity-80">
                          Connect your account to access your personalized neural workspace and synced knowledge base.
                        </p>
                      </div>
                      <button
                        onClick={signInViaBrowser}
                        className="group relative px-10 py-4 rounded-2xl bg-primary text-primary-fg font-black text-lg transition-all shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:-translate-y-1 active:scale-95 overflow-hidden"
                      >
                        <span className="relative z-10">Connect Account</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                      </button>
                    </div>
                  ) : (
                    <ErrorBoundary>
                      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full">
                        {/* Global Actions Header Area */}
                        {!['automations', 'integrations', 'settings'].includes(tab) && (
                          <div className="flex items-center justify-between mb-8">
                            <div className="space-y-1">
                              <h1 className="text-3xl font-black text-theme-fg tracking-tight capitalize font-stuard">
                                {tab}
                              </h1>
                            </div>

                            <div className="flex items-center gap-3">
                              {!['planner', 'automations', 'memories'].includes(tab) && (
                                <button
                                  onClick={handleRefresh}
                                  disabled={loading}
                                  className="p-3 rounded-2xl bg-theme-hover/50 hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all border border-theme/10 group active:scale-90"
                                  title="Sync Hub Data"
                                >
                                  <RefreshCw className={clsx("w-4 h-4 transition-transform duration-500 group-hover:rotate-180", loading && "animate-spin")} />
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Tab Content Rendering */}
                        <div className="relative min-h-[calc(100%-80px)]">
                          {tab === 'overview' && userEmail && (
                            <OverviewView
                              creditsInfo={creditsInfo}
                              creditsFallback={creditsFallback}
                              profile={profile}
                              usage={usage}
                              conversations={conversations}
                              onNavigate={setTab}
                            />
                          )}

                          {tab === 'history' && userEmail && (
                            <HistoryView
                              usage={usage}
                              conversations={conversations}
                              selectedConversation={selectedConversation}
                              setSelectedConversation={setSelectedConversation}
                              convMessages={convMessages}
                              convLoading={convLoading}
                              onDeleteConversation={handleDeleteConversation}
                            />
                          )}

                          {tab === 'planner' && (
                            <UnifiedPlannerView
                              calendarView={calendarView}
                              onChangeCalendarView={setCalendarView}
                              calendarRefDate={calendarRefDate}
                              onMonthChange={setCalendarRefDate}
                              calendarRange={calendarRange}
                              calendarLoading={calendarLoading}
                              calendarError={calendarError}
                              calendarBlocksSorted={calendarBlocksSorted}
                              calendarDays={calendarDays}
                              selectedBlock={selectedBlock}
                              selectedBlockId={selectedBlockId}
                              onSelectBlock={setSelectedBlockId}
                              onRescheduleBlock={handleRescheduleBlock}
                              onRefresh={() => setCalendarReloadToken(t => t + 1)}
                              AGENT_HTTP={AGENT_HTTP}
                              tasks={unifiedTasks}
                            />
                          )}

                          {tab === 'tasks' && (
                            <TasksView />
                          )}

                          {tab === 'settings' && userEmail && (
                            <SettingsView
                              themeMode={themeMode}
                              setThemeMode={setThemeMode as any}
                              themeDarkShade={themeDarkShade}
                              setThemeDarkShade={setThemeDarkShade}
                              themeLightShade={themeLightShade}
                              setThemeLightShade={setThemeLightShade}
                              themeText={themeText as any}
                              setThemeText={setThemeText as any}
                              translucentMode={translucentMode}
                              setTranslucentMode={setTranslucentMode}
                              wakewordEnabled={wakewordEnabled}
                              setWakewordEnabled={setWakewordEnabled}
                              terminalEnabled={terminalEnabled}
                              setTerminalEnabled={setTerminalEnabled}
                              screenCaptureInvisible={screenCaptureInvisible}
                              setScreenCaptureInvisible={setScreenCaptureInvisible}
                              handleSaveTheme={handleSaveTheme}
                              tone={tone}
                              setTone={setTone}
                              customTone={customTone}
                              setCustomTone={setCustomTone}
                              personaDraft={personaDraft}
                              setPersonaDraft={setPersonaDraft}
                              persona={persona}
                              handleSaveTonePersona={handleSaveTonePersona}
                              setOnboardingComplete={setOnboardingComplete}
                            />
                          )}

                          {tab === 'automations' && (
                            <AutomationsView
                              stuards={stuards}
                              stuardsLoading={stuardsLoading}
                              loadStuards={loadStuards}
                            />
                          )}

                          {tab === 'integrations' && userEmail && (
                            <>
                              <IntegrationsView
                                connectedCount={connectedCount}
                                filteredIntegrations={filteredIntegrations}
                                intQuery={intQuery}
                                setIntQuery={setIntQuery}
                                intCategory={intCategory}
                                setIntCategory={setIntCategory}
                                intCategories={intCategories}
                                connectedMap={connectedMap}
                                handleConnect={handleConnect}
                                handleDisconnect={handleDisconnect}
                                handleLearnMore={handleLearnMore}
                                pyStatus={pyStatus}
                                ffStatus={ffStatus}
                                pyEnvId={pyEnvId}
                                setPyEnvId={setPyEnvId}
                                pyPackages={pyPackages}
                                setPyPackages={setPyPackages}
                                pyReqTxt={pyReqTxt}
                                setPyReqTxt={setPyReqTxt}
                                pyRunCode={pyRunCode}
                                setPyRunCode={setPyRunCode}
                                pyInstalling={pyInstalling}
                                ffInstalling={ffInstalling}
                                mpStatus={mpStatus}
                                mpInstalling={mpInstalling}
                                pyRunning={pyRunning}
                                pyRunResult={pyRunResult}
                                refreshPythonStatus={refreshPythonStatus}
                                refreshFfmpegStatus={refreshFfmpegStatus}
                                refreshMediapipeStatus={refreshMediapipeStatus}
                                refreshBrowserStatus={refreshBrowserStatus}
                                setupPython={setupPython}
                                installPython={installPython}
                                runPython={runPython}
                                browserStatus={browserStatus}
                                profiles={profiles}
                                profilesLoading={profilesLoading}
                                refreshProfiles={refreshProfiles}
                                setDefaultProfile={setDefaultProfile}
                                deleteProfile={deleteProfile}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </ErrorBoundary>
                  )}
                </div>
              </main>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
