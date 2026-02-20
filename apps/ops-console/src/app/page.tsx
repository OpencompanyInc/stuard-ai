// @ts-nocheck
/* eslint-disable */
import OpsConsole from './OpsConsole';
export default function Page() { return <OpsConsole />; }
// Legacy code below - entire file replaced by OpsConsole.tsx

interface _Unused_SyncSystemData {
  sharedSpaces: { status: string; total: number; recentSync: string | null };
  memoryOutbox: { status: string; total: number; pending: number; failed: number };
  webhooks: { status: string; total: number; active: number; totalTriggers: number; pendingDeliveries: number };
  devices: { status: string; total: number; online: number; byPlatform: Record<string, number> };
  conversations: { status: string; total: number; messages: number };
  marketplace: { status: string; workflows: number; totalDownloads: number };
  feedback: { status: string; total: number; openBugs: number; openFeatures: number };
}

interface DatabaseStats {
  [key: string]: number;
}

interface BetaUser {
  id: string;
  email: string;
  access_level: 'beta' | 'staging' | 'all' | string;
  invited_by?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  notes?: string | null;
}

interface WaitlistEntry {
  id: string;
  email: string;
  name?: string | null;
  company?: string | null;
  use_case?: string | null;
  referral_source?: string | null;
  position?: number | null;
  created_at?: string | null;
  notified?: boolean | null;
}

interface StatusData {
  currentBranch: string;
  branches: string[];
  isClean: boolean;
  modified: string[];
  not_added: string[];
  ahead: number;
  behind: number;
  latestTag: string | null;
  allTags: string[];
  lastDeployTime: string | null;
  versions?: { desktop?: string | null; website?: string | null; cloud?: string | null };
  updates?: { stable?: UpdateChannelInfo; staging?: UpdateChannelInfo; beta?: UpdateChannelInfo };
  urls: { vercel: { preview: string; production: string }; cloudRun: { staging: string; production: string } };
}

function StatusBadge({ isClean, modifiedCount, untrackedCount }: { isClean: boolean; modifiedCount: number; untrackedCount: number }) {
  const total = (modifiedCount || 0) + (untrackedCount || 0);
  if (isClean || total === 0) {
    return <span className="badge-success text-xs px-2 py-1 rounded-md inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Clean</span>;
  }
  return <span className="badge-warning text-xs px-2 py-1 rounded-md inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {total} changes</span>;
}

