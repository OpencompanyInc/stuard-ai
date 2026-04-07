import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./scrollbar.css";
import { supabase } from "./lib/supabaseClient";
import { startBrowserSignIn } from "./auth/browserSignIn";
import { fetchRendererSyncPrefs } from "./utils/syncPrefs";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { usePreferences } from "./hooks/usePreferences";
import { useIntegrationsState } from "./hooks/useIntegrationsState";
import { UnifiedPlannerView } from "./components/UnifiedPlannerView";
import { OverviewView } from "./components/OverviewView";
import { HistoryView } from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { IntegrationsView } from "./components/IntegrationsView";
import { MemoriesView } from "./components/MemoriesView";
import { TasksView } from "./components/TasksView";
import { CloudEngineDashboard } from "./components/CloudEngineDashboard";
import { StorageView } from "./components/StorageView";
import { MediaLibraryView } from "./components/MediaLibraryView";
import { ProactiveView } from "./components/ProactiveView";
import { VaultView } from "./components/VaultView";
import { MemoryLockGate } from "./components/MemoryLockGate";
import {
  LayoutDashboard,
  Clock,
  Settings,
  Link,
  Calendar,
  LogOut,
  RefreshCw,
  Archive,
  User,
  ListTodo,
  Cloud,
  HardDrive,
  Image as ImageIcon,
  Sparkles,
  Shield
} from "lucide-react";
import { clsx } from 'clsx';
import 'katex/dist/katex.min.css';
import { agentFetchJson, resolveAgentEndpoints } from './utils/agentEndpoints';

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

