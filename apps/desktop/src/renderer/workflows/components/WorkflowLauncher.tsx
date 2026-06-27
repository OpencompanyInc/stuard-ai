/**
 * WorkflowLauncher - Full-screen launcher shown when no workflow is selected.
 * Provides search, recent workflows list, quick actions, and Skills management.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Search, Play, Trash2, Sparkles, Lock, Globe,
  LayoutGrid, Rocket, Store, Activity, ChevronsUpDown, Layers,
  SlidersHorizontal, Tv, Box, Mic, Settings, ArrowDownCircle, Wand2
} from "lucide-react";
import { DiscoverTips } from "./DiscoverTips";
import {
  Skill, SKILL_COLORS, SkillsLibrary, SkillEditor,
  formatRelativeTime
} from "./Skills";
import { useWorkflowTheme } from "../WorkflowThemeContext";

type ActiveView = 'workflows' | 'skills' | 'deployed';

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

interface WorkflowLauncherProps {
  items: WorkflowItem[];
  loading: boolean;
  runningIds: Record<string, boolean>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: () => void;
  onDelete: (id: string) => Promise<void>;
  onDashboard?: () => void;
}

export function WorkflowLauncher({
  items, loading, runningIds,
  onSelect, onCreate, onImport, onMarketplace, onDelete
}: WorkflowLauncherProps) {
  const { isDark } = useWorkflowTheme();
  const d = isDark; // shorthand
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>('workflows');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillSearch, setSkillSearch] = useState("");
  const [deployStatuses, setDeployStatuses] = useState<Record<string, DeployStatus>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const reloadSkills = useCallback(() => {
    window.desktopAPI?.skillsList?.().then((res) => {
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

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => (i.name || i.id).toLowerCase().includes(q));
  }, [items, search]);

  const deployedItems = useMemo(() => {
    const source = items.filter((item) => deployStatuses[item.id]?.deployed);
    if (!search.trim()) return source;
    const q = search.toLowerCase();
    return source.filter(i => (i.name || i.id).toLowerCase().includes(q));
  }, [deployStatuses, items, search]);

  const visibleWorkflowItems = activeView === 'deployed' ? deployedItems : filtered;

  useEffect(() => { setSelectedIndex(0); }, [filtered.length, deployedItems.length, activeView]);

  useEffect(() => {
    if (activeView !== 'deployed' || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        items.map(async (item) => {
          try {
            const status = await (window as any).desktopAPI?.workflowsGetDeployStatus?.(item.id);
            return [item.id, status?.ok ? {
              deployed: Boolean(status.deployed),
              running: Boolean(status.running),
              triggers: Array.isArray(status.triggers) ? status.triggers : [],
            } : { deployed: false, running: false, triggers: [] }] as const;
          } catch {
            return [item.id, { deployed: false, running: false, triggers: [] }] as const;
          }
        })
      );
      if (!cancelled) setDeployStatuses(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [activeView, items]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, visibleWorkflowItems.length - 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && visibleWorkflowItems.length > 0) {
      e.preventDefault();
      onSelect(visibleWorkflowItems[selectedIndex].id);
    }
  }, [visibleWorkflowItems, selectedIndex, onSelect]);

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

  const handleDeleteSkill = (id: string) => {
    if (!confirm('Delete this skill?')) return;
    window.desktopAPI?.skillsDelete?.(id).catch(() => {});
    setSkills(skills.filter(s => s.id !== id));
  };

  const handleToggleSkill = (id: string) => {
    window.desktopAPI?.skillsToggle?.(id).catch(() => {});
    setSkills(skills.map(s => s.id === id ? { ...s, isActive: !s.isActive } : s));
  };

  if (editingSkill) {
    return <SkillEditor skill={editingSkill} onSave={handleSaveSkill} onCancel={() => setEditingSkill(null)} />;
  }

  return (
    <div className="flex-1 flex h-screen w-screen overflow-hidden font-sans wf-bg wf-fg">

      {/* Sidebar */}
      <div className="w-[300px] flex flex-col p-6 drag shrink-0 z-10 relative gap-5 border-r wf-border">

        {/* Header Card — always dark */}
        <div className="p-6 rounded-[20px] bg-slate-900 text-white no-drag shadow-lg relative overflow-hidden h-[120px] flex flex-col justify-center border border-slate-800 shrink-0">
          <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-40 h-40 bg-blue-500/40 rounded-full blur-[35px]"></div>
          <h2 className="text-[18px] font-bold tracking-tight relative z-10">Stuard Studio</h2>
          <p className="text-[13px] text-slate-300 mt-1 relative z-10">All your workflows in one place</p>
        </div>

        {/* Nav */}
        <div className="rounded-[24px] p-3 flex-1 no-drag overflow-y-auto scrollbar-minimal shadow-sm border space-y-1 wf-bg-elevated wf-border">
          <NavItem d={d} icon={Layers} label="My Workflows" active={activeView === 'workflows'} onClick={() => setActiveView('workflows')} />
          <NavItem d={d} icon={Wand2} label="Skills" active={activeView === 'skills'} onClick={() => setActiveView('skills')} />
          <div className="h-px my-2" style={{ background: 'var(--wf-border)' }} />
          <NavItem d={d} icon={Rocket} label="Deployed Workflows" active={activeView === 'deployed'} onClick={() => setActiveView('deployed')} />
          <NavItem d={d} icon={Store} label="Marketplace" onClick={onMarketplace} accent="indigo" />
        </div>

        {/* Bottom */}
        <div className="rounded-[24px] p-3 no-drag shrink-0 shadow-sm border space-y-1 wf-bg-elevated wf-border">
          <NavItem d={d} icon={ArrowDownCircle} label="Import Workflow" onClick={onImport} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden no-drag wf-bg">

        {/* Top Header */}
        <div className="px-10 pt-10 pb-8 flex items-start justify-between shrink-0">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight wf-fg">
              {activeView === 'workflows' ? 'My Workflows' : activeView === 'skills' ? 'Skills' : 'Deployed Workflows'}
            </h1>
            <div className="flex items-center gap-1.5 text-[14px] mt-2 cursor-pointer transition-colors w-fit rounded-md wf-fg-muted">
              <span>Your Workspace</span>
              <ChevronsUpDown className="w-4 h-4" />
            </div>
          </div>

          <div className="relative w-72 group mt-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 wf-fg-faint group-focus-within:text-blue-500 transition-colors" />
            <input
              ref={inputRef}
              type="text"
              placeholder={activeView === 'skills' ? 'Search skills...' : activeView === 'deployed' ? 'Search deployed workflows...' : 'Search workflows...'}
              value={activeView === 'skills' ? skillSearch : search}
              onChange={(e) => activeView === 'skills' ? setSkillSearch(e.target.value) : setSearch(e.target.value)}
              onKeyDown={activeView === 'skills' ? undefined : handleKeyDown}
              className="w-full rounded-full pl-11 pr-4 py-3 text-[14px] focus:outline-none focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/15 transition-all border shadow-sm"
              style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
            />
          </div>
        </div>

        {/* Filter Chips */}
        {activeView === 'workflows' && (
          <div className="px-10 flex gap-3 overflow-x-auto shrink-0 pb-8 scrollbar-minimal">
             <FilterChip d={d} label="All" icon={LayoutGrid} active />
             <FilterChip d={d} label="Productivity" icon={SlidersHorizontal} />
             <FilterChip d={d} label="Organization" icon={Box} />
             <FilterChip d={d} label="Voice & Audio" icon={Mic} />
             <FilterChip d={d} label="Research" icon={Search} />
             <FilterChip d={d} label="Utility" icon={Settings} />
             <FilterChip d={d} label="Media" icon={Tv} />
          </div>
        )}

        {/* Grid Area */}
        {activeView === 'skills' ? (
          <SkillsLibrary
            skills={skills}
            search={skillSearch}
            onSearchChange={setSkillSearch}
            onCreateSkill={handleCreateSkill}
            onEditSkill={setEditingSkill}
            onDeleteSkill={handleDeleteSkill}
            onToggleSkill={handleToggleSkill}
          />
        ) : (
          <div className="flex-1 px-10 pb-10 overflow-y-auto scrollbar-minimal">
            {loading ? (
              <div className="py-12 max-w-2xl mx-auto flex flex-col items-center gap-5">
                <div className={`w-8 h-8 border-2 rounded-full animate-spin ${d ? 'border-white/10 border-t-blue-400' : 'border-slate-200 border-t-blue-500'}`} />
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
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">

              {/* Create Card — always dark */}
              {activeView === 'workflows' && !search && (
                <div onClick={onCreate} className="group relative h-[200px] rounded-[24px] cursor-pointer overflow-hidden flex flex-col items-center justify-center transition-all border border-blue-500/50 bg-slate-900 hover:border-blue-400 shadow-md hover:shadow-lg">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180px] h-[180px] bg-blue-500/35 blur-[45px] rounded-full group-hover:bg-blue-400/45 transition-colors duration-500"></div>
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <Sparkles className="w-9 h-9 text-white mb-3 group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-white font-semibold text-[16px] tracking-wide">Create Workflow</span>
                  </div>
                </div>
              )}

              {/* Item Cards */}
              {visibleWorkflowItems.map((item, idx) => {
                const isRunning = runningIds[item.id];
                const isHighlighted = idx === selectedIndex;
                const deployStatus = deployStatuses[item.id];
                const nameLen = (item.name || item.id).length;
                const iconColor = nameLen % 3 === 0 ? "text-purple-500" : nameLen % 2 === 0 ? "text-amber-500" : "text-emerald-500";

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`group relative p-6 rounded-[24px] border shadow-sm hover:shadow-md transition-all flex flex-col h-[200px] cursor-pointer ${
                      isHighlighted
                        ? "border-blue-500/40 ring-4 ring-blue-500/10"
                        : "hover:border-blue-500/20"
                    }`}
                    style={{
                      background: isHighlighted ? (d ? 'rgba(255,255,255,0.06)' : '#ffffff') : 'var(--wf-bg-elevated)',
                      borderColor: isHighlighted ? undefined : 'var(--wf-border)',
                    }}
                  >
                    <div className="flex items-center gap-3.5 mb-4">
                      {isRunning ? (
                        <Play className="w-5 h-5 text-emerald-500 fill-current shrink-0" />
                      ) : (
                        <Activity className={`w-[22px] h-[22px] shrink-0 ${iconColor}`} />
                      )}
                      <h3 className="font-semibold text-[17px] truncate flex items-center gap-1.5 leading-none wf-fg">
                        {item.name || item.id}
                        {item.locked && <Lock className="w-4 h-4 text-amber-500 shrink-0" />}
                        {item.marketplaceSlug && !item.locked && <Globe className="w-4 h-4 shrink-0 wf-fg-faint" />}
                      </h3>
                    </div>

                    <p className="text-[14px] line-clamp-3 flex-1 leading-relaxed pr-2 wf-fg-muted">
                      {item.description || "Automate tasks and connect your apps seamlessly with this workflow."}
                    </p>

                    <div className="mt-auto flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--wf-border)' }}>
                      <div className="flex items-center gap-1.5 text-[13px] font-medium wf-fg-faint">
                        {isRunning ? (
                           <><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-emerald-500">Running now</span></>
                        ) : activeView === 'deployed' ? (
                           <><div className={`w-1.5 h-1.5 rounded-full ${deployStatus?.running ? 'bg-emerald-500' : 'bg-blue-500'}`} /><span className={deployStatus?.running ? 'text-emerald-500' : 'text-blue-500'}>{deployStatus?.running ? 'Auto-running' : 'Deployed'}</span></>
                        ) : item.updatedAt ? (
                           <span>Modified {formatRelativeTime(item.updatedAt)}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={async (e) => { e.stopPropagation(); if (!confirm(`Delete "${item.name || item.id}"?`)) return; await onDelete(item.id); }}
                          className={`p-1.5 rounded-lg transition-colors ${d ? 'text-white/40 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                          title="Delete Workflow"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty states */}
              {visibleWorkflowItems.length === 0 && search && (
                <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 shadow-sm rounded-full flex items-center justify-center mb-4 border wf-bg-elevated wf-border">
                    <Search className="w-7 h-7 wf-fg-faint" />
                  </div>
                  <h3 className="text-[16px] font-semibold wf-fg">No {activeView === 'deployed' ? 'deployed workflows' : 'workflows'} found</h3>
                  <p className="text-[14px] mt-1 wf-fg-muted">Try adjusting your search query</p>
                </div>
              )}

              {activeView === 'deployed' && visibleWorkflowItems.length === 0 && !search && !loading && (
                <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 shadow-sm rounded-full flex items-center justify-center mb-4 border wf-bg-elevated wf-border">
                    <Rocket className="w-7 h-7 text-blue-500" />
                  </div>
                  <h3 className="text-[16px] font-semibold wf-fg">No deployed workflows yet</h3>
                  <p className="text-[14px] mt-1 max-w-md wf-fg-muted">Deploy a workflow from the editor and it will show up here for quick access.</p>
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick, accent, d }: {
  icon: any; label: string; active?: boolean; onClick?: () => void; accent?: 'default' | 'indigo'; d?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[16px] transition-all group ${
        d
          ? active ? "bg-white/[0.08] text-white font-semibold"
            : accent === 'indigo' ? "text-indigo-400 hover:bg-white/[0.06] hover:text-indigo-300"
            : "text-white/60 hover:bg-white/[0.06] hover:text-white"
          : active ? "bg-slate-100/90 text-slate-900 font-semibold shadow-sm"
            : accent === 'indigo' ? "text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-5 h-5 transition-colors ${
        d
          ? active ? "text-white" : accent === 'indigo' ? "text-indigo-400" : "text-white/40 group-hover:text-white/70"
          : active ? "text-slate-800" : accent === 'indigo' ? "text-indigo-500" : "text-slate-400 group-hover:text-slate-600"
      }`} />
      <span className="text-[14px] tracking-wide">{label}</span>
    </button>
  );
}

function FilterChip({ label, icon: Icon, active, d }: {
  label: string; icon?: any; active?: boolean; d?: boolean;
}) {
  return (
    <button className={`flex items-center gap-2.5 px-5 py-2.5 rounded-[12px] border text-[13px] font-medium transition-all shrink-0 ${
      active
        ? "border-blue-500 text-blue-500 shadow-sm"
        : d
          ? "border-white/[0.08] text-white/50 hover:bg-white/[0.04] hover:border-white/[0.12] hover:text-white/80"
          : "border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 hover:text-slate-900 hover:shadow-sm"
    }`}>
      {Icon && <Icon className={`w-4 h-4 ${active ? "text-blue-500" : d ? "text-white/30" : "text-slate-400"}`} />}
      <span>{label}</span>
    </button>
  );
}