function formatTimeAgo(dateString?: string | null) {
  if (!dateString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDateLabel(dateString?: string | null) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function _LegacyOpsDashboard_UNUSED() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [syncSystems, setSyncSystems] = useState<SyncSystemData | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'deploy' | 'data' | 'tools'>('overview');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [version, setVersion] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState('');
  const [checkoutBranch, setCheckoutBranch] = useState('');
  const [pushAutoCommit, setPushAutoCommit] = useState(false);
  const [selectedBetaBranch, setSelectedBetaBranch] = useState('');
  const [betaTargets, setBetaTargets] = useState({ website: true, cloud: true, desktop: true });
  const [stagingTargets, setStagingTargets] = useState({ website: true, cloud: true, desktop: true });
  const [prodTargets, setProdTargets] = useState({ website: true, cloud: true, desktop: true });

  const [betaUsers, setBetaUsers] = useState<BetaUser[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [waitlistTotal, setWaitlistTotal] = useState(0);
  const [waitlistQuery, setWaitlistQuery] = useState('');
  const [betaEmail, setBetaEmail] = useState('');
  const [betaAccessLevel, setBetaAccessLevel] = useState<'beta' | 'staging' | 'all'>('beta');
  const [betaNotes, setBetaNotes] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchBetaUsers = async () => {
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) return;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/beta-users`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) setBetaUsers(data.users || []);
    } catch (error) {
      console.error('Failed to fetch beta users:', error);
    }
  };

  const fetchWaitlist = async (q?: string) => {
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) return;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const params = new URLSearchParams();
      const query = (q ?? waitlistQuery).trim();
      if (query) params.set('q', query);
      params.set('limit', '50');
      params.set('offset', '0');
      const res = await fetch(`${apiUrl}/v1/ops/waitlist?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setWaitlistEntries(data.entries || []);
        setWaitlistTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch waitlist:', error);
    }
  };

  const upsertBetaUser = async () => {
    const email = betaEmail.trim().toLowerCase();
    if (!email) {
      setMessage('Error: Email is required');
      return;
    }

    setLoading(true);
    setMessage('Processing...');
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) {
        setMessage('Error: Missing access token');
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/beta-users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email, access_level: betaAccessLevel, notes: betaNotes || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(`Error: ${data.error || 'Action failed'}`);
        return;
      }
      setMessage('Beta user updated');
      setBetaEmail('');
      setBetaNotes('');
      await Promise.all([fetchBetaUsers(), fetchDbStats()]);
    } catch (err) {
      console.error(err);
      setMessage('Error: Network request failed');
    } finally {
      setLoading(false);
    }
  };

  const deleteBetaUser = async (email: string) => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    setMessage('Processing...');
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) {
        setMessage('Error: Missing access token');
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/beta-users/${encodeURIComponent(target)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(`Error: ${data.error || 'Action failed'}`);
        return;
      }
      setMessage('Beta user removed');
      await Promise.all([fetchBetaUsers(), fetchDbStats()]);
    } catch (err) {
      console.error(err);
      setMessage('Error: Network request failed');
    } finally {
      setLoading(false);
    }
  };

  const promoteWaitlist = async (email: string, accessLevel: 'beta' | 'staging') => {
    const target = email.trim().toLowerCase();
    if (!target) return;
    setLoading(true);
    setMessage('Processing...');
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) {
        setMessage('Error: Missing access token');
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/waitlist/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: target, access_level: accessLevel, removeFromWaitlist: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(`Error: ${data.error || 'Action failed'}`);
        return;
      }
      setMessage(`Promoted to ${accessLevel}`);
      await Promise.all([fetchWaitlist(), fetchBetaUsers(), fetchDbStats()]);
    } catch (err) {
      console.error(err);
      setMessage('Error: Network request failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncSystems = async () => {
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) return;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/sync-systems`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setSyncSystems(data.systems);
      }
    } catch (error) {
      console.error('Failed to fetch sync systems:', error);
    }
  };

  const fetchDbStats = async () => {
    try {
      const token = localStorage.getItem('stuard_access_token');
      if (!token) return;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://api.stuard.ai';
      const res = await fetch(`${apiUrl}/v1/ops/database-stats`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setDbStats(data.tables);
      }
    } catch (error) {
      console.error('Failed to fetch database stats:', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchSyncSystems();
    fetchDbStats();
    fetchBetaUsers();
    fetchWaitlist();
    const interval = setInterval(fetchStatus, 5000);
    const syncInterval = setInterval(() => { fetchSyncSystems(); fetchDbStats(); fetchBetaUsers(); fetchWaitlist(); }, 30000);
    return () => { clearInterval(interval); clearInterval(syncInterval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doAction = async (type: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    // Client-side validation
    if (type === 'commit' && !payload.message) {
      setMessage('Error: Commit message is required');
      return false;
    }

    setLoading(true);
    setMessage(type === 'run-checks' ? 'Running local checks (this may take a minute)...' : 'Processing...');

    try {
      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(data.message || 'Action completed');
        // Clear inputs on success
        if (type === 'commit') setCommitMsg('');
        if (type === 'create-branch') setNewBranchName('');

        await fetchStatus();
        return true;
      } else {
        setMessage(`Error: ${data.error || 'Action failed'}`);
        return false;
      }
    } catch (err) {
      console.error('Action error:', err);
      setMessage('Error: Network request failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleShipToBeta = async () => {
    // 1. Run local checks first
    const checksPassed = await doAction('run-checks');
    if (!checksPassed) return;

    // 2. If passed, proceed to ship
    // Small delay to let the user see the success message
    await new Promise(resolve => setTimeout(resolve, 1000));

    await doAction('ship-to-beta', { targets: betaTargets, sourceBranch: selectedBetaBranch || undefined });
  };

  const updateChannels = [
    { key: 'stable', label: 'Stable', color: 'emerald', data: status?.updates?.stable },
    { key: 'staging', label: 'Staging', color: 'blue', data: status?.updates?.staging },
    { key: 'beta', label: 'Beta', color: 'purple', data: status?.updates?.beta },
  ];

  if (!status) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <div className="w-10 h-10 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
      <div className="text-sm text-gray-500">Loading Operations Dashboard...</div>
    </div>
  );

  return (
    <div className="min-h-screen p-6 md:p-10">
      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-black/10">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Operations Dashboard</h1>
            <p className="text-gray-500 mt-1 text-sm">Monitor deployments, data sync, and system health</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-6 px-5 py-3 bg-white rounded-xl border border-black/5 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-xs text-gray-600">System Online</span>
              </div>
              <div className="w-px h-4 bg-gray-200"></div>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500">{formatTimeAgo(status.lastDeployTime)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white rounded-xl border border-black/5 shadow-sm">
              <GitBranch className="w-4 h-4 text-[#007AFF]" />
              <span className="font-mono text-sm text-gray-700">{status.currentBranch}</span>
              <StatusBadge isClean={status.isClean} modifiedCount={status.modified?.length || 0} untrackedCount={status.not_added?.length || 0} />
            </div>
          </div>
        </div>
      </header>

      {message && (
        <div className={cn("mb-6 p-4 rounded-xl border flex items-center gap-3 animate-fade-in",
          message.startsWith('Error') ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"
        )}>
          {message.startsWith('Error') ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          <span className="font-medium text-sm">{message}</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-8 border-b border-black/10">
        {[
          { id: 'overview', label: 'Overview', icon: Activity },
          { id: 'deploy', label: 'Deployments', icon: Rocket },
          { id: 'data', label: 'Cloud Data', icon: Database },
          { id: 'tools', label: 'Tools & Agents', icon: Wrench },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn("px-5 py-3 text-sm font-medium transition-all flex items-center gap-2 border-b-2 -mb-[1px]",
              activeTab === tab.id ? "border-[#007AFF] text-[#007AFF]" : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            )}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-[#007AFF]" /></div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Conversations</div>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{syncSystems?.conversations?.total?.toLocaleString() ?? '—'}</div>
              <div className="text-xs text-gray-500 mt-1">{syncSystems?.conversations?.messages?.toLocaleString() ?? 0} messages</div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><Monitor className="w-5 h-5 text-emerald-600" /></div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Devices</div>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{syncSystems?.devices?.total ?? '—'}</div>
              <div className="text-xs text-emerald-600 mt-1">{syncSystems?.devices?.online ?? 0} online</div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center"><Store className="w-5 h-5 text-purple-600" /></div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Marketplace</div>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{syncSystems?.marketplace?.workflows ?? '—'}</div>
              <div className="text-xs text-gray-500 mt-1">{syncSystems?.marketplace?.totalDownloads ?? 0} downloads</div>
            </div>
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Bug className="w-5 h-5 text-amber-600" /></div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Feedback</div>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{syncSystems?.feedback?.total ?? '—'}</div>
              <div className="text-xs text-red-500 mt-1">{syncSystems?.feedback?.openBugs ?? 0} open bugs</div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: 'Shared Spaces', status: syncSystems?.sharedSpaces?.status, icon: Cloud },
                { name: 'Memory Outbox', status: syncSystems?.memoryOutbox?.status, icon: HardDrive },
                { name: 'Webhooks', status: syncSystems?.webhooks?.status || 'operational', icon: Webhook },
                { name: 'Devices', status: syncSystems?.devices?.status, icon: Monitor },
              ].map((system) => (
                <div key={system.name} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <system.icon className="w-5 h-5 text-gray-400" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">{system.name}</div>
                    <div className={cn("text-xs", system.status === 'operational' ? "text-emerald-600" : "text-amber-600")}>{system.status || 'Unknown'}</div>
                  </div>
                  <div className={cn("w-2 h-2 rounded-full", system.status === 'operational' ? "bg-emerald-500" : "bg-amber-500")} />
                </div>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Versions</h3>
            <div className="grid grid-cols-3 gap-6">
              <div><div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Desktop</div><div className="font-mono text-lg text-gray-900">{status?.versions?.desktop || '—'}</div></div>
              <div><div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Website</div><div className="font-mono text-lg text-gray-900">{status?.versions?.website || '—'}</div></div>
              <div><div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cloud API</div><div className="font-mono text-lg text-gray-900">{status?.versions?.cloud || '—'}</div></div>
            </div>
          </div>
        </div>
      )}

      {/* CLOUD DATA TAB */}
      {activeTab === 'data' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div><h2 className="text-xl font-semibold text-gray-900">Cloud Sync Systems</h2><p className="text-sm text-gray-500">Real-time status of all cloud-synced data</p></div>
            <button onClick={() => { fetchSyncSystems(); fetchDbStats(); }} className="btn-secondary px-4 py-2 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card card-hover p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center"><Cloud className="w-5 h-5 text-violet-600" /></div><div><div className="text-sm font-semibold text-gray-800">Shared Spaces</div><div className="text-xs text-gray-500">E2E Encrypted Sync</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Total</span><span className="font-mono text-gray-800">{syncSystems?.sharedSpaces?.total ?? '—'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Last Sync</span><span className="text-xs text-gray-600">{formatTimeAgo(syncSystems?.sharedSpaces?.recentSync)}</span></div></div></div>
            <div className="card card-hover p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><HardDrive className="w-5 h-5 text-blue-600" /></div><div><div className="text-sm font-semibold text-gray-800">Memory Outbox</div><div className="text-xs text-gray-500">Offline Delivery</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Total</span><span className="font-mono text-gray-800">{syncSystems?.memoryOutbox?.total ?? '—'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Pending</span><span className="font-mono text-amber-600">{syncSystems?.memoryOutbox?.pending ?? 0}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Failed</span><span className="font-mono text-red-600">{syncSystems?.memoryOutbox?.failed ?? 0}</span></div></div></div>
            <div className="card card-hover p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Webhook className="w-5 h-5 text-amber-600" /></div><div><div className="text-sm font-semibold text-gray-800">Webhooks</div><div className="text-xs text-gray-500">Event Triggers</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Active</span><span className="font-mono text-gray-800">{syncSystems?.webhooks?.active ?? 0} / {syncSystems?.webhooks?.total ?? 0}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Total Triggers</span><span className="font-mono text-gray-600">{syncSystems?.webhooks?.totalTriggers ?? 0}</span></div></div></div>
            <div className="card card-hover p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><Monitor className="w-5 h-5 text-emerald-600" /></div><div><div className="text-sm font-semibold text-gray-800">Devices</div><div className="text-xs text-gray-500">Connected Clients</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Online</span><span className="font-mono text-emerald-600">{syncSystems?.devices?.online ?? 0} / {syncSystems?.devices?.total ?? 0}</span></div></div></div>
          </div>

          {dbStats && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Database Tables</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Object.entries(dbStats).filter(([, count]) => count >= 0).map(([table, count]) => (
                  <div key={table} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600 truncate">{table.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-sm text-gray-900 ml-2">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TOOLS & AGENTS TAB */}
      {activeTab === 'tools' && (
        <div className="space-y-6">
          <div><h2 className="text-xl font-semibold text-gray-900">Tools & Agent Systems</h2><p className="text-sm text-gray-500">Manage tool migrations, embeddings, and agent workflows</p></div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><Layers className="w-5 h-5 text-indigo-600" /></div><div><div className="text-sm font-semibold text-gray-800">Tool Embeddings</div><div className="text-xs text-gray-500">Semantic tool lookup</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Total Tools</span><span className="font-mono text-gray-800">{dbStats?.tool_embeddings ?? '—'}</span></div><div className="pt-2 border-t border-gray-100"><span className="badge-success text-xs px-2 py-1 rounded-md inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Synced</span></div></div></div>
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center"><Play className="w-5 h-5 text-purple-600" /></div><div><div className="text-sm font-semibold text-gray-800">Workflow Engine</div><div className="text-xs text-gray-500">Automation runtime</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Marketplace</span><span className="font-mono text-gray-800">{syncSystems?.marketplace?.workflows ?? '—'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Downloads</span><span className="font-mono text-gray-600">{syncSystems?.marketplace?.totalDownloads ?? 0}</span></div></div></div>
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><Cpu className="w-5 h-5 text-emerald-600" /></div><div><div className="text-sm font-semibold text-gray-800">Agent System</div><div className="text-xs text-gray-500">AI reasoning & planning</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Conversations</span><span className="font-mono text-gray-800">{syncSystems?.conversations?.total?.toLocaleString() ?? '—'}</span></div><div className="flex justify-between text-sm"><span className="text-gray-500">Messages</span><span className="font-mono text-gray-600">{syncSystems?.conversations?.messages?.toLocaleString() ?? '—'}</span></div></div></div>
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Users className="w-5 h-5 text-blue-600" /></div><div><div className="text-sm font-semibold text-gray-800">External Accounts</div><div className="text-xs text-gray-500">OAuth integrations</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Connected</span><span className="font-mono text-gray-800">{dbStats?.external_accounts ?? '—'}</span></div></div></div>
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Beaker className="w-5 h-5 text-amber-600" /></div><div><div className="text-sm font-semibold text-gray-800">Beta Access</div><div className="text-xs text-gray-500">Channel control</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Users</span><span className="font-mono text-gray-800">{dbStats?.beta_users ?? '—'}</span></div></div></div>
            <div className="card p-5"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center"><Users className="w-5 h-5 text-pink-600" /></div><div><div className="text-sm font-semibold text-gray-800">Waitlist</div><div className="text-xs text-gray-500">Early access signups</div></div></div><div className="space-y-2"><div className="flex justify-between text-sm"><span className="text-gray-500">Signups</span><span className="font-mono text-gray-800">{dbStats?.waitlist ?? '—'}</span></div></div></div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin API Endpoints</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg"><div className="font-mono text-sm text-[#007AFF] mb-1">GET /v1/ops/sync-systems</div><div className="text-xs text-gray-500">Real-time sync system health and statistics</div></div>
              <div className="p-4 bg-gray-50 rounded-lg"><div className="font-mono text-sm text-[#007AFF] mb-1">GET /v1/ops/database-stats</div><div className="text-xs text-gray-500">Database table row counts</div></div>
              <div className="p-4 bg-gray-50 rounded-lg"><div className="font-mono text-sm text-[#007AFF] mb-1">GET /v1/ops/beta-users</div><div className="text-xs text-gray-500">List all beta access users</div></div>
              <div className="p-4 bg-gray-50 rounded-lg"><div className="font-mono text-sm text-[#007AFF] mb-1">POST /v1/ops/beta-users</div><div className="text-xs text-gray-500">Add or update beta user access</div></div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Access Control</h3>
                <p className="text-sm text-gray-500">Manage waitlist and beta/staging users</p>
              </div>
              <button onClick={() => { fetchBetaUsers(); fetchWaitlist(); fetchDbStats(); }} className="btn-secondary px-4 py-2 text-sm flex items-center gap-2">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Beaker className="w-4 h-4 text-purple-600" />
                    <div className="text-sm font-semibold text-gray-800">Beta Users</div>
                  </div>
                  <div className="text-xs text-gray-500">{betaUsers.length.toLocaleString()} users</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                  <input
                    type="email"
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800"
                    placeholder="email@domain.com"
                    value={betaEmail}
                    onChange={(e) => setBetaEmail(e.target.value)}
                  />
                  <select
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800"
                    value={betaAccessLevel}
                    onChange={(e) => setBetaAccessLevel(e.target.value as 'beta' | 'staging' | 'all')}
                  >
                    <option value="beta">beta</option>
                    <option value="staging">staging</option>
                    <option value="all">all</option>
                  </select>
                  <button
                    onClick={upsertBetaUser}
                    disabled={loading}
                    className="btn-primary w-full py-2 text-xs disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add / Update
                  </button>
                </div>
                <input
                  type="text"
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 mb-4"
                  placeholder="notes (optional)"
                  value={betaNotes}
                  onChange={(e) => setBetaNotes(e.target.value)}
                />

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2 pr-3">Email</th>
                        <th className="py-2 pr-3">Access</th>
                        <th className="py-2 pr-3">Invited By</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {betaUsers.slice(0, 50).map((u) => (
                        <tr key={u.id || u.email} className="border-t border-gray-200/60">
                          <td className="py-2 pr-3 font-mono text-xs text-gray-800">{u.email}</td>
                          <td className="py-2 pr-3"><span className="font-mono text-xs text-gray-700">{String(u.access_level || '')}</span></td>
                          <td className="py-2 pr-3 text-xs text-gray-600">{u.invited_by || '—'}</td>
                          <td className="py-2 pr-3 text-right">
                            <button
                              onClick={() => deleteBetaUser(u.email)}
                              disabled={loading}
                              className="btn-secondary px-3 py-1 text-xs disabled:opacity-40 inline-flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                      {betaUsers.length === 0 && (
                        <tr><td colSpan={4} className="py-4 text-xs text-gray-500">No beta users found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-pink-600" />
                    <div className="text-sm font-semibold text-gray-800">Waitlist</div>
                  </div>
                  <div className="text-xs text-gray-500">{waitlistTotal.toLocaleString()} signups</div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-800"
                      placeholder="Search email, name, company, use case..."
                      value={waitlistQuery}
                      onChange={(e) => setWaitlistQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fetchWaitlist(e.currentTarget.value); }}
                    />
                  </div>
                  <button
                    onClick={() => fetchWaitlist()}
                    disabled={loading}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
                  >
                    Search
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-2 pr-3">Email</th>
                        <th className="py-2 pr-3">Name</th>
                        <th className="py-2 pr-3">Company</th>
                        <th className="py-2 pr-3">Created</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {waitlistEntries.slice(0, 50).map((e) => (
                        <tr key={e.id || e.email} className="border-t border-gray-200/60">
                          <td className="py-2 pr-3 font-mono text-xs text-gray-800">{e.email}</td>
                          <td className="py-2 pr-3 text-xs text-gray-700">{e.name || '—'}</td>
                          <td className="py-2 pr-3 text-xs text-gray-700">{e.company || '—'}</td>
                          <td className="py-2 pr-3 text-xs text-gray-600">{formatDateLabel(e.created_at)}</td>
                          <td className="py-2 pr-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => promoteWaitlist(e.email, 'beta')}
                                disabled={loading}
                                className="btn-primary px-3 py-1 text-xs disabled:opacity-40"
                              >
                                Promote Beta
                              </button>
                              <button
                                onClick={() => promoteWaitlist(e.email, 'staging')}
                                disabled={loading}
                                className="btn-secondary px-3 py-1 text-xs disabled:opacity-40"
                              >
                                Promote Staging
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {waitlistEntries.length === 0 && (
                        <tr><td colSpan={5} className="py-4 text-xs text-gray-500">No waitlist entries found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DEPLOYMENTS TAB */}
      {activeTab === 'deploy' && (
        <div className="space-y-6">
          {/* Version Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div><div className="text-xs text-gray-500 font-medium uppercase">Version Control</div><div className="text-sm font-semibold text-gray-800">Codebase</div></div>
                <div className="text-xs text-gray-500 text-right"><div className="uppercase font-medium text-[10px]">Latest Tag</div><div className="font-mono text-gray-700">{status.latestTag || 'none'}</div></div>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <div className="flex justify-between"><span className="text-gray-500 text-xs">Desktop</span><span className="font-mono text-sm text-gray-800">{status.versions?.desktop || '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-xs">Website</span><span className="font-mono text-sm text-gray-800">{status.versions?.website || '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-xs">Cloud</span><span className="font-mono text-sm text-gray-800">{status.versions?.cloud || '—'}</span></div>
              </div>
            </div>

            {updateChannels.map((channel) => (
              <div key={channel.key} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div><div className="text-xs text-gray-500 font-medium uppercase">{channel.label}</div><div className="text-sm font-semibold text-gray-800">Update Channel</div></div>
                  <span className={cn("text-[10px] font-medium px-2 py-1 rounded-md", channel.color === 'emerald' ? "badge-success" : channel.color === 'blue' ? "badge-info" : "bg-purple-50 text-purple-600 border border-purple-200")}>{channel.data?.ok ? 'Active' : 'Offline'}</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-xs text-gray-500">Version</span><span className="font-mono text-sm text-gray-800">{channel.data?.version || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-gray-500">Released</span><span className="text-xs text-gray-600">{formatDateLabel(channel.data?.releaseDate)}</span></div>
                </div>
                <div className="text-xs mt-2">{channel.data?.error ? <span className="text-amber-600">Unavailable</span> : <a href={channel.data?.url || '#'} target="_blank" rel="noreferrer" className="text-[#007AFF] hover:underline">View manifest →</a>}</div>
              </div>
            ))}
          </div>

          {/* Deployment Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Local Dev */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><RefreshCw className="w-5 h-5 text-[#007AFF]" /></div>
                <div><h2 className="text-base font-semibold text-gray-800">1. Local Dev</h2><p className="text-xs text-gray-500">Code & Commit</p></div>
              </div>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-gray-500 font-medium uppercase">Changed Files</span><span className="text-[10px] font-mono text-gray-400">{(status.modified?.length || 0) + (status.not_added?.length || 0)} files</span></div>
                  {status.isClean ? <div className="text-xs text-gray-400 italic">Working tree clean</div> : (
                    <ul className="space-y-1 text-[11px] font-mono">
                      {status.modified?.slice(0, 5).map(f => <li key={f} className="text-amber-600 truncate">M {f.split('/').pop()}</li>)}
                      {status.not_added?.slice(0, 3).map(f => <li key={f} className="text-emerald-600 truncate">+ {f.split('/').pop()}</li>)}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1.5">Commit Message</label>
                  <input type="text" className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]" placeholder="feat: ..." value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={() => doAction('stage-all')} disabled={loading || status.isClean} className="btn-secondary w-full py-2 text-xs disabled:opacity-40">Stage All</button>
                  <button onClick={() => doAction('commit', { message: commitMsg })} disabled={loading || !commitMsg.trim()} className="btn-primary w-full py-2 text-xs disabled:opacity-40">Commit</button>
                  <button onClick={() => doAction('run-checks')} disabled={loading} className="btn-secondary w-full py-2 text-xs disabled:opacity-40 flex items-center justify-center gap-2">
                    <ShieldCheck className="w-3 h-3" /> Run Checks
                  </button>
                </div>

                <div className="pt-4 border-t border-gray-100 space-y-3">
                  <div className="text-[10px] text-gray-500 font-medium uppercase">Branches</div>

                  <div className="space-y-2">
                    <label className="block text-[10px] text-gray-500 font-medium uppercase">Create New Branch</label>
                    <input
                      type="text"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]"
                      placeholder="feature/my-branch"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                    />
                    <select
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800"
                      value={newBranchBase}
                      onChange={(e) => setNewBranchBase(e.target.value)}
                    >
                      <option value="">Base: current ({status.currentBranch})</option>
                      {status.branches?.map((b) => (
                        <option key={b} value={b}>
                          Base: {b}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => doAction('create-branch', { branch: newBranchName, baseBranch: newBranchBase || undefined })}
                      disabled={loading || !newBranchName.trim()}
                      className="btn-secondary w-full py-2 text-xs disabled:opacity-40"
                    >
                      <GitBranch className="w-3 h-3 inline-block mr-2" /> Create & Push Branch
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] text-gray-500 font-medium uppercase">Switch Branch</label>
                    <select
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800"
                      value={checkoutBranch}
                      onChange={(e) => setCheckoutBranch(e.target.value)}
                    >
                      <option value="">Select branch…</option>
                      {status.branches?.map((b) => (
                        <option key={b} value={b}>
                          {b}{b === status.currentBranch ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => doAction('checkout-branch', { branch: checkoutBranch })}
                      disabled={loading || !checkoutBranch.trim() || checkoutBranch === status.currentBranch}
                      className="btn-secondary w-full py-2 text-xs disabled:opacity-40"
                    >
                      Switch
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] text-gray-500 font-medium uppercase">Upload to Cloud Branch</label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pushAutoCommit}
                        onChange={() => setPushAutoCommit((v) => !v)}
                        className="rounded"
                      />
                      Auto-commit dirty changes (WIP)
                    </label>
                    <button
                      onClick={() => doAction('push-current', { autoCommit: pushAutoCommit })}
                      disabled={loading}
                      className="btn-primary w-full py-2 text-xs disabled:opacity-40"
                    >
                      <Cloud className="w-3 h-3 inline-block mr-2" /> Push Current Branch
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Beta */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center"><Beaker className="w-5 h-5 text-purple-600" /></div>
                <div><h2 className="text-base font-semibold text-gray-800">2. Beta</h2><p className="text-xs text-gray-500">Internal Testing</p></div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1.5">Source Branch</label>
                  <select className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800" value={selectedBetaBranch} onChange={(e) => setSelectedBetaBranch(e.target.value)}>
                    <option value="">{status.currentBranch} (current)</option>
                    {status.branches?.filter(b => b !== status.currentBranch).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-500 font-medium uppercase">Deploy Targets</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={betaTargets.website} onChange={() => setBetaTargets(p => ({ ...p, website: !p.website }))} className="rounded" /> Website</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={betaTargets.cloud} onChange={() => setBetaTargets(p => ({ ...p, cloud: !p.cloud }))} className="rounded" /> Cloud API</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={betaTargets.desktop} onChange={() => setBetaTargets(p => ({ ...p, desktop: !p.desktop }))} className="rounded" /> Desktop</label>
                </div>
                <button onClick={handleShipToBeta} disabled={loading} className="btn-primary w-full py-2 text-xs disabled:opacity-40">🚀 Ship to Beta</button>
              </div>
            </div>

            {/* Staging */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><Terminal className="w-5 h-5 text-indigo-600" /></div>
                <div><h2 className="text-base font-semibold text-gray-800">3. Staging</h2><p className="text-xs text-gray-500">Pre-Production</p></div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-500 font-medium uppercase">Deploy Targets</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stagingTargets.website} onChange={() => setStagingTargets(p => ({ ...p, website: !p.website }))} className="rounded" /> Website</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stagingTargets.cloud} onChange={() => setStagingTargets(p => ({ ...p, cloud: !p.cloud }))} className="rounded" /> Cloud API</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stagingTargets.desktop} onChange={() => setStagingTargets(p => ({ ...p, desktop: !p.desktop }))} className="rounded" /> Desktop</label>
                </div>
                <button onClick={() => doAction('ship-to-staging', { targets: stagingTargets })} disabled={loading || status.currentBranch !== 'staging'} className="btn-primary w-full py-2 text-xs disabled:opacity-40">🧪 Ship to Staging</button>
                {status.currentBranch !== 'staging' && <p className="text-[10px] text-amber-600 text-center">Switch to staging branch to release</p>}
              </div>
            </div>

            {/* Production */}
            <div className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><Rocket className="w-5 h-5 text-emerald-600" /></div>
                <div><h2 className="text-base font-semibold text-gray-800">4. Production</h2><p className="text-xs text-gray-500">Live Release</p></div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-gray-500 font-medium uppercase mb-1.5">Release Version</label>
                  <input type="text" className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]" placeholder="v1.0.0" value={version} onChange={(e) => setVersion(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-500 font-medium uppercase">Deploy Targets</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prodTargets.website} onChange={() => setProdTargets(p => ({ ...p, website: !p.website }))} className="rounded" /> Website</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prodTargets.cloud} onChange={() => setProdTargets(p => ({ ...p, cloud: !p.cloud }))} className="rounded" /> Cloud API</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prodTargets.desktop} onChange={() => setProdTargets(p => ({ ...p, desktop: !p.desktop }))} className="rounded" /> Desktop</label>
                </div>
                <button onClick={() => doAction('ship-to-prod', { version, targets: prodTargets })} disabled={loading || !version.trim() || status.currentBranch !== 'staging'} className="btn-primary w-full py-2 text-xs disabled:opacity-40">🚀 Ship to Production</button>
                {status.currentBranch !== 'staging' && <p className="text-[10px] text-amber-600 text-center">Switch to staging branch to release</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
