import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  Activity,
  Box,
  Calendar,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Globe,
  LayoutGrid,
  Layers,
  Lock,
  Mic,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Settings,
  Square,
  Star,
  Store,
  Trash2,
  Tv,
  Upload,
} from "lucide-react";
import { DiscoverTips } from "./DiscoverTips";
import { formatRelativeTime } from "./Skills";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import { getValidAccessToken } from "../../auth/authManager";
import {
  getMarketplaceApi,
  type MarketplaceCategory,
  type MarketplaceUpdate,
  type MarketplaceWorkflow,
} from "../../utils/cloud";

type ActiveView = "workflows" | "deployed" | "shared" | "marketplace";
type DeployFilter = "all" | "running" | "idle";

interface WorkflowItem {
  id: string;
  name?: string;
  marketplaceSlug?: string;
  locked?: boolean;
  version?: string;
  folder?: string;
  description?: string;
  updatedAt?: string;
}

interface DeployStatus {
  deployed: boolean;
  running: boolean;
  triggers: string[];
}

interface WorkflowLauncherV2Props {
  items: WorkflowItem[];
  loading: boolean;
  runningIds: Record<string, boolean>;
  updates?: Record<string, MarketplaceUpdate>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: (slug?: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRun?: (id: string) => Promise<void>;
  onStop?: (id: string) => Promise<void>;
  onShowPublished?: () => void;
  onDashboard?: () => void;
}

export function WorkflowLauncherV2({
  items,
  loading,
  runningIds,
  updates = {},
  onSelect,
  onCreate,
  onImport,
  onMarketplace,
  onDelete,
  onRun,
  onStop,
  onShowPublished,
  onDashboard,
}: WorkflowLauncherV2Props) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<ActiveView>("workflows");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deployFilter, setDeployFilter] = useState<DeployFilter>("all");
  const [deployStatuses, setDeployStatuses] = useState<Record<string, DeployStatus>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState("all");
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceWorkflow[]>([]);
  const [featuredItems, setFeaturedItems] = useState<MarketplaceWorkflow[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeView]);

  const refreshDeployStatuses = useCallback(async () => {
    const entries = await Promise.all(
      items.map(async (item) => {
        try {
          const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(item.id);
          return [
            item.id,
            status?.ok
              ? {
                  deployed: Boolean(status.deployed),
                  running: Boolean(status.running),
                  triggers: Array.isArray(status.triggers) ? status.triggers : [],
                }
              : { deployed: false, running: false, triggers: [] },
          ] as const;
        } catch {
          return [item.id, { deployed: false, running: false, triggers: [] }] as const;
        }
      })
    );
    setDeployStatuses(Object.fromEntries(entries));
  }, [items]);

  useEffect(() => {
    if (activeView !== "deployed") return;
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await refreshDeployStatuses();
      }
    };
    run();
    const timer = window.setInterval(run, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeView, refreshDeployStatuses]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getValidAccessToken().catch(() => null);
        const api = getMarketplaceApi(() => token || null);
        const res = await api.getCategories();
        if (!cancelled && res.ok) {
          setCategories(res.categories || []);
        }
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "marketplace") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setMarketplaceLoading(true);
      setMarketplaceError(null);
      try {
        const token = await getValidAccessToken().catch(() => null);
        const api = getMarketplaceApi(() => token || null);
        if (!marketplaceSearch.trim() && marketplaceCategory === "all") {
          const res = await api.getFeatured();
          if (!cancelled) {
            if (res.ok) {
              setFeaturedItems(res.workflows.slice(0, 3));
              setMarketplaceItems(res.workflows || []);
            } else {
              setMarketplaceError(res.error || "Failed to load marketplace");
            }
          }
        } else {
          const res = await api.search({
            query: marketplaceSearch.trim() || undefined,
            category: marketplaceCategory === "all" ? undefined : marketplaceCategory,
            limit: 24,
          });
          if (!cancelled) {
            if (res.ok) {
              setFeaturedItems(res.results.slice(0, 3));
              setMarketplaceItems(res.results || []);
            } else {
              setMarketplaceError(res.error || "Failed to search marketplace");
            }
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          setMarketplaceError(error?.message || "Failed to load marketplace");
        }
      } finally {
        if (!cancelled) {
          setMarketplaceLoading(false);
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeView, marketplaceCategory, marketplaceSearch]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.name || item.id} ${item.description || ""}`.toLowerCase().includes(q));
  }, [items, search]);

  const sharedItems = useMemo(() => filteredItems.filter((item) => Boolean(item.marketplaceSlug)), [filteredItems]);

  const deployedItems = useMemo(() => {
    const base = filteredItems.filter((item) => deployStatuses[item.id]?.deployed);
    if (deployFilter === "running") {
      return base.filter((item) => Boolean(deployStatuses[item.id]?.running || runningIds[item.id]));
    }
    if (deployFilter === "idle") {
      return base.filter((item) => !Boolean(deployStatuses[item.id]?.running || runningIds[item.id]));
    }
    return base;
  }, [deployFilter, deployStatuses, filteredItems, runningIds]);

  const runningDeployed = useMemo(
    () => deployedItems.filter((item) => Boolean(deployStatuses[item.id]?.running || runningIds[item.id])),
    [deployStatuses, deployedItems, runningIds]
  );

  const idleDeployed = useMemo(
    () => deployedItems.filter((item) => !Boolean(deployStatuses[item.id]?.running || runningIds[item.id])),
    [deployStatuses, deployedItems, runningIds]
  );

  const visibleItems = activeView === "shared" ? sharedItems : activeView === "deployed" ? deployedItems : filteredItems;
  const selectedItem = activeView === "marketplace"
    ? null
    : visibleItems[Math.min(selectedIndex, Math.max(visibleItems.length - 1, 0))] || null;

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeView, deployFilter, marketplaceCategory, marketplaceSearch, search, visibleItems.length]);

  const executeAction = useCallback(
    async (key: string, action?: () => Promise<void>) => {
      if (!action) return;
      setBusyMap((prev) => ({ ...prev, [key]: true }));
      try {
        await action();
      } finally {
        setBusyMap((prev) => ({ ...prev, [key]: false }));
        if (activeView === "deployed") {
          await refreshDeployStatuses();
        }
      }
    },
    [activeView, refreshDeployStatuses]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (activeView === "marketplace") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, Math.max(visibleItems.length - 1, 0)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (e.key === "Enter" && selectedItem) {
        e.preventDefault();
        onSelect(selectedItem.id);
      }
    },
    [activeView, onSelect, selectedItem, visibleItems.length]
  );

  const featuredRows = useMemo(() => {
    if (marketplaceSearch.trim() || marketplaceCategory !== "all") return marketplaceItems.slice(0, 3);
    return featuredItems;
  }, [featuredItems, marketplaceCategory, marketplaceItems, marketplaceSearch]);

  const communityRows = useMemo(() => {
    if (marketplaceSearch.trim() || marketplaceCategory !== "all") return marketplaceItems;
    const featuredIds = new Set(featuredItems.map((item) => item.id));
    const rest = marketplaceItems.filter((item) => !featuredIds.has(item.id));
    return rest.length ? rest : marketplaceItems;
  }, [featuredItems, marketplaceCategory, marketplaceItems, marketplaceSearch]);

  const title =
    activeView === "marketplace"
      ? "Marketplace"
      : activeView === "shared"
      ? "Shared Workflows"
      : activeView === "deployed"
      ? deployFilter === "running"
        ? "Running Workflows"
        : deployFilter === "idle"
        ? "Not Running"
        : "Deployed Workflows"
      : "My Workflows";

  const subtitle =
    activeView === "marketplace"
      ? "Discover community-built automations with theme-aware browsing."
      : activeView === "shared"
      ? `${sharedItems.length} imported or synced workflows`
      : activeView === "deployed"
      ? `${runningDeployed.length} running · ${idleDeployed.length} idle`
      : `${items.length} workflows in your workspace`;

  const workspaceLabel = activeView === "marketplace" ? "Community Library" : "Your Workspace";
  const showCreateCard = activeView === "workflows" && !search.trim();

  return (
    <div className="flex h-screen w-screen overflow-hidden wf-bg wf-fg font-sans">
      <aside className="w-[300px] shrink-0 border-r wf-border p-6 flex flex-col gap-5 drag">
        <div className={`rounded-[20px] border p-6 h-[120px] relative overflow-hidden no-drag ${d ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"}`}>
          <div className={`absolute right-[-10px] top-1/2 -translate-y-1/2 h-40 w-40 rounded-full blur-[35px] ${d ? "bg-blue-500/40" : "bg-blue-500/20"}`} />
          <div className="relative z-10 text-[18px] font-bold tracking-tight">Stuard Studio</div>
          <div className={`relative z-10 mt-1 text-[13px] ${d ? "text-slate-300" : "text-slate-500"}`}>All your workflows in one place</div>
        </div>

        <div className="rounded-[24px] p-3 flex-1 no-drag overflow-y-auto scrollbar-minimal shadow-sm border space-y-1 wf-bg-elevated wf-border">
          <SideNavItem d={d} active={activeView === "workflows"} icon={Layers} label="My Workflows" onClick={() => setActiveView("workflows")} />
          <SideNavItem d={d} active={activeView === "deployed"} icon={Rocket} label="Deployed Workflows" onClick={() => setActiveView("deployed")} />
          <SideNavItem d={d} active={activeView === "shared"} icon={Share2} label="Shared Workflows" onClick={() => setActiveView("shared")} />
          <SideNavItem d={d} active={activeView === "marketplace"} icon={Store} label="Marketplace" onClick={() => setActiveView("marketplace")} accent />
          <div className="h-px my-2" style={{ background: "var(--wf-border)" }} />
          <SideNavItem d={d} icon={ExternalLink} label="Stuard Dashboard" onClick={onDashboard} />
        </div>

        <div className="rounded-[24px] p-3 no-drag shrink-0 shadow-sm border space-y-1 wf-bg-elevated wf-border">
          <SideNavItem
            d={d}
            icon={Play}
            label="Run Workflow"
            disabled={!selectedItem || !onRun}
            onClick={() => selectedItem && onRun ? executeAction(`run:${selectedItem.id}`, () => onRun(selectedItem.id)) : undefined}
          />
          <SideNavItem d={d} icon={ArrowDownCircle} label="Import Workflow" onClick={onImport} />
          <SideNavItem d={d} icon={Upload} label="Publish Workflow" onClick={onShowPublished} />
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden no-drag">
        <div className="px-10 pt-10 pb-8 flex items-start justify-between gap-5 shrink-0">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight wf-fg">{title}</h1>
            <div className="mt-2 flex items-center gap-1.5 text-[14px] wf-fg-muted">
              <span>{workspaceLabel}</span>
              <ChevronsUpDown className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative w-72 max-w-full group mt-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 wf-fg-faint group-focus-within:text-blue-500 transition-colors" />
              <input
                ref={inputRef}
                type="text"
                value={activeView === "marketplace" ? marketplaceSearch : search}
                onChange={(e) => (activeView === "marketplace" ? setMarketplaceSearch(e.target.value) : setSearch(e.target.value))}
                onKeyDown={handleKeyDown}
                placeholder={activeView === "marketplace" ? "Search marketplace..." : activeView === "deployed" ? "Search deployed workflows..." : activeView === "shared" ? "Search shared workflows..." : "Search workflows..."}
                className="w-full rounded-full pl-11 pr-4 py-3 text-[14px] focus:outline-none focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/15 transition-all border shadow-sm"
                style={{ background: "var(--wf-input-bg)", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
              />
            </div>
            <button
              type="button"
              disabled={!selectedItem || activeView === "marketplace"}
              onClick={() => selectedItem ? onSelect(selectedItem.id) : undefined}
              className={`rounded-[14px] border px-4 py-3 text-[13px] font-medium transition-all ${!selectedItem || activeView === "marketplace" ? "opacity-40 cursor-not-allowed" : ""} ${d ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.06]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Manage
              </span>
            </button>
          </div>
        </div>

        <div className="px-10 flex gap-3 overflow-x-auto shrink-0 pb-8 scrollbar-minimal">
          {activeView === "marketplace" ? (
            <>
              <FilterChip d={d} active={marketplaceCategory === "all"} label="All" icon={LayoutGrid} onClick={() => setMarketplaceCategory("all")} />
              {categories.map((category) => (
                <FilterChip key={category.id} d={d} active={marketplaceCategory === category.id} label={category.name} onClick={() => setMarketplaceCategory(category.id)} />
              ))}
            </>
          ) : (
            <>
              <FilterChip d={d} label="All" icon={LayoutGrid} active />
              <FilterChip d={d} label="Productivity" icon={SlidersHorizontal} />
              <FilterChip d={d} label="Organization" icon={Box} />
              <FilterChip d={d} label="Voice & Audio" icon={Mic} />
              <FilterChip d={d} label="Research" icon={Search} />
              <FilterChip d={d} label="Utility" icon={Settings} />
              <FilterChip d={d} label="Media" icon={Tv} />
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-10 pb-10 scrollbar-minimal">
          {activeView !== "marketplace" && loading ? (
            <div className="py-12 max-w-2xl mx-auto flex flex-col items-center gap-5">
              <div className={`w-8 h-8 border-2 rounded-full animate-spin ${d ? "border-white/10 border-t-blue-400" : "border-slate-200 border-t-blue-500"}`} />
              <DiscoverTips
                title="Discover workflows faster"
                className="w-full max-w-xl"
                light={!d}
                tips={[
                  { id: "launcher-ai", title: "Describe the outcome, not the steps", description: "Workflow AI works best when you explain what you want finished, then refine the generated flow." },
                  { id: "launcher-mini-app", title: "A workflow can also feel like an app", description: "Use custom UI to turn a workflow into a small interactive tool, not just a background automation." },
                  { id: "launcher-path", title: "Chat first, automate second", description: "A repeated task that works well in chat is often the next thing worth turning into a workflow." },
                ]}
              />
            </div>
          ) : activeView === "marketplace" ? (
            <div className="space-y-8 pb-12">
              {marketplaceLoading ? (
                <EmptyState d={d} icon={RefreshCw} title="Loading marketplace" description="Pulling featured workflows and community categories." spin />
              ) : marketplaceError ? (
                <EmptyState d={d} icon={Square} title="Marketplace unavailable" description={marketplaceError} />
              ) : (
                <>
                  <LauncherSection title="Featured Workflows">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {featuredRows.map((workflow) => (
                        <MarketplaceCard key={workflow.id} d={d} workflow={workflow} onClick={() => onMarketplace(workflow.slug)} />
                      ))}
                    </div>
                  </LauncherSection>
                  <LauncherSection title="More From The Community">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {communityRows.map((workflow) => (
                        <MarketplaceCard key={workflow.id} d={d} workflow={workflow} onClick={() => onMarketplace(workflow.slug)} compact />
                      ))}
                    </div>
                  </LauncherSection>
                  {communityRows.length === 0 && <EmptyState d={d} icon={Store} title="No workflows found" description="Try another search term or pick a different category." />}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
              {showCreateCard && (
                <div onClick={onCreate} className="group relative h-[200px] rounded-[24px] cursor-pointer overflow-hidden flex flex-col items-center justify-center transition-all border border-blue-500/50 bg-slate-900 hover:border-blue-400 shadow-md hover:shadow-lg">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180px] h-[180px] bg-blue-500/35 blur-[45px] rounded-full group-hover:bg-blue-400/45 transition-colors duration-500"></div>
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <Sparkles className="w-9 h-9 text-white mb-3 group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-white font-semibold text-[16px] tracking-wide">Create Workflow</span>
                  </div>
                </div>
              )}
              {visibleItems.map((item, idx) => (
                <WorkflowCard
                  key={item.id}
                  d={d}
                  item={item}
                  running={Boolean(runningIds[item.id] || deployStatuses[item.id]?.running)}
                  deployed={activeView === "deployed"}
                  highlighted={idx === selectedIndex}
                  updates={updates}
                  deployStatus={deployStatuses[item.id]}
                  actionLabel={activeView === "deployed" ? (Boolean(runningIds[item.id] || deployStatuses[item.id]?.running) ? "Stop" : "Start") : undefined}
                  actionBusy={activeView === "deployed" ? Boolean(busyMap[`${Boolean(runningIds[item.id] || deployStatuses[item.id]?.running) ? "stop" : "run"}:${item.id}`]) : false}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onOpen={() => onSelect(item.id)}
                  onDelete={activeView === "deployed" ? undefined : async () => {
                    if (!confirm(`Delete \"${item.name || item.id}\"?`)) return;
                    await onDelete(item.id);
                  }}
                  onAction={activeView === "deployed"
                    ? Boolean(runningIds[item.id] || deployStatuses[item.id]?.running)
                      ? (onStop ? () => executeAction(`stop:${item.id}`, () => onStop(item.id)) : undefined)
                      : (onRun ? () => executeAction(`run:${item.id}`, () => onRun(item.id)) : undefined)
                    : undefined}
                />
              ))}
              {!loading && visibleItems.length === 0 && (
                <EmptyState
                  d={d}
                  icon={activeView === "shared" ? Share2 : Layers}
                  title={activeView === "shared" ? "No shared workflows yet" : "No workflows found"}
                  description={activeView === "shared" ? "Import something from the marketplace to populate this section." : "Try adjusting your search or create a new workflow."}
                />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function LauncherSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="text-[18px] font-semibold wf-fg">{title}</div>
      {children}
    </section>
  );
}

