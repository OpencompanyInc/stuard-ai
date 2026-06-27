import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  Activity,
  Bot,
  Box,
  Calendar,
  CheckCircle2,
  ChevronsUpDown,
  Compass,
  Download,
  ExternalLink,
  Home,
  LayoutGrid,
  Layers,
  Lock,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Share2,
  Square,
  Star,
  Store,
  Trash2,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { BotsView } from "../../components/BotsView";
import { CustomToolsView } from "./CustomToolsView";
import { StudioHome } from "./StudioHome";
import { confirmDialog } from "./ConfirmDialog";
import { DiscoverTips } from "./DiscoverTips";
import {
  formatRelativeTime,
  SkillsLibrary,
  SkillEditor,
  SKILL_COLORS,
  PublishSkillModal,
  type Skill,
} from "./Skills";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import type { WorkflowItem } from "../types";
import { getValidAccessToken } from "../../auth/authManager";
import {
  getMarketplaceApi,
  type MarketplaceCategory,
  type MarketplaceUpdate,
  type MarketplaceWorkflow,
} from "../../utils/cloud";
import {
  buildWorkflowFilterChips,
  matchesWorkflowFilter,
  matchesWorkflowSearch,
  type WorkflowDeployStatus,
  type WorkflowLauncherFilterId,
  type WorkflowLauncherScope,
} from "../utils/workflowLauncherFilters";

type ActiveView = "home" | "workflows" | "agents" | "tools" | "marketplace" | "skills";
/** Views accepted as deep-link inputs; "deployed"/"shared" resolve to Workflows + a preselected filter. */
type InitialView = ActiveView | "deployed" | "shared";
type DeployStatus = WorkflowDeployStatus;

/** Resolve an incoming deep-link view to an active view + optional preselected workflow filter. */
function resolveInitialView(view: InitialView): { view: ActiveView; filter: WorkflowLauncherFilterId } {
  if (view === "deployed") return { view: "workflows", filter: "deployed" };
  if (view === "shared") return { view: "workflows", filter: "shared" };
  return { view, filter: "all" };
}
type MarketplaceContentType = "all" | "workflows" | "skills" | "functions";

const MARKETPLACE_CONTENT_TYPES: Array<{ id: MarketplaceContentType; label: string; icon: any; description: string; tint: string; tintDark: string }> = [
  { id: "all",       label: "All",        icon: LayoutGrid, description: "Everything across the community", tint: "text-slate-700",  tintDark: "text-white/80" },
  { id: "workflows", label: "Workflows",  icon: Layers,     description: "Multi-step automations & flows",  tint: "text-slate-700",  tintDark: "text-white/80" },
  { id: "skills",    label: "Skills",     icon: Wand2,      description: "Reusable agent behaviors",         tint: "text-violet-700", tintDark: "text-violet-300" },
  { id: "functions", label: "Functions",  icon: Box,        description: "Single-node building blocks",      tint: "text-amber-700",  tintDark: "text-amber-300" },
];

interface WorkflowLauncherV2Props {
  items: WorkflowItem[];
  loading: boolean;
  runningIds: Record<string, boolean>;
  updates?: Record<string, MarketplaceUpdate>;
  initialView?: InitialView;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: (slug?: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRun?: (id: string) => Promise<void>;
  onStop?: (id: string) => Promise<void>;
  onShowPublished?: () => void;
  onDashboard?: () => void;
  onReplayTour?: () => void;
  onIntegrationBuilder?: (seedManifest?: any) => void;
}

export function WorkflowLauncherV2({
  items,
  loading,
  runningIds,
  updates = {},
  initialView = "home",
  onSelect,
  onCreate,
  onImport,
  onMarketplace,
  onDelete,
  onRun,
  onStop,
  onShowPublished,
  onDashboard,
  onReplayTour,
  onIntegrationBuilder,
}: WorkflowLauncherV2Props) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<ActiveView>(() => resolveInitialView(initialView).view);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowLauncherFilterId>(() => resolveInitialView(initialView).filter);
  const [deployStatuses, setDeployStatuses] = useState<Record<string, DeployStatus>>({});
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState("all");
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceWorkflow[]>([]);
  const [featuredItems, setFeaturedItems] = useState<MarketplaceWorkflow[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSearch, setSkillSearch] = useState("");
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [publishingSkill, setPublishingSkill] = useState<Skill | null>(null);
  const [marketplaceContentType, setMarketplaceContentType] = useState<MarketplaceContentType>("all");