function getConversationMessageTime(value: { created_at?: string; timestamp?: number } | null | undefined): number {
  const direct = typeof value?.timestamp === 'number' ? value.timestamp : NaN;
  if (Number.isFinite(direct)) return direct;
  const parsed = Date.parse(String(value?.created_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function repairConversationMessageRows<T extends { role?: string; turn_index?: number; created_at?: string; timestamp?: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => {
    const aTurn = Number(a?.turn_index);
    const bTurn = Number(b?.turn_index);
    const aHasTurn = Number.isFinite(aTurn);
    const bHasTurn = Number.isFinite(bTurn);

    if (aHasTurn || bHasTurn) {
      if (aHasTurn && bHasTurn && aTurn !== bTurn) return aTurn - bTurn;
      if (aHasTurn !== bHasTurn) return aHasTurn ? -1 : 1;
    }

    return getConversationMessageTime(a) - getConversationMessageTime(b);
  });

  const messageIndices = sorted
    .map((row, index) => ({
      index,
      role: row?.role === 'assistant' || row?.role === 'user' ? row.role : null,
    }))
    .filter((item): item is { index: number; role: 'assistant' | 'user' } => item.role === 'assistant' || item.role === 'user');

  if (messageIndices.length < 2 || messageIndices[0].role !== 'assistant' || messageIndices[1].role !== 'user') {
    return sorted;
  }

  let checkedPairs = 0;
  let reversedPairs = 0;
  for (let i = 0; i + 1 < messageIndices.length; i += 2) {
    checkedPairs += 1;
    if (messageIndices[i].role === 'assistant' && messageIndices[i + 1].role === 'user') {
      reversedPairs += 1;
    }
  }

  if (reversedPairs < Math.max(1, Math.ceil(checkedPairs / 2))) {
    return sorted;
  }

  const repaired = [...sorted];
  for (let i = 0; i + 1 < messageIndices.length; i += 2) {
    const first = messageIndices[i];
    const second = messageIndices[i + 1];
    if (first.role === 'assistant' && second.role === 'user') {
      [repaired[first.index], repaired[second.index]] = [repaired[second.index], repaired[first.index]];
    }
  }

  return repaired;
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
        "dashboard-sidebar-item w-full flex items-center gap-3 px-3.5 py-3 text-[13px] font-semibold transition-all duration-200 group relative",
        active && "is-active"
      )}
      onClick={() => onClick(id)}
    >
      <Icon className={clsx("w-4 h-4 transition-all duration-200",
        active ? "text-theme-fg" : "text-theme-muted group-hover:text-theme-fg")}
      />
      <span className="flex-1 text-left leading-none">
        {label}
      </span>
      {active && (
        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_rgba(0,122,204,0.45)]" />
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
      if (initialTab && ['overview', 'history', 'planner', 'tasks', 'proactive', 'memories', 'integrations', 'settings', 'cloud', 'media', 'storage', 'vault'].includes(initialTab)) {
        return initialTab;
      }
    } catch { }
    return "overview";
  });
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [usageCountLoading, setUsageCountLoading] = useState(false);
  const [usageCountLoaded, setUsageCountLoaded] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsLoadedLimit, setConversationsLoadedLimit] = useState(0);
  const [selectedConversation, setSelectedConversation] = useState<any | null>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [convLoading, setConvLoading] = useState<boolean>(false);
  const [creditsInfo, setCreditsInfo] = useState<null | { ok?: boolean; plan?: string; limit?: number; used?: number; remaining?: number; unlimited?: boolean; creditsPerUsd?: number }>(null);
  const [appVersion, setAppVersion] = useState<string>('0.1.10');

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
    intCategories,
    filteredIntegrations,
    connectedCount,
    handleConnect,
    handleDisconnect,
    handleLearnMore,
    refreshPythonStatus,
    refreshFfmpegStatus,
    refreshMediapipeStatus,
    ollamaStatus,
    ollamaChecking,
    refreshOllamaStatus,
    startOllama,
    browserUseStatus,
    browserUseChecking,
    browserUseSetupProgress,
    refreshBrowserUseStatus,
    setupBrowserUse,
    stopBrowserUse,
    uninstallBrowserUse,
    setupPython,
    installPython,
    runPython,
    // profiles
    profiles,
    profilesLoading,
    refreshProfiles,
    setDefaultProfile,
    deleteProfile,
    // telnyx
    telnyxPhones,
    telnyxVerifying,
    telnyxRequestCode,
    telnyxVerifyCode,
    telnyxDisconnect,
    telnyxRemovePhone,
    refreshTelnyxStatus,
    // whatsapp
    whatsappPhone,
    whatsappConnecting,
    whatsappLinking,
    whatsappLinkCode,
    whatsappBotNumber,
    whatsappConnect,
    whatsappInitiateLink,
    whatsappDisconnect,
  } = useIntegrationsState({ session, AGENT_HTTP, CLOUD_AI_HTTP });
  // Calendar (Google-backed, Stuard blocks)
  const [calendarView, setCalendarView] = useState<'today' | 'month'>('month');
  const [calendarRefDate, setCalendarRefDateRaw] = useState<Date>(() => new Date());
  const calendarRefMonthKey = `${calendarRefDate.getFullYear()}-${calendarRefDate.getMonth()}`;
  const setCalendarRefDate = useCallback((d: Date) => {
    setCalendarRefDateRaw(prev => {
      if (prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth()) return prev;
      return d;
    });
  }, []);
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
      return { plan, limit, used: 0, remaining: limit, unlimited: false };
    } catch {
      return null;
    }
  }, [profile]);
  const handleSaveTonePersona = async () => {
    try {
      setPersona(personaDraft || "");
      try { (window as any).desktopAPI?.notify?.('Saved', 'Tone & Persona will be used as system instructions.'); } catch { }
    } catch { }
  };

  // Listen for navigation events from main process (when dashboard is already open)
  useEffect(() => {
    const unsub = window.desktopAPI?.onDashboardNavigate?.((data) => {
      if (data?.tab && ['overview', 'history', 'planner', 'memories', 'integrations', 'settings', 'vault'].includes(data.tab)) {
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

  useEffect(() => {
    (async () => {
      try {
        const info = await (window as any).desktopAPI?.invoke?.('system:getAppInfo');
        if (info?.ok && info?.version) {
          setAppVersion(String(info.version));
          return;
        }
      } catch { }
      try {
        const info = await (window as any).desktopAPI?.systemGetAppInfo?.();
        if (info?.ok && info?.version) setAppVersion(String(info.version));
      } catch { }
    })();
  }, []);

  const signInViaBrowser = async () => {
    setStatus("Opening browser…");
    const res = await startBrowserSignIn();
    if (!res.ok) {
      setStatus(`Error: ${"error" in res ? res.error : "Unable to sign in"}`);
    } else {
      setStatus("Signed in");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setStatus("");
    setProfile(null);
    setUsageCount(0);
    setUsageCountLoaded(false);
    setConversations([]);
    setConversationsLoadedLimit(0);
    setSelectedConversation(null);
    setConvMessages([]);
    setCreditsInfo(null);
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

  const loadProfileAndCredits = useCallback(async () => {
    if (!session) {
      setProfile(null);
      setCreditsInfo(null);
      return;
    }
    try {
      const userId = session.user.id;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .limit(1);
      if (!error) {
        const profileData = (data as any[])?.[0] ?? null;
        setProfile(profileData);
        if (profileData?.full_name || profileData?.display_name || profileData?.username) {
          const name = profileData.full_name || profileData.display_name || profileData.username;
          try {
            postJsonPlanner([`${AGENT_HTTP}/v1/knowledge/facts`], {
              action: 'upsert_core',
              key: 'name',
              value: name,
              source: 'profile_sync'
            }).catch(() => { });
          } catch { }
        }
      }
      if (session.access_token) {
        const fetchCredits = async () => {
          try {
            const resp = await fetch(`${CLOUD_AI_HTTP}/v1/credits`, {
              headers: { Authorization: `Bearer ${session.access_token}` }
            });
            const j = await resp.json().catch(() => null);
            if (j && typeof j === 'object' && (j.ok === true || j.plan)) {
              setCreditsInfo(j);
              return true;
            }
          } catch { }
          return false;
        };
        if (!(await fetchCredits())) {
          setTimeout(() => { fetchCredits().catch(() => { }); }, 2000);
        }
      }
    } catch { }
  }, [session]);

  const loadConversations = useCallback(async (requestedLimit = 20, force = false) => {
    if (!force && (conversationsLoading || conversationsLoadedLimit >= requestedLimit)) return;
    setConversationsLoading(true);
    try {
      const json = await agentFetchJson(
        resolveAgentEndpoints(),
        `/v1/memory/conversations?limit=${requestedLimit}&source=stuard`,
        { accessToken: session?.access_token || null },
      );
      if (json.ok && Array.isArray(json.conversations)) {
        const convs = json.conversations
          .map((c: any) => ({ ...c, id: c.id || c.conversation_id }))
          .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
          .slice(0, requestedLimit);
        setConversations(convs);
        setConversationsLoadedLimit(requestedLimit);
        try {
          if (selectedConversation) {
            const exists = convs.some((it: any) => String(it.id) === String(selectedConversation.id));
            if (!exists) {
              setSelectedConversation(null);
              setConvMessages([]);
            }
          }
        } catch { }
      }
    } catch { }
    finally {
      setConversationsLoading(false);
    }
  }, [conversationsLoading, conversationsLoadedLimit, selectedConversation, session?.access_token]);

  const loadUsageCount = useCallback(async (force = false) => {
    if (!session) {
      setUsageCount(0);
      setUsageCountLoaded(false);
      return;
    }
    if (!force && usageCountLoading) return;
    if (!force && usageCountLoaded) return;
    setUsageCountLoading(true);
    try {
      const userId = session.user.id;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count, error } = await supabase
        .from("usage_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", monthStart);
      if (!error) {
        setUsageCount(count ?? 0);
        setUsageCountLoaded(true);
      }
    } catch { }
    finally {
      setUsageCountLoading(false);
    }
  }, [session, usageCountLoaded, usageCountLoading]);

  const handleDeleteConversation = async (id: string) => {
    try {
      // 1. Delete from local agent
      try {
        await agentFetchJson(
          resolveAgentEndpoints(),
          `/v1/memory/conversations/${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            accessToken: session?.access_token || null,
          },
        );
      } catch (err) {
        console.error('Failed to delete from local agent:', err);
      }

      // 2. Delete from Supabase
      const syncPrefs = await fetchRendererSyncPrefs();
      if (session && syncPrefs.sync_conversations) {
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
    loadProfileAndCredits();
  }, [loadProfileAndCredits]);

  useEffect(() => {
    if (!session) {
      setConversations([]);
      setConversationsLoadedLimit(0);
      setUsageCount(0);
      setUsageCountLoaded(false);
      return;
    }
    if (tab === 'overview') {
      loadConversations(10).catch(() => { });
      loadUsageCount().catch(() => { });
    }
    if (tab === 'history') {
      loadConversations(20).catch(() => { });
    }
  }, [tab, session, loadConversations, loadUsageCount]);

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
      // Offline calendar events are loaded in the calendar effect
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

      // Always compute a reasonable range for the current month view
      const computeMonthRange = () => {
        const base = new Date(calendarRefDate.getFullYear(), calendarRefDate.getMonth(), 1);
        const start = new Date(base);
        start.setDate(start.getDate() - start.getDay()); // Rewind to Sunday
        const end = new Date(start);
        end.setDate(end.getDate() + 42); // 6 weeks
        return { start: start.toISOString(), end: end.toISOString() };
      };

      setCalendarLoading(true);
      setCalendarError(null);

      let cloudBlocks: any[] = [];
      let cloudRange: { start: string; end: string } | null = null;
      let cloudError: string | null = null;

      // Try loading cloud/Google Calendar events
      const accessToken = session?.access_token;
      if (accessToken) {
        try {
          const view = 'month';
          const dateIso = calendarRefDate.toISOString();
          const resp = await fetch(`${CLOUD_AI_HTTP}/v1/calendar/events?view=${encodeURIComponent(view)}&date=${encodeURIComponent(dateIso)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const j = await resp.json().catch(() => null);
          if (j && (j as any).ok === true) {
            cloudBlocks = Array.isArray((j as any).blocks) ? (j as any).blocks : [];
            const r = (j as any).range;
            if (r && typeof r === 'object') {
              cloudRange = { start: String(r.start || ''), end: String(r.end || '') };
            }
          } else {
            const err = (j as any)?.error || 'failed';
            if (err === 'google_not_connected') {
              cloudError = 'Connect Google Calendar in Integrations to also see Google events.';
            } else if (err === 'missing_scopes') {
              cloudError = 'Grant calendar access in Google integration to see Google events.';
            } else if (err === 'unauthorized') {
              cloudError = 'Session expired — Google Calendar sync paused.';
            } else {
              cloudError = null; // Don't show generic cloud errors, just use offline
            }
          }
        } catch {
          cloudError = null; // Silently fall back to offline
        }
      }

      // Load offline/local calendar events
      let offlineBlocks: any[] = [];
      try {
        const monthRange = cloudRange || computeMonthRange();
        const res = await (window as any).desktopAPI?.offlineCalendarGetBlocks?.(monthRange.start, monthRange.end);
        if (res?.ok && Array.isArray(res.blocks)) {
          offlineBlocks = res.blocks;
        }
      } catch (e) {
        console.warn('Failed to load offline calendar:', e);
      }

      // Merge cloud + offline blocks
      const allBlocks = [...cloudBlocks, ...offlineBlocks];
      setCalendarBlocks(allBlocks);

      // Use cloud range if available, otherwise compute from current month
      setCalendarRange(cloudRange || computeMonthRange());

      // Only show error if there are no blocks at all and there's a meaningful message
      if (cloudError && allBlocks.length === 0) {
        setCalendarError(cloudError);
      } else if (cloudError) {
        // Show as info note, not blocking error
        setCalendarError(cloudError);
      } else if (!accessToken && allBlocks.length === 0) {
        setCalendarError(null); // No error - offline mode is fine
      } else {
        setCalendarError(null);
      }

      setSelectedBlockId((prev) => {
        if (prev && allBlocks.find((b: any) => String(b.id) === String(prev))) return prev;
        return null;
      });

      setCalendarLoading(false);
    })();
  }, [tab, calendarView, session?.access_token, calendarReloadToken, calendarRefMonthKey]);

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
      // Try local agent first
      try {
        const json = await agentFetchJson(
          resolveAgentEndpoints(),
          `/v1/memory/conversations/${encodeURIComponent(id)}/messages?limit=500`,
          { accessToken: session?.access_token || null },
        );
        if (json.ok && Array.isArray(json.messages)) {
          setConvMessages(repairConversationMessageRows(json.messages as any[]));
          return;
        }
      } catch { }
      // Fallback to Supabase
      const syncPrefs = await fetchRendererSyncPrefs();
      if (session && syncPrefs.sync_conversations) {
        const { data, error } = await supabase
          .from('messages')
          .select('role, content, metadata, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: true })
          .limit(500);
        if (!error && Array.isArray(data)) setConvMessages(repairConversationMessageRows(data as any[]));
      }
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
      if (!t || t.status === 'completed' || t.status === 'cancelled') continue;
      if (t.showInCalendar === false) continue;

      // Task block (if it has a dueDate)
      if (t.dueDate) {
        let dt: Date | null = null;
        try {
          dt = new Date(t.dueDate);
          if (Number.isNaN(dt.getTime())) dt = null;
        } catch { dt = null; }

        if (dt && inRange(dt)) {
          const iso = dt.toISOString();
          const isAllDay = t.allDay || iso.includes('T00:00:00.000Z');
          blocks.push({
            id: `task:${String(t.id)}`,
            source: 'unified-tasks',
            type: 'task',
            title: String(t.title || '(task)'),
            description: t.description,
            start: iso,
            end: isAllDay ? iso : new Date(dt.getTime() + 30 * 60000).toISOString(),
            allDay: isAllDay,
            priority: t.priority,
            original: t,
          });
        }
      }

      // Reminder blocks from agentAssignments
      const reminders = (t.agentAssignments || []).filter((a: any) => a.status === 'pending' && a.scheduledAt);
      for (const r of reminders) {
        let rdt: Date | null = null;
        try {
          rdt = new Date(r.scheduledAt);
          if (Number.isNaN(rdt.getTime())) rdt = null;
        } catch { rdt = null; }
        if (!rdt || !inRange(rdt)) continue;
        const riso = rdt.toISOString();
        blocks.push({
          id: `reminder:${String(t.id)}:${String(r.id)}`,
          source: 'reminder',
          type: 'reminder',
          title: r.message || `Reminder: ${String(t.title || '')}`,
          description: `Task: ${t.title}`,
          start: riso,
          end: new Date(rdt.getTime() + 15 * 60000).toISOString(),
          allDay: false,
          priority: t.priority,
          original: t,
        });
      }
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

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await loadProfileAndCredits();
      if (tab === 'overview') {
        await Promise.all([
          loadConversations(10, true),
          loadUsageCount(true),
        ]);
      } else if (tab === 'history') {
        await loadConversations(20, true);
        if (selectedConversation?.id) {
          await loadConversationMessages(String(selectedConversation.id));
        }
      } else if (tab === 'planner') {
        await loadPlannerData();
      }
    } finally {
      setLoading(false);
    }
  };

  const sidebarSections = [
    {
      key: 'primary',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'history', label: 'History', icon: Clock },
        { id: 'planner', label: 'Planner', icon: Calendar },
        { id: 'tasks', label: 'Tasks', icon: ListTodo },
      ],
    },
    {
      key: 'intelligence',
      items: [
        { id: 'memories', label: 'Memories', icon: Archive },
        { id: 'proactive', label: 'Proactive', icon: Sparkles },
      ],
    },
    {
      key: 'cloud',
      items: [
        { id: 'cloud', label: 'Cloud Engine', icon: Cloud },
        { id: 'media', label: 'Media', icon: ImageIcon },
        { id: 'vault', label: 'Vault', icon: Shield },
        { id: 'storage', label: 'Storage', icon: HardDrive },
      ],
    },
    {
      key: 'system',
      items: [
        { id: 'integrations', label: 'Connected Apps', icon: Link },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  const tabMeta: Record<string, { title: string; subtitle: string }> = {
    overview: { title: 'Overview', subtitle: "Here's what's happening with your Stuard today." },
    history: { title: 'History', subtitle: 'Review recent activity, conversations, and usage.' },
    planner: { title: 'Planner', subtitle: 'Plan your day with Stuard to unlock maximum productivity.' },
    tasks: { title: 'Tasks', subtitle: 'Track what matters and keep your day moving.' },
    proactive: { title: 'Proactive', subtitle: 'Discover suggestions and actions Stuard can take for you.' },
    memories: { title: 'Memories', subtitle: 'Browse notes, profile details, and remembered context.' },
    integrations: { title: 'Connected Apps', subtitle: 'Manage the tools and services connected to Stuard.' },
    settings: { title: 'Settings', subtitle: 'Tune themes, behavior, and personalization preferences.' },
    cloud: { title: 'Cloud Engine', subtitle: 'Monitor remote runtime, deployment, and compute status.' },
    media: { title: 'Media', subtitle: 'Browse imported files, generated media, and message attachments in one gallery.' },
    storage: { title: 'Storage', subtitle: 'Review files, uploads, and your local or cloud storage usage.' },
    vault: { title: 'Vault', subtitle: 'Keep protected data, secure items, and private resources organized.' },
  };

  const currentTabMeta = tabMeta[tab as keyof typeof tabMeta] ?? {
    title: tab.charAt(0).toUpperCase() + tab.slice(1),
    subtitle: 'Manage your Stuard workspace from a single dashboard.',
  };
  const showGlobalHeader = !['integrations', 'settings', 'proactive', 'cloud'].includes(tab);
  const showRefresh = showGlobalHeader && !['planner', 'memories', 'media'].includes(tab);


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
      <div className="dashboard-root w-screen h-screen overflow-hidden text-theme-fg font-sans selection:bg-primary selection:text-white">
        <div className="drag absolute top-0 left-0 right-0 h-10 z-50" />
        <div className="flex h-full gap-3 p-3 pt-5">
        {/* Sidebar */}
        <aside className="dashboard-sidebar w-[228px] shrink-0 flex flex-col px-2.5 py-3 relative z-20 transition-all duration-300">
          <div className="dashboard-sidebar-section dashboard-sidebar-brand px-5 py-4 select-none overflow-hidden mb-4">
            <div className="min-w-0 relative z-10">
              <div className="text-[18px] font-semibold text-theme-fg tracking-tight leading-none">Stuard Dashboard</div>
              <div className="mt-2 text-[11px] text-theme-muted font-medium">
                Beta V {appVersion}
              </div>
            </div>
          </div>

          <nav className="flex-1 min-h-0 px-1 pr-2 space-y-3 overflow-y-auto custom-scrollbar" data-onboarding="sidebar-nav">
            {sidebarSections.map((section) => (
              <div key={section.key} className="dashboard-sidebar-section p-2">
                {section.items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    icon={item.icon}
                    current={tab}
                    onClick={setTab}
                  />
                ))}
              </div>
            ))}
          </nav>

          <div className="p-1 pt-3 mt-auto">
            {userEmail ? (
              <div className="dashboard-sidebar-section flex items-center gap-3 p-3 cursor-default group">
                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-black text-primary border border-[color:var(--dashboard-panel-border)] shadow-inner">
                  {userEmail[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-theme-fg truncate">{userEmail.split('@')[0]}</div>
                  <button
                    onClick={signOut}
                    className="text-[10px] text-theme-muted hover:text-red-500 font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors mt-0.5"
                  >
                    <LogOut className="w-3 h-3" />
                    Secure Logout
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={signInViaBrowser}
                className="dashboard-button-primary w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold hover:opacity-95 transition-all"
              >
                Sign in to Stuard
              </button>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 relative">
          <div className="dashboard-main-surface flex h-full flex-col overflow-hidden relative transition-colors duration-200">
          <div className="drag h-10 w-full shrink-0 absolute top-0 left-0 right-0 z-50 pointer-events-none" />

          {/* Content Wrapper */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            {tab === 'memories' ? (
              <div className="flex-1 overflow-hidden animate-in fade-in duration-500">
                <MemoriesView />
              </div>
            ) : tab === 'cloud' ? (
              <div className="flex-1 min-h-0 overflow-hidden animate-in fade-in duration-500">
                <CloudEngineDashboard />
              </div>
            ) : (
              <main className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7">
                <div className="h-full">
                  {!userEmail && tab !== 'planner' ? (
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
                        {showGlobalHeader && (
                          <div className="flex items-start justify-between gap-4 mb-6 px-1">
                            <div className="min-w-0">
                              <h1 className="text-[30px] font-semibold text-theme-fg tracking-tight font-stuard leading-none">
                                {currentTabMeta.title}
                              </h1>
                              <p className="mt-2 text-[13px] text-theme-muted font-medium flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                                <span>{currentTabMeta.subtitle}</span>
                              </p>
                            </div>

                            {showRefresh && (
                              <button
                                onClick={handleRefresh}
                                disabled={loading}
                                className="dashboard-refresh-button flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-all group active:scale-95"
                                title="Sync Hub Data"
                              >
                                <RefreshCw className={clsx("w-3.5 h-3.5 transition-transform duration-500 group-hover:rotate-180", loading && "animate-spin")} />
                                <span>Refresh</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Tab Content Rendering */}
                        <div className="relative min-h-[calc(100%-80px)]">
                          {tab === 'overview' && userEmail && (
                            <OverviewView
                              creditsInfo={creditsInfo}
                              creditsFallback={creditsFallback}
                              profile={profile}
                              usageCount={usageCount}
                              usageCountLoading={usageCountLoading}
                              conversations={conversations}
                              conversationsLoading={conversationsLoading}
                              onNavigate={setTab}
                            />
                          )}

                          {tab === 'history' && userEmail && (
                            <MemoryLockGate label="History Locked">
                              <HistoryView
                                conversations={conversations}
                                conversationsLoading={conversationsLoading}
                                selectedConversation={selectedConversation}
                                setSelectedConversation={setSelectedConversation}
                                convMessages={convMessages}
                                convLoading={convLoading}
                                onDeleteConversation={handleDeleteConversation}
                              />
                            </MemoryLockGate>
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

                          {tab === 'proactive' && (
                            <ProactiveView />
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

                          {tab === 'media' && (
                            <MediaLibraryView />
                          )}

                          {tab === 'vault' && (
                            <VaultView />
                          )}

                          {tab === 'storage' && (
                            <StorageView />
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
                                setupPython={setupPython}
                                installPython={installPython}
                                runPython={runPython}
                                ollamaStatus={ollamaStatus}
                                ollamaChecking={ollamaChecking}
                                refreshOllamaStatus={refreshOllamaStatus}
                                startOllama={startOllama}
                                profiles={profiles}
                                profilesLoading={profilesLoading}
                                refreshProfiles={refreshProfiles}
                                setDefaultProfile={setDefaultProfile}
                                deleteProfile={deleteProfile}
                                telnyxPhones={telnyxPhones}
                                telnyxVerifying={telnyxVerifying}
                                telnyxRequestCode={telnyxRequestCode}
                                telnyxVerifyCode={telnyxVerifyCode}
                                telnyxDisconnect={telnyxDisconnect}
                                telnyxRemovePhone={telnyxRemovePhone}
                                getToken={() => session?.access_token || null}
                                whatsappPhone={whatsappPhone}
                                whatsappConnecting={whatsappConnecting}
                                whatsappLinking={whatsappLinking}
                                whatsappLinkCode={whatsappLinkCode}
                                whatsappBotNumber={whatsappBotNumber}
                                whatsappConnect={whatsappConnect}
                                whatsappInitiateLink={whatsappInitiateLink}
                                whatsappDisconnect={whatsappDisconnect}
                                browserUseStatus={browserUseStatus}
                                browserUseChecking={browserUseChecking}
                                browserUseSetupProgress={browserUseSetupProgress}
                                refreshBrowserUseStatus={refreshBrowserUseStatus}
                                setupBrowserUse={setupBrowserUse}
                                stopBrowserUse={stopBrowserUse}
                                uninstallBrowserUse={uninstallBrowserUse}
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