function SideNavItem({ d, icon: Icon, label, active, disabled, onClick, accent }: { d: boolean; icon: any; label: string; active?: boolean; disabled?: boolean; onClick?: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[16px] transition-all group text-left ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${d ? active ? "bg-white/[0.08] text-white font-semibold" : accent ? "text-indigo-300 hover:bg-white/[0.06] hover:text-indigo-200" : "text-white/60 hover:bg-white/[0.06] hover:text-white" : active ? "bg-slate-100 text-slate-900 font-semibold shadow-sm" : accent ? "text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${d ? active ? "text-white" : accent ? "text-indigo-300" : "text-white/40 group-hover:text-white/70" : active ? "text-slate-800" : accent ? "text-indigo-500" : "text-slate-400 group-hover:text-slate-600"}`} />
      <span className="text-[14px] tracking-wide">{label}</span>
    </button>
  );
}

function FilterChip({ d, label, icon: Icon, active, onClick }: { d: boolean; label: string; icon?: any; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 px-5 py-2.5 rounded-[12px] border text-[13px] font-medium transition-all shrink-0 ${active ? "border-blue-500 text-blue-500 shadow-sm" : d ? "border-white/[0.08] text-white/50 hover:bg-white/[0.04] hover:border-white/[0.12] hover:text-white/80" : "border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 hover:text-slate-900 hover:shadow-sm"}`}
    >
      {Icon ? <Icon className={`w-4 h-4 ${active ? "text-blue-500" : d ? "text-white/30" : "text-slate-400"}`} /> : null}
      <span>{label}</span>
    </button>
  );
}

function WorkflowCard({ d, item, running, deployed, highlighted, updates, deployStatus, actionLabel, actionBusy, onMouseEnter, onOpen, onDelete, onAction }: { d: boolean; item: WorkflowItem; running: boolean; deployed?: boolean; highlighted?: boolean; updates: Record<string, MarketplaceUpdate>; deployStatus?: DeployStatus; actionLabel?: string; actionBusy?: boolean; onMouseEnter?: () => void; onOpen?: () => void; onDelete?: () => Promise<void> | void; onAction?: () => void }) {
  const update = item.marketplaceSlug ? updates[item.marketplaceSlug] : null;
  const nameLen = (item.name || item.id).length;
  const iconColor = nameLen % 3 === 0 ? "text-purple-500" : nameLen % 2 === 0 ? "text-amber-500" : "text-emerald-500";
  return (
    <div
      onClick={onOpen}
      onMouseEnter={onMouseEnter}
      className={`group relative p-6 rounded-[24px] border shadow-sm hover:shadow-md transition-all flex flex-col h-[200px] cursor-pointer ${highlighted ? "border-blue-500/40 ring-4 ring-blue-500/10" : "hover:border-blue-500/20"}`}
      style={{
        background: highlighted ? (d ? "rgba(255,255,255,0.06)" : "#ffffff") : "var(--wf-bg-elevated)",
        borderColor: highlighted ? undefined : "var(--wf-border)",
      }}
    >
      <div className="flex items-center gap-3.5 mb-4">
        {running ? (
          <Play className="w-5 h-5 text-emerald-500 fill-current shrink-0" />
        ) : (
          <Activity className={`w-[22px] h-[22px] shrink-0 ${iconColor}`} />
        )}
        <h3 className="font-semibold text-[17px] truncate flex items-center gap-1.5 leading-none wf-fg">
          {item.name || item.id}
          {item.locked ? <Lock className="w-4 h-4 text-amber-500 shrink-0" /> : null}
          {item.marketplaceSlug && !item.locked ? <Globe className="w-4 h-4 shrink-0 wf-fg-faint" /> : null}
        </h3>
      </div>

      <p className="text-[14px] line-clamp-3 flex-1 leading-relaxed pr-2 wf-fg-muted">
        {item.description || "Automate tasks and connect your apps seamlessly with this workflow."}
      </p>

      <div className="mt-auto flex items-center justify-between pt-4 border-t" style={{ borderColor: "var(--wf-border)" }}>
        <div className="flex items-center gap-1.5 text-[13px] font-medium wf-fg-faint flex-wrap">
          {running ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-500">Running now</span>
            </>
          ) : deployed ? (
            <>
              <div className={`w-1.5 h-1.5 rounded-full ${deployStatus?.running ? "bg-emerald-500" : "bg-blue-500"}`} />
              <span className={deployStatus?.running ? "text-emerald-500" : "text-blue-500"}>{deployStatus?.running ? "Auto-running" : "Deployed"}</span>
            </>
          ) : item.updatedAt ? (
            <span>Modified {formatRelativeTime(item.updatedAt)}</span>
          ) : (
            <span>{update ? `Update v${update.latestVersion}` : "Ready"}</span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {deployed && onAction ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={(e) => {
                e.stopPropagation();
                onAction();
              }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${actionBusy ? "opacity-60" : ""} ${running ? d ? "text-red-300 hover:text-red-200 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50" : d ? "text-blue-300 hover:text-blue-200 hover:bg-blue-500/10" : "text-blue-600 hover:bg-blue-50"}`}
            >
              {actionBusy ? "Working..." : actionLabel}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                await onDelete();
              }}
              className={`p-1.5 rounded-lg transition-colors ${d ? "text-white/40 hover:text-red-400 hover:bg-red-500/10" : "text-slate-400 hover:text-red-600 hover:bg-red-50"}`}
              title="Delete Workflow"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MarketplaceCard({ d, workflow, onClick, compact }: { d: boolean; workflow: MarketplaceWorkflow; onClick: () => void; compact?: boolean }) {
  const cover = workflow.thumbnail_url || workflow.cover_image_url;
  const creatorName = workflow.creator?.display_name || workflow.publisher_name || "Community";
  return (
    <button type="button" onClick={onClick} className={`overflow-hidden rounded-[24px] border text-left shadow-sm transition-all hover:-translate-y-1 ${d ? "bg-white/[0.03] border-white/10 hover:border-blue-400/30" : "bg-white border-slate-200 hover:border-blue-300"}`}>
      <div className={`relative ${compact ? "aspect-[16/9]" : "aspect-[16/10]"} overflow-hidden ${d ? "bg-slate-900" : "bg-slate-100"}`}>
        {cover ? (
          <img src={cover} alt={workflow.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 text-white">
            <Store className="w-10 h-10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute left-4 right-4 bottom-4 text-white">
          <div className="text-[18px] font-semibold leading-tight line-clamp-1">{workflow.name}</div>
          <div className="mt-1 text-[13px] text-white/80 line-clamp-2">{workflow.short_description || workflow.description}</div>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-[14px] font-semibold truncate ${d ? "text-white" : "text-slate-900"}`}>{creatorName}</div>
            <div className={`text-[12px] truncate ${d ? "text-white/50" : "text-slate-500"}`}>{workflow.category || "General"}</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${d ? "bg-white/[0.04] text-white/70" : "bg-slate-100 text-slate-600"}`}>v{workflow.version}</span>
        </div>
        <div className={`flex items-center justify-between text-[12px] ${d ? "text-white/55" : "text-slate-500"}`}>
          <span className="inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />{workflow.download_count}</span>
          <span className="inline-flex items-center gap-1.5"><Star className="w-3.5 h-3.5" />{workflow.rating_count ? Number(workflow.rating_avg).toFixed(1) : "New"}</span>
          <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{new Date(workflow.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ d, icon: Icon, title, description, spin }: { d: boolean; icon: any; title: string; description: string; spin?: boolean }) {
  return (
    <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
      <div className={`w-16 h-16 shadow-sm rounded-full flex items-center justify-center mb-4 border ${d ? "bg-white/[0.03] border-white/10" : "bg-white border-slate-200"}`}>
        <Icon className={`w-7 h-7 ${spin ? "animate-spin text-blue-500" : d ? "text-white/50" : "text-slate-400"}`} />
      </div>
      <h3 className={`text-[16px] font-semibold ${d ? "text-white" : "text-slate-900"}`}>{title}</h3>
      <p className={`text-[14px] mt-1 max-w-md ${d ? "text-white/55" : "text-slate-500"}`}>{description}</p>
    </div>
  );
}