  const reloadSkills = useCallback(() => {
    window.desktopAPI?.skillsList?.().then((res: any) => {
      if (res?.ok && Array.isArray(res.skills)) setSkills(res.skills as Skill[]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    reloadSkills();
    return window.desktopAPI?.onSkillsUpdated?.((nextSkills: any[]) => {
      if (Array.isArray(nextSkills)) setSkills(nextSkills as Skill[]);
      else reloadSkills();
    });
  }, [reloadSkills]);

  useEffect(() => {
    if (!initialView) return;
    const resolved = resolveInitialView(initialView);
    setActiveView(resolved.view);
    if (resolved.view === "workflows") setWorkflowFilter(resolved.filter);
  }, [initialView]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeView]);

  const currentSearchValue =
    activeView === "marketplace" ? marketplaceSearch : activeView === "skills" ? skillSearch : search;

  const setCurrentSearchValue = useCallback(
    (value: string) => {
      if (activeView === "marketplace") {
        setMarketplaceSearch(value);
        return;
      }
      if (activeView === "skills") {
        setSkillSearch(value);
        return;
      }
      setSearch(value);
    },
    [activeView]
  );

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
    if (activeView !== "workflows") return;
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
        const contentCategory =
          marketplaceContentType === "skills" ? "skills"
          : marketplaceContentType === "functions" ? "functions"
          : null;
        const effectiveCategory =
          contentCategory ?? (marketplaceCategory === "all" ? null : marketplaceCategory);
        if (!marketplaceSearch.trim() && !effectiveCategory) {
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
            category: effectiveCategory || undefined,
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
  }, [activeView, marketplaceCategory, marketplaceContentType, marketplaceSearch]);

  const workflowScope: WorkflowLauncherScope = "workflows";

  const searchedWorkflowItems = useMemo(
    () => items.filter((item) => matchesWorkflowSearch(item, search, deployStatuses[item.id])),
    [deployStatuses, items, search]
  );

  const workflowFilterChips = useMemo(
    () =>
      buildWorkflowFilterChips(searchedWorkflowItems, {
        scope: workflowScope,
        deployStatuses,
        runningIds,
      }),
    [deployStatuses, runningIds, searchedWorkflowItems, workflowScope]
  );

  const visibleItems = useMemo(
    () =>
      searchedWorkflowItems.filter((item) =>
        matchesWorkflowFilter(
          item,
          workflowFilter,
          deployStatuses[item.id],
          Boolean(runningIds[item.id] || deployStatuses[item.id]?.running)
        )
      ),
    [deployStatuses, runningIds, searchedWorkflowItems, workflowFilter]
  );

  const selectedItem = activeView === "workflows"
    ? visibleItems[Math.min(selectedIndex, Math.max(visibleItems.length - 1, 0))] || null
    : null;

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeView, marketplaceCategory, marketplaceSearch, search, skillSearch, visibleItems.length, workflowFilter]);

  useEffect(() => {
    if (activeView !== "workflows") return;
    // Only drop stale dynamic trigger filters when their chip disappears. Stable
    // filters (all/deployed/shared/triggered) persist even when their chip is
    // momentarily hidden (e.g. deep-linking to "deployed" before statuses load).
    if (!workflowFilter.startsWith("trigger:")) return;
    if (!workflowFilterChips.some((chip) => chip.id === workflowFilter)) {
      setWorkflowFilter("all");
    }
  }, [activeView, workflowFilter, workflowFilterChips]);

  const handleCreateSkill = () => {
    const newSkill: Skill = {
      id: `skill_${Date.now()}`,
      name: 'New Skill',
      description: 'Describe what this skill does...',
      icon: 'Wand2',
      color: SKILL_COLORS[Math.floor(Math.random() * SKILL_COLORS.length)],
      trigger: 'When the user asks to...',
      steps: [{ id: `step_${Date.now()}`, type: 'prompt', label: 'Step 1', content: 'Enter instructions here...' }],
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingSkill(newSkill);
  };

  const handleSaveSkill = (skill: Skill) => {
    const updated = { ...skill, updatedAt: new Date().toISOString() };
    window.desktopAPI?.skillsSave?.(updated).catch(() => {});
    const exists = skills.find(s => s.id === skill.id);
    if (exists) {
      setSkills(skills.map(s => s.id === skill.id ? updated : s));
    } else {
      setSkills([...skills, updated]);
    }
    setEditingSkill(null);
  };

  const handleDeleteSkill = async (id: string) => {
    const skill = skills.find(s => s.id === id);
    const ok = await confirmDialog({
      title: `Delete ${skill?.name ? `“${skill.name}”` : "this skill"}?`,
      message: "Stuard will no longer use this skill. This can’t be undone.",
      confirmLabel: "Delete skill",
      tone: "danger",
    });
    if (!ok) return;
    window.desktopAPI?.skillsDelete?.(id).catch(() => {});
    setSkills(skills.filter(s => s.id !== id));
  };

  const handleToggleSkill = (id: string) => {
    window.desktopAPI?.skillsToggle?.(id).catch(() => {});
    setSkills(skills.map(s => s.id === id ? { ...s, isActive: !s.isActive } : s));
  };

  const handleApproveSkill = (skill: Skill) => {
    const approved: Skill = {
      ...skill,
      isActive: true,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...(skill.metadata || {}),
        approvedAt: new Date().toISOString(),
      },
    };
    window.desktopAPI?.skillsSave?.(approved).catch(() => {});
    setSkills(prev => prev.map(s => s.id === skill.id ? approved : s));
  };

  const handlePublishSkill = (skill: Skill) => {
    setPublishingSkill(skill);
  };

  const handleConfirmPublishSkill = useCallback(
    async (data: { name: string; shortDescription: string; description: string; category: string; tags: string[]; changelog?: string }) => {
      if (!publishingSkill) return { ok: false, error: "no_skill" };
      const target = publishingSkill;
      const existingSlug = target.metadata?.marketplaceSlug as string | undefined;
      const isUpdate = Boolean(existingSlug && target.metadata?.publishStatus === 'published');
      const persistStatus = (status: 'published' | 'failed', extras: Record<string, any>) => {
        const now = new Date().toISOString();
        const updated: Skill = {
          ...target,
          updatedAt: now,
          metadata: {
            ...(target.metadata || {}),
            publishStatus: status,
            lastPublishAttempt: now,
            ...extras,
          },
        };
        window.desktopAPI?.skillsSave?.(updated).catch(() => {});
        setSkills(prev => prev.map(s => s.id === updated.id ? updated : s));
      };
      try {
        const token = await getValidAccessToken().catch(() => null);
        const api = getMarketplaceApi(() => token || null);
        const spec = { type: "skill", skill: target };

        if (isUpdate && existingSlug) {
          const res = await api.update(existingSlug, {
            name: data.name,
            description: data.description,
            shortDescription: data.shortDescription,
            spec,
            category: data.category,
            tags: data.tags,
            icon: target.icon,
            changelog: data.changelog,
          }) as any;
          if (res.ok) {
            persistStatus('published', {
              publishedAt: new Date().toISOString(),
              marketplaceSlug: res.workflow?.slug || existingSlug,
              publishedVersion: res.workflow?.version,
              publishedCategory: data.category,
              publishedTags: data.tags,
              lastPublishError: null,
            });
          } else {
            persistStatus('failed', { lastPublishError: res.error || 'Failed to update' });
          }
          return res;
        }

        const res = await api.publish({
          name: data.name,
          description: data.description,
          shortDescription: data.shortDescription,
          spec,
          category: data.category,
          tags: data.tags,
          icon: target.icon,
        });
        if (res.ok) {
          persistStatus('published', {
            publishedAt: new Date().toISOString(),
            marketplaceSlug: res.workflow?.slug,
            publishedVersion: res.workflow?.version || '1',
            publishedCategory: data.category,
            publishedTags: data.tags,
            lastPublishError: null,
          });
        } else {
          persistStatus('failed', {
            lastPublishError: res.error || 'Failed to publish',
          });
        }
        return res;
      } catch (e: any) {
        const errorMsg = e?.message || (isUpdate ? 'update_failed' : 'publish_failed');
        persistStatus('failed', { lastPublishError: errorMsg });
        return { ok: false, error: errorMsg };
      }
    },
    [publishingSkill]
  );

  const executeAction = useCallback(
    async (key: string, action?: () => Promise<void>) => {
      if (!action) return;
      setBusyMap((prev) => ({ ...prev, [key]: true }));
      try {
        await action();
      } finally {
        setBusyMap((prev) => ({ ...prev, [key]: false }));
        if (activeView === "workflows") {
          await refreshDeployStatuses();
        }
      }
    },
    [activeView, refreshDeployStatuses]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (activeView !== "workflows") return;
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

  const contentTypeFilteredItems = useMemo(() => {
    if (marketplaceContentType === "workflows") {
      return marketplaceItems.filter((item) => item.category !== "skills" && item.category !== "functions");
    }
    if (marketplaceContentType === "skills") {
      return marketplaceItems.filter((item) => item.category === "skills");
    }
    if (marketplaceContentType === "functions") {
      return marketplaceItems.filter((item) => item.category === "functions");
    }
    return marketplaceItems;
  }, [marketplaceContentType, marketplaceItems]);

  const contentTypeFilteredFeatured = useMemo(() => {
    if (marketplaceContentType === "workflows") {
      return featuredItems.filter((item) => item.category !== "skills" && item.category !== "functions");
    }
    if (marketplaceContentType === "skills") {
      return featuredItems.filter((item) => item.category === "skills");
    }
    if (marketplaceContentType === "functions") {
      return featuredItems.filter((item) => item.category === "functions");
    }
    return featuredItems;
  }, [marketplaceContentType, featuredItems]);

  const featuredRows = useMemo(() => {
    if (marketplaceSearch.trim() || marketplaceCategory !== "all") return contentTypeFilteredItems.slice(0, 3);
    return contentTypeFilteredFeatured;
  }, [contentTypeFilteredFeatured, contentTypeFilteredItems, marketplaceCategory, marketplaceSearch]);

  const communityRows = useMemo(() => {
    if (marketplaceSearch.trim() || marketplaceCategory !== "all") return contentTypeFilteredItems;
    const featuredIds = new Set(contentTypeFilteredFeatured.map((item) => item.id));
    const rest = contentTypeFilteredItems.filter((item) => !featuredIds.has(item.id));
    return rest.length ? rest : contentTypeFilteredItems;
  }, [contentTypeFilteredFeatured, contentTypeFilteredItems, marketplaceCategory, marketplaceSearch]);

  const workflowFiltersActive = search.trim().length > 0 || workflowFilter !== "all";

  const title =
    activeView === "skills"
      ? "Skills"
      : activeView === "marketplace"
      ? "Marketplace"
      : "My Workflows";

  const subtitle =
    activeView === "skills"
      ? `${skills.length} skill${skills.length !== 1 ? "s" : ""} · ${skills.filter(s => s.isActive).length} active`
      : activeView === "marketplace"
      ? "Discover community-built automations with theme-aware browsing."
      : workflowFiltersActive
      ? `${visibleItems.length} shown · ${items.length} workflows in your workspace`
      : `${items.length} workflows in your workspace`;

  const workspaceLabel = activeView === "marketplace" ? "Community Library" : "Your Workspace";
  const showCreateCard = activeView === "workflows" && !search.trim() && workflowFilter === "all";
  const getWorkflowFilterIcon = (filterId: WorkflowLauncherFilterId) => {
    switch (filterId) {
      case "all":
        return LayoutGrid;
      case "triggered":
        return Zap;
      case "shared":
        return Share2;
      case "deployed":
        return Rocket;
      case "running":
        return Play;
      case "idle":
        return Square;
      default:
        return undefined;
    }
  };

  if (editingSkill) {
    return (
      <>
        <SkillEditor
          skill={editingSkill}
          onSave={handleSaveSkill}
          onCancel={() => setEditingSkill(null)}
          onPublish={handlePublishSkill}
        />
        {publishingSkill && (
          <PublishSkillModal
            skill={publishingSkill}
            onClose={() => setPublishingSkill(null)}
            onConfirm={handleConfirmPublishSkill}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden wf-bg wf-fg font-sans">
      <aside className="w-[300px] shrink-0 border-r border-theme-sidebar p-6 flex flex-col gap-5 drag">
        <div className="wf-card relative h-[120px] overflow-hidden rounded-[20px] p-6 no-drag">
          <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 h-40 w-40 rounded-full blur-[38px]" style={{ background: "color-mix(in srgb, var(--wf-accent) 50%, transparent)" }} />
          <div className="relative z-10 text-[18px] font-bold tracking-tight wf-fg">Stuard Studio</div>
          <div className="relative z-10 mt-1 text-[13px] wf-fg-muted">Everything you build</div>
        </div>

        <div className="rounded-[24px] p-3 flex-1 no-drag overflow-y-auto scrollbar-minimal shadow-sm border border-theme-sidebar space-y-1 wf-bg-elevated">
          <SideNavItem d={d} active={activeView === "home"} icon={Home} label="Home" onClick={() => setActiveView("home")} />

          <SideNavGroupLabel d={d} label="Create" />
          <SideNavItem d={d} active={activeView === "workflows"} icon={Layers} label="My Workflows" onClick={() => setActiveView("workflows")} />
          <SideNavItem d={d} active={activeView === "agents"} icon={Bot} label="Agents" onClick={() => setActiveView("agents")} />
          <SideNavItem d={d} active={activeView === "skills"} icon={Wand2} label="Skills" onClick={() => setActiveView("skills")} />
          <SideNavItem d={d} active={activeView === "tools"} icon={Plug} label="Custom Tools" onClick={() => setActiveView("tools")} />

          <SideNavGroupLabel d={d} label="Discover" />
          <SideNavItem d={d} active={activeView === "marketplace"} icon={Store} label="Marketplace" onClick={() => setActiveView("marketplace")} accent />

          <div className="h-px my-2 bg-[color:var(--sidebar-border)]" />
          <SideNavItem d={d} icon={ExternalLink} label="Stuard Dashboard" onClick={onDashboard} />
          {onReplayTour && (
            <SideNavItem d={d} icon={Compass} label="Take the tour" onClick={onReplayTour} />
          )}
        </div>

        {activeView === "workflows" && (
          <div className="rounded-[24px] p-3 no-drag shrink-0 shadow-sm border border-theme-sidebar space-y-1 wf-bg-elevated">
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
        )}
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden no-drag">
        {activeView === "home" ? (
          <StudioHome
            items={items}
            skillsCount={skills.length}
            onOpenView={(v) => setActiveView(v)}
            onCreate={onCreate}
            onSelect={onSelect}
            onMarketplace={() => setActiveView("marketplace")}
          />
        ) : activeView === "agents" ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-10 pt-10 pb-2"><BotsView /></div>
        ) : activeView === "tools" ? (
          <CustomToolsView
            onNewTool={() => onIntegrationBuilder?.()}
            onEditTool={(manifest) => onIntegrationBuilder?.(manifest)}
          />
        ) : (
        <>
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
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 wf-fg-faint group-focus-within:text-[color:var(--wf-accent)] transition-colors" />
              <input
                ref={inputRef}
                type="text"
                value={currentSearchValue}
                onChange={(e) => setCurrentSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeView === "skills"
                    ? "Search skills..."
                    : activeView === "marketplace"
                      ? marketplaceContentType === "skills" ? "Search community skills..."
                        : marketplaceContentType === "functions" ? "Search functions & nodes..."
                        : marketplaceContentType === "workflows" ? "Search workflows..."
                        : "Search marketplace..."
                      : "Search workflows, descriptions, or triggers..."
                }
                className="wf-input w-full rounded-full pl-11 pr-11 py-3 text-[14px] focus:outline-none transition-all shadow-sm"
              />
              {currentSearchValue.trim() && (
                <button
                  type="button"
                  onClick={() => setCurrentSearchValue("")}
                  className={`absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 transition-colors ${d ? "text-white/45 hover:bg-white/10 hover:text-white/80" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              disabled={!selectedItem || activeView === "marketplace" || activeView === "skills"}
              onClick={() => selectedItem ? onSelect(selectedItem.id) : undefined}
              className={`rounded-[14px] border px-4 py-3 text-[13px] font-medium transition-all ${!selectedItem || activeView === "marketplace" || activeView === "skills" ? "opacity-40 cursor-not-allowed" : ""} ${d ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.06]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-2">
                <ExternalLink className="w-4 h-4" />
                Manage
              </span>
            </button>
          </div>
        </div>

        {activeView === "marketplace" && (
          <div className="px-10 shrink-0 pb-3">
            <MarketplaceTypeSegmentedControl
              d={d}
              value={marketplaceContentType}
              onChange={setMarketplaceContentType}
            />
          </div>
        )}

        {activeView !== "skills" && <div className="px-10 flex gap-3 overflow-x-auto shrink-0 pb-8 scrollbar-minimal">
          {activeView === "marketplace" ? (
            <>
              <FilterChip d={d} active={marketplaceCategory === "all"} label="All Categories" icon={LayoutGrid} onClick={() => setMarketplaceCategory("all")} />
              {categories.map((category) => (
                <FilterChip key={category.id} d={d} active={marketplaceCategory === category.id} label={category.name} onClick={() => setMarketplaceCategory(category.id)} />
              ))}
            </>
          ) : (
            <>
              {workflowFilterChips.map((chip) => (
                <FilterChip
                  key={chip.id}
                  d={d}
                  label={chip.label}
                  count={chip.count}
                  icon={getWorkflowFilterIcon(chip.id)}
                  active={workflowFilter === chip.id}
                  onClick={() => setWorkflowFilter(chip.id)}
                />
              ))}
            </>
          )}
        </div>}

        <div className="flex-1 overflow-y-auto px-10 pb-10 scrollbar-minimal">
          {activeView === "skills" ? (
            <SkillsLibrary
              skills={skills}
              search={skillSearch}
              onSearchChange={setSkillSearch}
              onCreateSkill={handleCreateSkill}
              onEditSkill={setEditingSkill}
              onDeleteSkill={handleDeleteSkill}
              onToggleSkill={handleToggleSkill}
              onApproveSkill={handleApproveSkill}
              onPublishSkill={handlePublishSkill}
            />
          ) : activeView !== "marketplace" && loading ? (
            <div className="py-12 max-w-2xl mx-auto flex flex-col items-center gap-5">
              <div className={`w-8 h-8 border-2 rounded-full animate-spin border-[color:var(--wf-border)] border-t-[color:var(--wf-accent)]`} />
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
                <EmptyState d={d} icon={RefreshCw} title="Loading marketplace" description="Pulling featured items and community categories." spin />
              ) : marketplaceError ? (
                <EmptyState d={d} icon={Square} title="Marketplace unavailable" description={marketplaceError} />
              ) : (
                <>
                  <LauncherSection title={
                    marketplaceContentType === "skills" ? "Featured Skills"
                    : marketplaceContentType === "functions" ? "Featured Functions"
                    : marketplaceContentType === "workflows" ? "Featured Workflows"
                    : "Featured"
                  }>
                    {featuredRows.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {featuredRows.map((workflow) => (
                          <MarketplaceCard key={workflow.id} d={d} workflow={workflow} onClick={() => onMarketplace(workflow.slug)} />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        d={d}
                        icon={marketplaceContentType === "skills" ? Wand2 : marketplaceContentType === "functions" ? Box : Store}
                        title={
                          marketplaceContentType === "skills" ? "No skills published yet"
                          : marketplaceContentType === "functions" ? "No functions published yet"
                          : "Nothing featured yet"
                        }
                        description={
                          marketplaceContentType === "skills"
                            ? "Be the first to share a skill — open Skills and hit Publish on any card."
                            : marketplaceContentType === "functions"
                            ? "Functions are single-node building blocks. Publish one from any workflow with the Publish button."
                            : "Check back soon for featured items."
                        }
                      />
                    )}
                  </LauncherSection>
                  <LauncherSection title="More From The Community">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {communityRows.map((workflow) => (
                        <MarketplaceCard key={workflow.id} d={d} workflow={workflow} onClick={() => onMarketplace(workflow.slug)} compact />
                      ))}
                    </div>
                  </LauncherSection>
                  {communityRows.length === 0 && featuredRows.length === 0 && (
                    <EmptyState
                      d={d}
                      icon={marketplaceContentType === "skills" ? Wand2 : marketplaceContentType === "functions" ? Box : Store}
                      title={
                        marketplaceContentType === "skills" ? "No skills found"
                        : marketplaceContentType === "functions" ? "No functions found"
                        : "No workflows found"
                      }
                      description="Try another search term or pick a different category."
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
              {showCreateCard && (
                <button
                  type="button"
                  onClick={onCreate}
                  className="wf-feature-tile group relative h-[200px] rounded-[24px] cursor-pointer overflow-hidden flex flex-col items-center justify-center"
                >
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <span className="wf-feature-tile__icon mb-3 flex h-12 w-12 items-center justify-center rounded-[14px]">
                      <Plus className="w-6 h-6" strokeWidth={1.75} />
                    </span>
                    <span className="wf-fg font-semibold text-[16px] tracking-wide">Create Workflow</span>
                    <span className="wf-fg-muted text-[12.5px] mt-1">Start from a blank canvas</span>
                  </div>
                </button>
              )}
              {visibleItems.map((item, idx) => {
                const isDeployed = Boolean(deployStatuses[item.id]?.deployed);
                const isRunning = Boolean(runningIds[item.id] || deployStatuses[item.id]?.running);
                return (
                  <WorkflowCard
                    key={item.id}
                    d={d}
                    item={item}
                    running={isRunning}
                    deployed={isDeployed}
                    highlighted={idx === selectedIndex}
                    updates={updates}
                    deployStatus={deployStatuses[item.id]}
                    actionLabel={isDeployed ? (isRunning ? "Stop" : "Start") : undefined}
                    actionBusy={isDeployed ? Boolean(busyMap[`${isRunning ? "stop" : "run"}:${item.id}`]) : false}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onOpen={() => onSelect(item.id)}
                    onDelete={isDeployed ? undefined : async () => {
                      const ok = await confirmDialog({
                        title: `Delete “${item.name || item.id}”?`,
                        message: "This permanently removes the workflow. This can’t be undone.",
                        confirmLabel: "Delete workflow",
                        tone: "danger",
                      });
                      if (!ok) return;
                      await onDelete(item.id);
                    }}
                    onAction={isDeployed
                      ? isRunning
                        ? (onStop ? () => executeAction(`stop:${item.id}`, () => onStop(item.id)) : undefined)
                        : (onRun ? () => executeAction(`run:${item.id}`, () => onRun(item.id)) : undefined)
                      : undefined}
                  />
                );
              })}
              {!loading && visibleItems.length === 0 && (
                <EmptyState
                  d={d}
                  icon={workflowFilter === "shared" ? Share2 : workflowFilter === "deployed" ? Rocket : Layers}
                  title={
                    workflowFilter === "shared" ? "No shared workflows found"
                    : workflowFilter === "deployed" ? "No deployed workflows found"
                    : "No workflows found"
                  }
                  description={
                    workflowFilter === "deployed"
                      ? "Deploy a workflow to run it automatically on its triggers."
                      : workflowFilter === "shared"
                      ? "Publish a workflow or import one from the marketplace to populate this filter."
                      : "Try adjusting your search or create a new workflow."
                  }
                />
              )}
            </div>
          )}
        </div>
        </>
        )}
      </main>

      {publishingSkill && !editingSkill && (
        <PublishSkillModal
          skill={publishingSkill}
          onClose={() => setPublishingSkill(null)}
          onConfirm={handleConfirmPublishSkill}
        />
      )}
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

function SideNavGroupLabel({ d, label }: { d: boolean; label: string }) {
  return (
    <div className={`px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider ${d ? "text-white/35" : "text-slate-400"}`}>
      {label}
    </div>
  );
}

function SideNavItem({ d, icon: Icon, label, active, disabled, onClick, accent }: { d: boolean; icon: any; label: string; active?: boolean; disabled?: boolean; onClick?: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[16px] transition-all group text-left ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${
        active
          ? d ? "bg-white/[0.08] text-white font-semibold" : "bg-slate-100 text-slate-900 font-semibold shadow-sm"
          : d ? "text-white/60 hover:bg-white/[0.06] hover:text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${
        active
          ? d ? "text-white" : "text-slate-800"
          : accent
            ? d ? "text-white/40 group-hover:text-[color:var(--wf-accent)]" : "text-slate-400 group-hover:text-[color:var(--wf-accent)]"
            : d ? "text-white/40 group-hover:text-white/70" : "text-slate-400 group-hover:text-slate-600"
      }`} />
      <span className="text-[14px] tracking-wide">{label}</span>
    </button>
  );
}

function FilterChip({ d, label, icon: Icon, active, onClick, count }: { d: boolean; label: string; icon?: any; active?: boolean; onClick?: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 px-5 py-2.5 rounded-[12px] border text-[13px] font-medium transition-all shrink-0 ${active ? d ? "border-white/15 bg-white/[0.08] text-white shadow-sm" : "border-slate-300 bg-white text-slate-900 shadow-sm" : d ? "border-theme-sidebar text-white/50 hover:bg-white/[0.04] hover:border-theme hover:text-white/80" : "border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 hover:text-slate-900 hover:shadow-sm"}`}
    >
      {Icon ? <Icon className={`w-4 h-4 ${active ? d ? "text-white" : "text-slate-800" : d ? "text-white/30" : "text-slate-400"}`} /> : null}
      <span>{label}</span>
      {typeof count === "number" ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? d ? "bg-white/[0.12] text-white" : "bg-slate-200 text-slate-700" : d ? "bg-white/[0.06] text-white/60" : "bg-slate-100 text-slate-500"}`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function WorkflowCard({ d, item, running, deployed, highlighted, updates, deployStatus, actionLabel, actionBusy, onMouseEnter, onOpen, onDelete, onAction }: { d: boolean; item: WorkflowItem; running: boolean; deployed?: boolean; highlighted?: boolean; updates: Record<string, MarketplaceUpdate>; deployStatus?: DeployStatus; actionLabel?: string; actionBusy?: boolean; onMouseEnter?: () => void; onOpen?: () => void; onDelete?: () => Promise<void> | void; onAction?: () => void }) {
  const update = item.marketplaceSlug ? updates[item.marketplaceSlug] : null;
  return (
    <div
      onClick={onOpen}
      onMouseEnter={onMouseEnter}
      className={`wf-card wf-card-interactive group relative p-6 rounded-[24px] flex flex-col h-[200px] cursor-pointer ${highlighted ? "wf-card-active" : ""}`}
    >
      <div className="flex items-center gap-3.5 mb-4">
        {running ? (
          <Play className="w-5 h-5 text-emerald-500 fill-current shrink-0" />
        ) : (
          <span className="wf-icon-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] transition-colors group-hover:text-[color:var(--wf-accent)]">
            <Activity className="w-[18px] h-[18px]" />
          </span>
        )}
        <h3 className="font-semibold text-[17px] truncate flex items-center gap-1.5 leading-none wf-fg">
          {item.name || item.id}
          {item.locked ? <Lock className="w-4 h-4 text-amber-500 shrink-0" /> : null}
        </h3>
        {item.marketplaceSlug ? (
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0 ${
              d ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
            title="Published to Marketplace"
          >
            <CheckCircle2 className="w-3 h-3" />
            Published
          </span>
        ) : null}
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
              <div className={`w-1.5 h-1.5 rounded-full ${deployStatus?.running ? "bg-emerald-500" : "bg-[color:var(--wf-fg-faint)]"}`} />
              <span className={deployStatus?.running ? "text-emerald-500" : "wf-fg-muted"}>{deployStatus?.running ? "Auto-running" : "Deployed"}</span>
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
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${actionBusy ? "opacity-60" : ""} ${running ? d ? "text-red-300 hover:text-red-200 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50" : "wf-fg-muted hover:text-[color:var(--wf-accent)] hover:bg-[var(--wf-accent-soft)]"}`}
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
  const isSkill = workflow.category === "skills";
  const isFunction = workflow.category === "functions";
  const FallbackIcon = isSkill ? Wand2 : isFunction ? Box : Store;
  const fallbackGradient = isSkill
    ? "from-violet-500 via-fuchsia-600 to-pink-600"
    : isFunction
      ? "from-amber-500 via-orange-600 to-rose-600"
      : "from-slate-600 via-slate-700 to-slate-900";
  return (
    <button type="button" onClick={onClick} className={`overflow-hidden rounded-[24px] border text-left shadow-sm transition-all hover:-translate-y-1 hover:border-[var(--wf-accent)] ${d ? "bg-white/[0.03] border-white/10" : "bg-white border-slate-200"}`}>
      <div className={`relative ${compact ? "aspect-[16/9]" : "aspect-[16/10]"} overflow-hidden ${d ? "bg-slate-900" : "bg-slate-100"}`}>
        {cover ? (
          <img src={cover} alt={workflow.name} className="h-full w-full object-cover" />
        ) : (
          <div className={`h-full w-full flex items-center justify-center bg-gradient-to-br ${fallbackGradient} text-white`}>
            <FallbackIcon className="w-10 h-10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        {(isSkill || isFunction) && (
          <span className={`absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm ${
            isSkill
              ? "bg-violet-500/30 text-violet-50 border border-violet-300/40"
              : "bg-amber-500/30 text-amber-50 border border-amber-300/40"
          }`}>
            <FallbackIcon className="w-2.5 h-2.5" />
            {isSkill ? "Skill" : "Function"}
          </span>
        )}
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
        <Icon className={`w-7 h-7 ${spin ? "animate-spin text-[color:var(--wf-accent)]" : d ? "text-white/50" : "text-slate-400"}`} />
      </div>
      <h3 className={`text-[16px] font-semibold ${d ? "text-white" : "text-slate-900"}`}>{title}</h3>
      <p className={`text-[14px] mt-1 max-w-md ${d ? "text-white/55" : "text-slate-500"}`}>{description}</p>
    </div>
  );
}

function MarketplaceTypeSegmentedControl({
  d,
  value,
  onChange,
}: {
  d: boolean;
  value: MarketplaceContentType;
  onChange: (type: MarketplaceContentType) => void;
}) {
  return (
    <div className={`inline-flex p-1 rounded-2xl border shadow-sm ${d ? "bg-white/[0.03] border-theme-sidebar" : "bg-slate-100/80 border-slate-200"}`}>
      {MARKETPLACE_CONTENT_TYPES.map((type) => {
        const Icon = type.icon;
        const isActive = value === type.id;
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onChange(type.id)}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-all ${
              isActive
                ? d
                  ? "bg-white/[0.10] text-white shadow-sm"
                  : "bg-white text-slate-900 shadow-sm border border-slate-200"
                : d
                  ? "text-white/55 hover:text-white/85"
                  : "text-slate-500 hover:text-slate-800"
            }`}
            title={type.description}
          >
            <Icon className={`w-4 h-4 ${isActive ? (d ? type.tintDark : type.tint) : ""}`} />
            <span>{type.label}</span>
          </button>
        );
      })}
    </div>
  );
}

