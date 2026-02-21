'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, BarChart3, Users, Rocket, Server, Shield, LogOut,
  GitBranch, Clock, CheckCircle, AlertCircle, RefreshCw, Lock, Bug
} from 'lucide-react';
import {
  StatusData, AnalyticsData, UserEntry, Activity as ActivityItem,
  SyncSystemData, ServerStatusData, BetaUser, WaitlistEntry, Deployment,
  FeedbackEntry, FeedbackComment, FeedbackStats,
  fetchAnalytics, fetchUsers, fetchRecentActivity, fetchServerStatus,
  fetchSyncSystems as apiFetchSyncSystems, fetchDatabaseStats, fetchBetaUsers as apiFetchBetaUsers,
  fetchWaitlist as apiFetchWaitlist, upsertBetaUser, deleteBetaUser as apiDeleteBeta,
  promoteWaitlistUser, fetchDeployments, recordDeployment, formatTimeAgo,
  fetchFeedback, fetchFeedbackItem, createFeedback, updateFeedback, addFeedbackComment
} from './lib/api';

import OverviewTab from './components/OverviewTab';
import AnalyticsTab from './components/AnalyticsTab';
import UsersTab from './components/UsersTab';
import DeployTab from './components/DeployTab';
import InfraTab from './components/InfraTab';
import AccessTab from './components/AccessTab';
import FeedbackTab from './components/FeedbackTab';

type Tab = 'overview' | 'analytics' | 'users' | 'deploy' | 'infra' | 'access' | 'feedback';

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'deploy', label: 'Deployments', icon: Rocket },
  { id: 'feedback', label: 'Feedback & Bugs', icon: Bug },
  { id: 'infra', label: 'Infrastructure', icon: Server },
  { id: 'access', label: 'Access Control', icon: Shield },
];

// ─── Auth: auto-bypass if NEXT_PUBLIC_OPS_ACCESS_TOKEN is set in .env.local ──
const ENV_TOKEN = process.env.NEXT_PUBLIC_OPS_ACCESS_TOKEN || '';

