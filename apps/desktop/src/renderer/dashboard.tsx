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
import { MemoryLockGate } from "./components/MemoryLockGate";
import { HeaderActionsContext, type HeaderAction } from "./components/HeaderActions";
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
} from "lucide-react";
import { clsx } from 'clsx';
import 'katex/dist/katex.min.css';
import { agentFetchJson, resolveAgentEndpoints } from './utils/agentEndpoints';
import { displayConversationTitle, isPlaceholderConversationTitle } from './utils/conversationTitle';
import { computeBillingCredits, isNonBillableUsageEvent, type ComputeBillingEventRow } from './components/BillingSettings.utils';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";
const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || "http://127.0.0.1:8082";

function isMainChatConversation(raw: any): boolean {
  const source = String(raw?.source || '').trim().toLowerCase();
  return !['workflow', 'skill', 'proactive', 'bot'].includes(source);
}

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

function SidebarDivider() {
  return <div className="dashboard-sidebar-divider" role="separator" />;
}

function SidebarItem({ id, label, icon: Icon, current, onClick }: { id: string; label: string; icon: any; current: string; onClick: (id: string) => void }) {
  const active = current === id;
  return (
    <button
      type="button"
      className={clsx(
        "dashboard-sidebar-item w-full flex items-center gap-2 px-2.5 py-2.5 h-10 text-[14px] font-medium leading-5",
        active && "is-active"
      )}
      onClick={() => onClick(id)}
    >
      <Icon
        className="w-5 h-5 shrink-0 text-current"
        strokeWidth={1.25}
      />
      <span className="flex-1 text-left truncate">
        {label}
      </span>
    </button>
  );
}

function DashboardApp() {
  // Read initial tab from URL query param
  const [tab, setTab] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const initialTab = params.get('tab');
      // Agents moved to Stuard Studio; the main process redirects 'bots'/'proactive'
      // deep links there, so the dashboard only handles its own remaining tabs.
      if (initialTab && ['overview', 'history', 'planner', 'tasks', 'memories', 'integrations', 'settings', 'cloud', 'media', 'storage'].includes(initialTab)) {
        return initialTab;
      }
    } catch { }
    return "overview";
  });
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
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
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('0.1.10');
  // Primary CTAs published by the active page into the single top bar.
  const [headerActions, setHeaderActions] = useState<HeaderAction[]>([]);
  const billingRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preferences
  const { tone, setTone, customTone, setCustomTone, setOnboardingComplete, themeMode, setThemeMode, themeDarkShade, setThemeDarkShade, themeLightShade, setThemeLightShade, themeText, setThemeText, persona, setPersona, translucentMode, setTranslucentMode, wakewordEnabled, setWakewordEnabled, browserEnabled, setBrowserEnabled, screenCaptureInvisible, setScreenCaptureInvisible, chatMode, setChatMode, chatModels, setChatModels } = usePreferences();
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
    integrationLibrary,
    intCategories,
    filteredIntegrations,
    connectedCount,
    handleConnect,
    handleDisconnect,
    handleLearnMore,
    refreshPythonStatus,
    refreshPythonPackages,
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
    updateBrowserUse,
    cliAgentStatus,
    cliAgentChecking,
    refreshCliAgentStatus,
    setupPython,
    installPython,
    runPython,
    updateMediapipe,
    refreshDataAnalysisStatus,
    setupDataAnalysis,
    uninstallDataAnalysis,
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
    refreshWhatsAppStatus,
  } = useIntegrationsState({
    session,
    AGENT_HTTP,
    CLOUD_AI_HTTP,
    statusChecksEnabled: tab === 'integrations',
  });
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
      return 30; // free: 30 credits, just under $1 (≈33 credits = $1) — mirrors cloud-ai (offline fallback only; /v1/credits is authoritative)
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
      const tab = data?.tab;
      if (
        tab &&
        ['overview', 'history', 'planner', 'tasks', 'memories', 'integrations', 'settings', 'cloud', 'media', 'storage'].includes(tab)
      ) {
        setTab(tab);
      }
    });
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    let unsub: any;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setSessionLoaded(true);
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
      setCreditsLoading(false);
      return;
    }
    setCreditsLoading(true);
    try {
      const userId = session.user.id;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
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
      // Credits: prefer the canonical server summary (GET /v1/credits) so the Plan
      // card, Billing, and the header all show identical numbers. The server applies
      // the free-plan monthly-limit fallback when there's no grant row — the direct
      // Supabase math below does not, which is what collapsed free accounts to "0 / 1".
      let creditsFromServer = false;
      try {
        const resp = await fetch(`${CLOUD_AI_HTTP}/v1/credits`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const j: any = resp.ok ? await resp.json().catch(() => null) : null;
        if (j && j.ok) {
          const unlimited = !!j.unlimited;
          setCreditsInfo({
            ok: true,
            plan: String(j.plan || 'Free'),
            limit: unlimited ? 0 : Math.max(0, Math.ceil(Number(j.limit) || 0)),
            used: Math.max(0, Math.ceil(Number(j.used) || 0)),
            remaining: unlimited ? 0 : Math.max(0, Math.ceil(Number(j.remaining) || 0)),
            unlimited,
            creditsPerUsd: Number(j.creditsPerUsd) || undefined,
          });
          creditsFromServer = true;
        }
      } catch { /* fall through to the direct Supabase computation below */ }

      // Fallback when the endpoint is unreachable: compute from Supabase directly
      // (same query path BillingSettings uses).
      if (!creditsFromServer) try {
        const [{ data: profileRow }, { data: rawGrants }] = await Promise.all([
          supabase
            .from('profiles')
            .select('plan, current_period_start, current_period_end')
            .eq('id', userId)
            .maybeSingle(),
          supabase
            .from('credit_grants')
            .select('source_type, total_credits, remaining_credits, expires_at')
            .eq('user_id', userId),
        ]);

        const now = Date.now();
        let includedCredits = 0;
        let includedRemaining = 0;
        let addonCredits = 0;
        let addonRemaining = 0;
        for (const g of (rawGrants as any[]) || []) {
          if (g.expires_at && Date.parse(g.expires_at) <= now) continue;
          const tc = Math.max(0, Number(g.total_credits) || 0);
          const tr = Math.max(0, Number(g.remaining_credits) || 0);
          if (String(g.source_type || '').toLowerCase() === 'subscription_cycle') {
            includedCredits += tc;
            includedRemaining += tr;
          } else {
            addonCredits += tc;
            addonRemaining += tr;
          }
        }

        const periodStart = (profileRow as any)?.current_period_start
          ? new Date((profileRow as any).current_period_start)
          : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        let used = 0;
        const periodStartIso = periodStart.toISOString();
        try {
          const { data: usageTotal, error: usageTotalError } = await (supabase as any).rpc('get_usage_credit_total', {
            p_user_id: userId,
            p_since: periodStartIso,
          });
          if (!usageTotalError && usageTotal != null) {
            used = Number(usageTotal) || 0;
          } else {
            throw usageTotalError || new Error('usage_total_unavailable');
          }
        } catch {
          const { data: periodEvents } = await supabase
            .from('usage_events')
            .select('model, credit_cost, raw')
            .eq('user_id', userId)
            .gte('created_at', periodStartIso);
          for (const e of (periodEvents as any[]) || []) {
            if (isNonBillableUsageEvent({ model: (e as any).model, raw: (e as any).raw })) continue;
            used += Number((e as any).credit_cost) || 0;
          }
        }

        const { data: computeEvents } = await supabase
          .from('compute_billing_events')
          .select('credits_deducted')
          .eq('user_id', userId)
          .gte('billing_hour', periodStartIso);
        for (const row of (computeEvents as ComputeBillingEventRow[]) || []) {
          used += computeBillingCredits(row);
        }

        const totalLimit = includedCredits + addonCredits;
        const grantRemaining = includedRemaining + addonRemaining;
        setCreditsInfo({
          ok: true,
          plan: String((profileRow as any)?.plan || 'Free'),
          limit: Math.ceil(totalLimit),
          used: Math.ceil(used),
          // Match BillingSettings: remaining is grant balance, not limit-minus-usage
          remaining: Math.ceil(grantRemaining),
          unlimited: false,
        });
      } catch { }
    } catch { }
    finally {
      setCreditsLoading(false);
    }
  }, [session]);

  const loadConversations = useCallback(async (requestedLimit = 20, force = false) => {
    if (!force && (conversationsLoading || conversationsLoadedLimit >= requestedLimit)) return;
    setConversationsLoading(true);
    try {
      // Fetch desktop (local agent) and VM (cloud-ai /v1/memory) conversations
      // in parallel so the History view shows BOTH origins. VM conversations
      // carry origin='cloud_vm' while desktop-originated ones are origin='desktop'.
      const token = session?.access_token || null;
      const [localJson, cloudJson, supaData] = await Promise.all([
        agentFetchJson(
          resolveAgentEndpoints(),
          `/v1/memory/conversations?limit=${requestedLimit}&source=stuard`,
          { accessToken: token },
        ).catch(() => null),
        token
          ? fetch(`${CLOUD_AI_HTTP}/v1/memory/conversations?limit=${requestedLimit}&status=active`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then(r => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        token
          ? supabase
              .from('conversations')
              .select('id, title, created_at, updated_at, message_count, source')
              .not('source', 'in', '("workflow","skill","proactive","bot")')
              .order('updated_at', { ascending: false })
              .limit(requestedLimit)
              .then(r => r.data ?? null, () => null)
          : Promise.resolve(null),
      ]);

      const byId = new Map<string, any>();
      const ingest = (list: any[]) => {
        for (const raw of list) {
          if (!raw) continue;
          if (!isMainChatConversation(raw)) continue;
          const id = raw.id || raw.conversation_id;
          if (!id) continue;
          // Origin is decided by the conversation's authoritative `source`, never by
          // which endpoint returned the row. Desktop conversations are mirrored to
          // the cloud and come back through the cloud-ai endpoint, so keying off the
          // endpoint mislabels them as VM. The Cloud Engine agent persists its chats
          // with source==='agent'; desktop chats use 'stuard'. Anything not positively
          // identified as a VM conversation is treated as Desktop.
          const src = String(raw.source || '').trim().toLowerCase();
          const isVmSource = src === 'agent' || src === 'vm';
          const origin: 'desktop' | 'cloud_vm' =
            raw.origin === 'cloud_vm' || raw.origin === 'desktop'
              ? raw.origin
              : isVmSource
                ? 'cloud_vm'
                : 'desktop';
          const incoming = {
            ...raw,
            id,
            origin,
            created_at: raw.created_at || raw.updated_at || raw.updatedAt,
            updated_at: raw.updated_at || raw.updatedAt || raw.created_at,
            title: displayConversationTitle(raw.title),
          };
          const existing = byId.get(id);
          if (!existing) {
            byId.set(id, incoming);
            continue;
          }
          const existingUpdated = new Date(existing.updated_at || existing.created_at || 0).getTime();
          const incomingUpdated = new Date(incoming.updated_at || incoming.created_at || 0).getTime();
          byId.set(id, {
            ...existing,
            ...incoming,
            title: !isPlaceholderConversationTitle(incoming.title)
              ? incoming.title
              : displayConversationTitle(existing.title),
            origin: existing.origin === 'cloud_vm' ? 'cloud_vm' : incoming.origin,
            updated_at: incomingUpdated > existingUpdated ? incoming.updated_at : existing.updated_at,
            created_at: existing.created_at || incoming.created_at,
          });
        }
      };

      if (localJson?.ok && Array.isArray(localJson.conversations)) {
        ingest(localJson.conversations);
      }
      if (cloudJson?.ok && Array.isArray(cloudJson.conversations)) {
        ingest(cloudJson.conversations);
      }
      if (Array.isArray(supaData)) {
        ingest(supaData);
      }

      if (byId.size > 0 || localJson?.ok || cloudJson?.ok || supaData) {
        const convs = Array.from(byId.values())
          .sort((a: any, b: any) =>
            new Date(b.updated_at || b.created_at || 0).getTime() -
            new Date(a.updated_at || a.created_at || 0).getTime(),
          )
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

  const refreshBillingOverview = useCallback(() => {
    loadProfileAndCredits().catch(() => { });
    loadUsageCount(true).catch(() => { });
  }, [loadProfileAndCredits, loadUsageCount]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;

    const scheduleRefresh = () => {
      if (billingRefreshTimerRef.current) clearTimeout(billingRefreshTimerRef.current);
      billingRefreshTimerRef.current = setTimeout(() => {
        refreshBillingOverview();
      }, 400);
    };

    const channel = supabase
      .channel(`dashboard-billing:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'usage_events',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'credit_grants',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'credit_grants',
        filter: `user_id=eq.${userId}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      if (billingRefreshTimerRef.current) clearTimeout(billingRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [refreshBillingOverview, session?.user?.id]);

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

  // Refresh conversations whenever an incoming agent-data archive (pushed by
  // the VM) has been applied locally — keeps the history panel seamlessly
  // up-to-date without the user manually refreshing.
  useEffect(() => {
    const api = window.desktopAPI as any;
    if (!api?.onAgentDataSynced) return;
    const unsubscribe = api.onAgentDataSynced(() => {
      try {
        const currentLimit = Math.max(conversationsLoadedLimit || 0, tab === 'history' ? 20 : 10);
        loadConversations(currentLimit, true).catch(() => { });
      } catch { /* noop */ }
    });
    return () => { try { unsubscribe && unsubscribe(); } catch { /* noop */ } };
  }, [tab, conversationsLoadedLimit, loadConversations]);

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
        if (json.ok && Array.isArray(json.messages) && json.messages.length > 0) {
          setConvMessages(repairConversationMessageRows(json.messages as any[]));
          return;
        }
      } catch { }
      // Fallback to cloud-ai memory API (covers VM-only conversations)
      try {
        const token = session?.access_token || null;
        if (token) {
          const resp = await fetch(
            `${CLOUD_AI_HTTP}/v1/memory/conversations/${encodeURIComponent(id)}/messages?limit=500`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const data = await resp.json().catch(() => null) as any;
          if (data?.ok && Array.isArray(data.messages) && data.messages.length > 0) {
            setConvMessages(repairConversationMessageRows(data.messages as any[]));
            return;
          }
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
      key: 'tracking',
      label: 'Dashboard & Tracking',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'history', label: 'History', icon: Clock },
      ],
    },
    {
      key: 'productivity',
      label: 'Productivity',
      items: [
        { id: 'planner', label: 'Planner', icon: Calendar },
        { id: 'tasks', label: 'Tasks', icon: ListTodo },
      ],
    },
    {
      key: 'files',
      label: 'Files & Content',
      items: [
        { id: 'memories', label: 'Memories', icon: Archive },
        { id: 'media', label: 'Media', icon: ImageIcon },
        { id: 'storage', label: 'Storage', icon: HardDrive },
      ],
    },
    {
      key: 'system',
      label: 'System & Infrastructure',
      items: [
        { id: 'cloud', label: 'Cloud Engine', icon: Cloud },
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
    memories: { title: 'Memories', subtitle: 'Browse collections, context, and project knowledge.' },
    integrations: { title: 'Connected Apps', subtitle: 'Manage the tools and services connected to Stuard.' },
    settings: { title: 'Settings', subtitle: 'Tune themes, behavior, and personalization preferences.' },
    cloud: { title: 'Cloud Engine', subtitle: 'Monitor remote runtime, deployment, and compute status.' },
    media: { title: 'Media', subtitle: 'Browse imported files, generated media, and message attachments in one gallery.' },
    storage: { title: 'Storage', subtitle: 'Review files, uploads, and your local or cloud storage usage.' },
  };

  const currentTabMeta = tabMeta[tab as keyof typeof tabMeta] ?? {
    title: tab.charAt(0).toUpperCase() + tab.slice(1),
    subtitle: 'Manage your Stuard workspace from a single dashboard.',
  };
  const showGlobalHeader = !['integrations', 'settings', 'bots', 'cloud'].includes(tab);
  const showRefresh = showGlobalHeader && !['planner', 'memories', 'media'].includes(tab);

  // Unified top-bar context: page icon + live account status badges.
  const CurrentTabIcon = sidebarSections.flatMap((s) => s.items).find((i) => i.id === tab)?.icon ?? LayoutDashboard;
  const planRaw = String(creditsInfo?.plan || creditsFallback?.plan || 'Free');
  const planLabel = planRaw.charAt(0).toUpperCase() + planRaw.slice(1);
  const creditsRemaining = creditsInfo?.remaining ?? creditsFallback?.remaining;

  // The single top bar shows the page's registered CTAs; if a page registers
  // none, fall back to the global Refresh where it makes sense.
  const effectiveHeaderActions: HeaderAction[] = headerActions.length > 0
    ? headerActions
    : (showRefresh && userEmail
        ? [{ id: 'refresh', label: 'Refresh', icon: RefreshCw, onClick: handleRefresh, loading, variant: 'secondary' as const }]
        : []);


  // Apply theme to body
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }

    root.style.removeProperty('--custom-gradient-start');
    root.style.removeProperty('--custom-gradient-end');
    root.style.removeProperty('--custom-text-color');
  }, [themeMode]);

  return (
    <HeaderActionsContext.Provider value={{ setActions: setHeaderActions }}>
    <ErrorBoundary>
      <div className="dashboard-root w-screen h-screen overflow-hidden text-theme-fg font-sans">
        <div className="drag absolute top-0 left-0 right-0 h-10 z-50" />
        <div className="flex h-full gap-3 p-3 pt-5">
        {/* Sidebar */}
        <aside className="dashboard-sidebar shrink-0 flex flex-col gap-7 relative z-20">
          <div className="dashboard-sidebar-brand shrink-0 select-none">
            <div className="dashboard-sidebar-brand-glow" aria-hidden="true" />
            <div className="min-w-0 relative z-[1] flex flex-col gap-2">
              <div className="text-[18px] font-medium text-theme-fg leading-6 tracking-tight">
                Stuard Dashboard
              </div>
              <div className="text-[12px] font-medium text-theme-muted leading-5">
                Beta V {appVersion}
              </div>
            </div>
          </div>

          <div className="dashboard-sidebar-panel flex flex-1 min-h-0 flex-col">
            <nav
              className="dashboard-sidebar-nav flex-1 min-h-0 overflow-y-auto custom-scrollbar"
              data-onboarding="sidebar-nav"
            >
              {sidebarSections.map((section, sectionIndex) => (
                <React.Fragment key={section.key}>
                  {sectionIndex > 0 && <SidebarDivider />}
                  <div className="dashboard-sidebar-nav-group" role="group" aria-label={section.label}>
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
                </React.Fragment>
              ))}
            </nav>

            <div className="dashboard-sidebar-footer shrink-0">
              {userEmail ? (
                <div className="dashboard-sidebar-account flex items-center gap-3 px-3 py-2.5">
                  <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {userEmail[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-theme-fg truncate leading-5">
                      {userEmail.split('@')[0]}
                    </div>
                    <button
                      type="button"
                      onClick={signOut}
                      className="text-[11px] text-theme-muted hover:text-red-500 font-medium flex items-center gap-1.5 transition-colors mt-0.5"
                    >
                      <LogOut className="w-3 h-3" />
                      Sign out
                    </button>
                  </div>
                </div>
              ) : sessionLoaded ? (
                <button
                  type="button"
                  onClick={signInViaBrowser}
                  className="dashboard-button-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold hover:opacity-95 transition-all"
                >
                  Sign in to Stuard
                </button>
              ) : (
                <div className="dashboard-sidebar-account flex items-center gap-3 px-3 py-2.5 opacity-60">
                  <div className="h-9 w-9 rounded-xl bg-theme-card/40 border border-theme animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="h-3 w-20 rounded bg-theme-card/40 animate-pulse" />
                    <div className="h-2.5 w-14 rounded bg-theme-card/30 mt-1.5 animate-pulse" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 relative">
          <div className="dashboard-main-surface flex h-full flex-col overflow-hidden relative transition-colors duration-200">
          <div className="drag h-10 w-full shrink-0 absolute top-0 left-0 right-0 z-50 pointer-events-none" />

          {/* Unified top bar — the single chrome that holds page context, status & every CTA */}
          <header className="dashboard-topbar shrink-0">
            {/* Left: brand mark → breadcrumb → status pill */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-theme-hover/40 text-theme-fg shrink-0">
                <CurrentTabIcon className="w-[15px] h-[15px]" />
              </div>
              <span className="text-[15px] font-semibold text-theme-fg tracking-tight leading-none truncate">
                {currentTabMeta.title}
              </span>
              {userEmail && (
                <span className="dashboard-badge ml-1 shrink-0">{planLabel}</span>
              )}
            </div>

            {/* Right: live status + every primary CTA (white pills) */}
            <div className="flex items-center gap-2 shrink-0">
              {userEmail && typeof creditsRemaining === 'number' && (
                <span className="dashboard-badge hidden lg:inline-flex">
                  {creditsRemaining.toLocaleString()} credits
                </span>
              )}
              {effectiveHeaderActions.map((action) => {
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={action.onClick}
                    disabled={action.disabled || action.loading}
                    className={clsx(
                      "flex items-center gap-2 px-3.5 py-2 text-[13px] transition-all group active:scale-95 disabled:active:scale-100",
                      action.variant === 'primary'
                        ? "dashboard-button-primary"
                        : "dashboard-button-secondary",
                    )}
                    title={action.title || action.label}
                  >
                    {ActionIcon && (
                      <ActionIcon className={clsx(
                        "w-3.5 h-3.5 transition-transform duration-500",
                        action.id === 'refresh' && "group-hover:rotate-180",
                        action.loading && "animate-spin",
                      )} />
                    )}
                    {action.label && <span className="hidden sm:inline">{action.label}</span>}
                  </button>
                );
              })}
            </div>
          </header>

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
              <main className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-6">
                <div className="h-full">
                  {!sessionLoaded && tab !== 'planner' ? (
                    <div className="flex flex-col items-center justify-center h-[70vh]" aria-hidden="true" />
                  ) : !userEmail && tab !== 'planner' ? (
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
                        {/* Tab Content Rendering */}
                        <div className="relative min-h-[calc(100%-80px)]">
                          {tab === 'overview' && userEmail && (
                            <OverviewView
                              creditsInfo={creditsInfo}
                              creditsFallback={creditsFallback}
                              creditsLoading={creditsLoading}
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
                              chatModels={chatModels}
                              setChatModels={setChatModels}
                            />
                          )}

                          {tab === 'media' && (
                            <MediaLibraryView />
                          )}

                          {tab === 'storage' && (
                            <StorageView />
                          )}

                          {tab === 'integrations' && userEmail && (
                            <>
                              <IntegrationsView
                                connectedCount={connectedCount}
                                integrationLibrary={integrationLibrary}
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
                                pyPackagesList={pyPackagesList}
                                pyPackagesLoading={pyPackagesLoading}
                                pyInstallMessage={pyInstallMessage}
                                pyRunCode={pyRunCode}
                                setPyRunCode={setPyRunCode}
                                pyInstalling={pyInstalling}
                                ffInstalling={ffInstalling}
                                mpStatus={mpStatus}
                                mpInstalling={mpInstalling}
                                pyRunning={pyRunning}
                                pyRunResult={pyRunResult}
                                refreshPythonStatus={refreshPythonStatus}
                                refreshPythonPackages={refreshPythonPackages}
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
                                refreshTelnyxStatus={refreshTelnyxStatus}
                                getToken={() => session?.access_token || null}
                                whatsappPhone={whatsappPhone}
                                whatsappConnecting={whatsappConnecting}
                                whatsappLinking={whatsappLinking}
                                whatsappLinkCode={whatsappLinkCode}
                                whatsappBotNumber={whatsappBotNumber}
                                whatsappConnect={whatsappConnect}
                                whatsappInitiateLink={whatsappInitiateLink}
                                whatsappDisconnect={whatsappDisconnect}
                                refreshWhatsAppStatus={refreshWhatsAppStatus}
                                browserUseStatus={browserUseStatus}
                                browserUseChecking={browserUseChecking}
                                browserUseSetupProgress={browserUseSetupProgress}
                                refreshBrowserUseStatus={refreshBrowserUseStatus}
                                setupBrowserUse={setupBrowserUse}
                                stopBrowserUse={stopBrowserUse}
                                uninstallBrowserUse={uninstallBrowserUse}
                                browserUseLocalStatus={browserUseLocalStatus}
                                browserUseUpdateInfo={browserUseUpdateInfo}
                                browserUseUpdating={browserUseUpdating}
                                updateBrowserUse={updateBrowserUse}
                                cliAgentStatus={cliAgentStatus}
                                cliAgentChecking={cliAgentChecking}
                                refreshCliAgentStatus={refreshCliAgentStatus}
                                mpLocalStatus={mpLocalStatus}
                                mpUpdateInfo={mpUpdateInfo}
                                mpUpdating={mpUpdating}
                                updateMediapipe={updateMediapipe}
                                daStatus={daStatus}
                                daInstalling={daInstalling}
                                daUninstalling={daUninstalling}
                                refreshDataAnalysisStatus={refreshDataAnalysisStatus}
                                setupDataAnalysis={setupDataAnalysis}
                                uninstallDataAnalysis={uninstallDataAnalysis}
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
    </HeaderActionsContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