function LoginGate({ children }: { children: React.ReactNode }) {
  const storedToken = typeof window !== 'undefined' ? localStorage.getItem('stuard_access_token') : null;
  const [token, setToken] = useState<string | null>(ENV_TOKEN || storedToken);
  const [input, setInput] = useState('');

  // If env token is set, skip login entirely
  if (ENV_TOKEN) return <>{children}</>;

  const handleLogin = () => {
    const t = input.trim();
    if (!t) return;
    localStorage.setItem('stuard_access_token', t);
    setToken(t);
  };

  if (!token) return (
    <div className="flex items-center justify-center h-screen bg-[#F8FAFC]">
      <div className="card p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Stuard Ops</h1>
            <p className="text-xs text-gray-500">Enter your access token</p>
          </div>
        </div>
        <input
          type="password"
          className="input-field mb-3"
          placeholder="Paste access token..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
          autoFocus
        />
        <button onClick={handleLogin} disabled={!input.trim()} className="btn-primary w-full py-2.5 disabled:opacity-40">
          Sign In
        </button>
      </div>
    </div>
  );

  return <>{children}</>;
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ activeTab, onTabChange, status, collapsed, onToggle }: {
  activeTab: Tab; onTabChange: (t: Tab) => void;
  status: StatusData | null; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <aside className={`h-screen flex flex-col bg-[#0F172A] text-white transition-all duration-200 flex-shrink-0 ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">S</span>
        </div>
        {!collapsed && <span className="font-semibold text-sm tracking-tight">Stuard Ops</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? 'bg-white/10 text-white font-medium' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
              title={collapsed ? item.label : undefined}>
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Git status */}
      {status && !collapsed && (
        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <GitBranch className="w-3.5 h-3.5" />
            <span className="font-mono truncate">{status.currentBranch}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500">
            <div className={`w-1.5 h-1.5 rounded-full ${status.isClean ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {status.isClean ? 'Clean' : `${(status.modified?.length || 0) + (status.not_added?.length || 0)} changes`}
          </div>
        </div>
      )}

      {/* Collapse toggle + Logout */}
      <div className="px-2 py-2 border-t border-white/10 flex items-center gap-1">
        <button onClick={onToggle} className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors" title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <BarChart3 className="w-4 h-4" /> : <LayoutDashboard className="w-4 h-4" />}
        </button>
        {!collapsed && (
          <button onClick={() => { localStorage.removeItem('stuard_access_token'); window.location.reload(); }}
            className="ml-auto p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function OpsConsole() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Data states
  const [status, setStatus] = useState<StatusData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [usersList, setUsersList] = useState<UserEntry[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersQuery, setUsersQuery] = useState('');
  const [usersPage, setUsersPage] = useState(0);
  const [planBreakdown, setPlanBreakdown] = useState<Record<string, number>>({});
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [syncSystems, setSyncSystems] = useState<SyncSystemData | null>(null);
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatusData | null>(null);
  const [betaUsers, setBetaUsers] = useState<BetaUser[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [waitlistTotal, setWaitlistTotal] = useState(0);
  const [deploymentsList, setDeploymentsList] = useState<Deployment[]>([]);
  const [latestByChannel, setLatestByChannel] = useState<Record<string, Deployment>>({});

  // Feedback state
  const [feedbackItems, setFeedbackItems] = useState<FeedbackEntry[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilterType, setFeedbackFilterType] = useState('');
  const [feedbackFilterStatus, setFeedbackFilterStatus] = useState('');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackEntry | null>(null);
  const [selectedFeedbackComments, setSelectedFeedbackComments] = useState<FeedbackComment[]>([]);

  const PAGE_SIZE = 50;

  // ─── Fetch functions ─────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, []);

  const loadAnalytics = useCallback(async (days?: number) => {
    const d = days ?? analyticsDays;
    const data = await fetchAnalytics(d);
    if (data) setAnalytics(data);
  }, [analyticsDays]);

  const loadUsers = useCallback(async (page?: number, q?: string) => {
    const p = page ?? usersPage;
    const query = q ?? usersQuery;
    const data = await fetchUsers(PAGE_SIZE, p * PAGE_SIZE, query);
    if (data) {
      setUsersList(data.users || []);
      setUsersTotal(data.total || 0);
      setPlanBreakdown(data.planBreakdown || {});
    }
  }, [usersPage, usersQuery]);

  const loadActivities = useCallback(async () => {
    const data = await fetchRecentActivity(30);
    if (data) setActivities(data.activities || []);
  }, []);

  const loadSyncSystems = useCallback(async () => {
    const data = await apiFetchSyncSystems();
    if (data) setSyncSystems(data.systems || null);
  }, []);

  const loadDbStats = useCallback(async () => {
    const data = await fetchDatabaseStats();
    if (data) setDbStats(data.tables || null);
  }, []);

  const loadServerStatus = useCallback(async () => {
    const data = await fetchServerStatus();
    if (data) setServerStatus(data);
  }, []);

  const loadBetaUsers = useCallback(async () => {
    const data = await apiFetchBetaUsers();
    if (data) setBetaUsers(data.users || []);
  }, []);

  const loadWaitlist = useCallback(async () => {
    const data = await apiFetchWaitlist();
    if (data) {
      setWaitlistEntries(data.entries || []);
      setWaitlistTotal(data.total || 0);
    }
  }, []);

  const loadDeployments = useCallback(async () => {
    const data = await fetchDeployments(undefined, 50);
    if (data) {
      setDeploymentsList(data.deployments || []);
      setLatestByChannel(data.latestByChannel || {});
    }
  }, []);

  const loadFeedbackData = useCallback(async (type?: string, status?: string) => {
    setFeedbackLoading(true);
    const t = type ?? feedbackFilterType;
    const s = status ?? feedbackFilterStatus;
    const data = await fetchFeedback({ type: t || undefined, status: s || undefined, limit: 100 });
    if (data) {
      setFeedbackItems(data.items || []);
      setFeedbackTotal(data.total || 0);
      setFeedbackStats(data.stats || null);
    }
    setFeedbackLoading(false);
  }, [feedbackFilterType, feedbackFilterStatus]);

  // ─── Initial load + refresh intervals ────────────────────────────────────
  useEffect(() => {
    loadStatus();
    loadAnalytics();
    loadActivities();
    loadSyncSystems();
    loadDbStats();
    loadServerStatus();
    loadBetaUsers();
    loadWaitlist();
    loadUsers();
    loadDeployments();
    loadFeedbackData();

    const fast = setInterval(loadStatus, 8000);
    const slow = setInterval(() => {
      loadAnalytics(); loadActivities(); loadSyncSystems(); loadDbStats();
      loadServerStatus(); loadBetaUsers(); loadWaitlist(); loadDeployments(); loadFeedbackData();
    }, 60000);

    return () => { clearInterval(fast); clearInterval(slow); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Deploy actions (git operations) ──────────────────────────────────────
  const doAction = async (type: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    if (type === 'commit' && !payload.message) {
      setMessage('Error: Commit message is required');
      return false;
    }
    setLoading(true);
    setMessage(type === 'run-checks' ? 'Running checks...' : 'Processing...');
    try {
      const res = await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload }) });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || 'Done');
        await loadStatus();
        // Record deployment to Supabase for ship actions
        if (type.startsWith('ship-to-')) {
          const channel = type === 'ship-to-beta' ? 'beta' : type === 'ship-to-staging' ? 'staging' : 'production';
          try {
            await recordDeployment({
              channel,
              version: (payload.version as string) || status?.versions?.cloud || undefined,
              git_branch: status?.currentBranch || undefined,
              targets: payload.targets as Record<string, boolean> | undefined,
            });
            await loadDeployments();
          } catch {}
        }
        return true;
      }
      setMessage(`Error: ${data.error || 'Failed'}`);
      return false;
    } catch {
      setMessage('Error: Network request failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // ─── Access control actions ───────────────────────────────────────────────
  const handleUpsertBeta = async (email: string, accessLevel: string, notes: string) => {
    setLoading(true);
    const result = await upsertBetaUser(email, accessLevel, notes);
    if (result) { setMessage('Beta user updated'); await loadBetaUsers(); await loadDbStats(); }
    else setMessage('Error: Failed to update beta user');
    setLoading(false);
  };

  const handleDeleteBeta = async (email: string) => {
    setLoading(true);
    const result = await apiDeleteBeta(email);
    if (result) { setMessage('Beta user removed'); await loadBetaUsers(); await loadDbStats(); }
    else setMessage('Error: Failed to remove beta user');
    setLoading(false);
  };

  const handlePromoteWaitlist = async (email: string, accessLevel: string) => {
    setLoading(true);
    const result = await promoteWaitlistUser(email, accessLevel);
    if (result) { setMessage(`Promoted to ${accessLevel}`); await loadWaitlist(); await loadBetaUsers(); await loadDbStats(); }
    else setMessage('Error: Failed to promote user');
    setLoading(false);
  };

  // ─── Feedback handlers ─────────────────────────────────────────────────
  const handleFeedbackFilterType = (t: string) => { setFeedbackFilterType(t); loadFeedbackData(t, feedbackFilterStatus); };
  const handleFeedbackFilterStatus = (s: string) => { setFeedbackFilterStatus(s); loadFeedbackData(feedbackFilterType, s); };
  const handleFeedbackSearch = () => { loadFeedbackData(); };

  const handleSelectFeedback = async (id: string) => {
    const data = await fetchFeedbackItem(id);
    if (data) {
      setSelectedFeedback(data.item);
      setSelectedFeedbackComments(data.comments || []);
    }
  };

  const handleUpdateFeedbackStatus = async (id: string, status: string) => {
    const result = await updateFeedback(id, { status });
    if (result) { setMessage(`Status → ${status}`); await loadFeedbackData(); if (selectedFeedback?.id === id) handleSelectFeedback(id); }
    else setMessage('Error: Failed to update status');
  };

  const handleUpdateFeedbackPriority = async (id: string, priority: string) => {
    const result = await updateFeedback(id, { priority });
    if (result) { await loadFeedbackData(); if (selectedFeedback?.id === id) handleSelectFeedback(id); }
    else setMessage('Error: Failed to update priority');
  };

  const handleAddFeedbackComment = async (feedbackId: string, content: string) => {
    const result = await addFeedbackComment(feedbackId, content);
    if (result) handleSelectFeedback(feedbackId);
    else setMessage('Error: Failed to add comment');
  };

  const handleCreateFeedback = async (fb: { type: 'bug' | 'feature'; title: string; description?: string; priority?: string }) => {
    setLoading(true);
    const result = await createFeedback(fb);
    if (result) { setMessage('Feedback created'); await loadFeedbackData(); }
    else setMessage('Error: Failed to create feedback');
    setLoading(false);
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleDaysChange = (d: number) => { setAnalyticsDays(d); loadAnalytics(d); };
  const handleUsersSearch = () => { setUsersPage(0); loadUsers(0, usersQuery); };
  const handleUsersPageChange = (p: number) => { setUsersPage(p); loadUsers(p, usersQuery); };

  // ─── Loading state ────────────────────────────────────────────────────────
  if (!status) return (
    <div className="flex flex-col items-center justify-center h-screen gap-3">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <div className="text-sm text-gray-400">Loading dashboard...</div>
    </div>
  );

  return (
    <LoginGate>
      <div className="flex h-screen overflow-hidden">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} status={status} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />

        <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
          {/* Top bar */}
          <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-gray-200/80 px-6 py-3 flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-gray-900">
                {NAV_ITEMS.find(n => n.id === activeTab)?.label || 'Dashboard'}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {/* Status indicators */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                <span>System Online</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>{formatTimeAgo(status.lastDeployTime)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-md">
                <GitBranch className="w-3 h-3 text-blue-600" />
                <span className="font-mono text-xs text-gray-700">{status.currentBranch}</span>
                <div className={`w-1.5 h-1.5 rounded-full ml-1 ${status.isClean ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </div>
              <button onClick={() => { loadStatus(); loadAnalytics(); loadSyncSystems(); loadDbStats(); loadServerStatus(); loadFeedbackData(); }}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Refresh All">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Message bar */}
          {message && (
            <div className={`mx-6 mt-4 p-3 rounded-lg border flex items-center gap-2 text-sm animate-fade-in ${
              message.startsWith('Error') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
            }`}>
              {message.startsWith('Error') ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              <span className="font-medium text-xs">{message}</span>
              <button onClick={() => setMessage('')} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
            </div>
          )}

          {/* Content */}
          <div className="p-6">
            {activeTab === 'overview' && (
              <OverviewTab analytics={analytics} activities={activities} syncSystems={syncSystems} serverStatus={serverStatus} />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsTab analytics={analytics} days={analyticsDays} onDaysChange={handleDaysChange} />
            )}
            {activeTab === 'users' && (
              <UsersTab users={usersList} total={usersTotal} planBreakdown={planBreakdown}
                query={usersQuery} onQueryChange={setUsersQuery} onSearch={handleUsersSearch}
                onPageChange={handleUsersPageChange} page={usersPage} pageSize={PAGE_SIZE} />
            )}
            {activeTab === 'deploy' && (
              <DeployTab status={status} onAction={doAction} loading={loading}
                deployments={deploymentsList} latestByChannel={latestByChannel} onRefreshDeploys={loadDeployments} />
            )}
            {activeTab === 'feedback' && (
              <FeedbackTab
                items={feedbackItems} stats={feedbackStats} total={feedbackTotal} loading={feedbackLoading}
                filterType={feedbackFilterType} filterStatus={feedbackFilterStatus} searchQuery={feedbackSearch}
                onFilterTypeChange={handleFeedbackFilterType} onFilterStatusChange={handleFeedbackFilterStatus}
                onSearchChange={setFeedbackSearch} onSearch={handleFeedbackSearch}
                onUpdateStatus={handleUpdateFeedbackStatus} onUpdatePriority={handleUpdateFeedbackPriority}
                selectedItem={selectedFeedback} selectedComments={selectedFeedbackComments}
                onSelectItem={handleSelectFeedback} onCloseDetail={() => { setSelectedFeedback(null); setSelectedFeedbackComments([]); }}
                onAddComment={handleAddFeedbackComment} onCreateFeedback={handleCreateFeedback}
              />
            )}
            {activeTab === 'infra' && (
              <InfraTab syncSystems={syncSystems} dbStats={dbStats} serverStatus={serverStatus}
                onRefresh={() => { loadSyncSystems(); loadDbStats(); loadServerStatus(); }} />
            )}
            {activeTab === 'access' && (
              <AccessTab betaUsers={betaUsers} waitlistEntries={waitlistEntries} waitlistTotal={waitlistTotal}
                onRefresh={() => { loadBetaUsers(); loadWaitlist(); loadDbStats(); }}
                onUpsertBeta={handleUpsertBeta} onDeleteBeta={handleDeleteBeta}
                onPromoteWaitlist={handlePromoteWaitlist} loading={loading} />
            )}
          </div>
        </main>
      </div>
    </LoginGate>
  );
}
