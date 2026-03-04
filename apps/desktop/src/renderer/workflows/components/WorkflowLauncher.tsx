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
import { 
  Skill, SKILL_COLORS, SkillsLibrary, SkillEditor,
  formatRelativeTime
} from "./Skills";

type ActiveView = 'workflows' | 'skills';

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

interface WorkflowLauncherProps {
  items: WorkflowItem[];
  loading: boolean;
  runningIds: Record<string, boolean>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: () => void;
  onDelete: (id: string) => Promise<void>;
  onDashboard: () => void;
}

export function WorkflowLauncher({
  items, loading, runningIds,
  onSelect, onCreate, onImport, onMarketplace, onDelete, onDashboard
}: WorkflowLauncherProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>('workflows');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillSearch, setSkillSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load skills from disk on mount
  useEffect(() => {
    window.desktopAPI?.skillsList?.().then((res) => {
      if (res?.ok && Array.isArray(res.skills)) setSkills(res.skills as Skill[]);
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => (i.name || i.id).toLowerCase().includes(q));
  }, [items, search]);


  // Reset selection when filter changes
  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  // Auto-focus search on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keyboard navigation (simplified 1D list over the 2D grid)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].id);
    }
  }, [filtered, selectedIndex, onSelect]);

  const handleCreateSkill = () => {
    const newSkill: Skill = {
      id: `skill_${Date.now()}`,
      name: 'New Skill',
      description: 'Describe what this skill does...',
      icon: 'Wand2',
      color: SKILL_COLORS[Math.floor(Math.random() * SKILL_COLORS.length)],
      trigger: 'When the user asks to...',
      steps: [
        { id: `step_${Date.now()}`, type: 'prompt', label: 'Step 1', content: 'Enter instructions here...' }
      ],
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

  // If editing a skill, show the skill editor
  if (editingSkill) {
    return <SkillEditor skill={editingSkill} onSave={handleSaveSkill} onCancel={() => setEditingSkill(null)} />;
  }

  return (
    <div className="flex-1 flex bg-[#F4F4F5] h-screen w-screen overflow-hidden text-white font-sans">
      
      {/* Sidebar - Now structured as 3 separate rounded containers */}
      <div className="w-[300px] flex flex-col p-6 drag shrink-0 z-10 relative gap-5 border-r border-slate-200/50">
        
        {/* Container 1: Header Card */}
        <div className="p-6 rounded-[20px] bg-slate-900 text-white no-drag shadow-lg relative overflow-hidden h-[120px] flex flex-col justify-center border border-slate-800 shrink-0">
          {/* Intense blue gradient match */}
          <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-40 h-40 bg-blue-500/40 rounded-full blur-[35px]"></div>
          <h2 className="text-[18px] font-bold tracking-tight relative z-10">Workflow Studio</h2>
          <p className="text-[13px] text-slate-300 mt-1 relative z-10">All your workflows in one place</p>
        </div>

        {/* Container 2: Nav items */}
        <div className="bg-white rounded-[24px] p-3 flex-1 no-drag overflow-y-auto scrollbar-minimal shadow-sm border border-slate-200/60 space-y-1">
          <NavItem icon={Layers} label="My Workflows" active={activeView === 'workflows'} onClick={() => setActiveView('workflows')} />
          <NavItem icon={Wand2} label="Skills" active={activeView === 'skills'} onClick={() => setActiveView('skills')} />
          <div className="h-px bg-slate-50 my-2" />
          <NavItem icon={Rocket} label="Deployed Workflows" />
          <NavItem icon={Store} label="Marketplace" onClick={onMarketplace} />
          <NavItem icon={LayoutGrid} label="Stuard Dashboard" onClick={onDashboard} />
        </div>

        {/* Container 3: Bottom Actions */}
        <div className="bg-white rounded-[24px] p-3 no-drag shrink-0 shadow-sm border border-slate-200/60 space-y-1">
          <NavItem icon={ArrowDownCircle} label="Import Workflow" onClick={onImport} />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden no-drag bg-[#F4F4F5]">
        
        {/* Top Header */}
        <div className="px-10 pt-10 pb-8 flex items-start justify-between shrink-0">
          <div>
            <h1 className="text-[26px] font-bold text-white tracking-tight">
              {activeView === 'workflows' ? 'My Workflows' : 'Skills'}
            </h1>
            <div className="flex items-center gap-1.5 text-[14px] text-slate-500 mt-2 cursor-pointer hover:text-slate-800 transition-colors w-fit rounded-md">
              <span>Your Workspace</span>
              <ChevronsUpDown className="w-4 h-4" />
            </div>
          </div>

          <div className="relative w-72 group mt-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input
              ref={inputRef}
              type="text"
              placeholder={activeView === 'workflows' ? 'Search workflows...' : 'Search skills...'}
              value={activeView === 'workflows' ? search : skillSearch}
              onChange={(e) => activeView === 'workflows' ? setSearch(e.target.value) : setSkillSearch(e.target.value)}
              onKeyDown={activeView === 'workflows' ? handleKeyDown : undefined}
              className="w-full bg-white border border-slate-200 focus:border-blue-400 rounded-full pl-11 pr-4 py-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100/50 transition-all shadow-sm"
            />
          </div>
        </div>

        {/* Filter Chips - Only show for workflows */}
        {activeView === 'workflows' && (
          <div className="px-10 flex gap-3 overflow-x-auto shrink-0 pb-8 scrollbar-minimal">
             <FilterChip label="All" icon={LayoutGrid} active />
             <FilterChip label="Productivity" icon={SlidersHorizontal} />
             <FilterChip label="Organization" icon={Box} />
             <FilterChip label="Voice & Audio" icon={Mic} />
             <FilterChip label="Research" icon={Search} />
             <FilterChip label="Utility" icon={Settings} />
             <FilterChip label="Media" icon={Tv} />
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
              <div className="py-12 flex justify-center">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
              </div>
            ) : (
            /* ==================== WORKFLOWS GRID ==================== */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
              
              {/* Create Card - Dark with prominent blue glow matching the image */}
              {!search && (
                <div 
                  onClick={onCreate}
                  className="group relative h-[200px] rounded-[24px] cursor-pointer overflow-hidden flex flex-col items-center justify-center transition-all border border-blue-500/50 bg-slate-900 hover:border-blue-400 shadow-md hover:shadow-lg"
                >
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[180px] h-[180px] bg-blue-500/35 blur-[45px] rounded-full group-hover:bg-blue-400/45 transition-colors duration-500"></div>
                  
                  <div className="relative z-10 flex flex-col items-center justify-center">
                    <Sparkles className="w-9 h-9 text-white mb-3 group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-white font-semibold text-[16px] tracking-wide">Create Workflow</span>
                  </div>
                </div>
              )}

              {/* Item Cards */}
              {filtered.map((item, idx) => {
                const isRunning = runningIds[item.id];
                const isHighlighted = idx === selectedIndex;
                
                // Color variation based on name length just for visual variety matching the image
                const nameLen = (item.name || item.id).length;
                const iconColor = nameLen % 3 === 0 ? "text-purple-500" : nameLen % 2 === 0 ? "text-amber-500" : "text-emerald-500";

                return (
                  <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`group relative p-6 rounded-[24px] bg-white border shadow-sm hover:shadow-md transition-all flex flex-col h-[200px] cursor-pointer ${
                      isHighlighted ? "border-blue-300 ring-4 ring-blue-100/50" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Icon and Title */}
                    <div className="flex items-center gap-3.5 mb-4">
                      {isRunning ? (
                        <Play className="w-5 h-5 text-emerald-500 fill-current shrink-0" />
                      ) : (
                        <Activity className={`w-[22px] h-[22px] shrink-0 ${iconColor}`} />
                      )}
                      
                      <h3 className="font-semibold text-slate-800 text-[17px] truncate flex items-center gap-1.5 leading-none">
                        {item.name || item.id}
                        {item.locked && <Lock className="w-4 h-4 text-amber-500 shrink-0" />}
                        {item.marketplaceSlug && !item.locked && <Globe className="w-4 h-4 text-slate-400 shrink-0" />}
                      </h3>
                    </div>

                    {/* Description */}
                    <p className="text-[14px] text-slate-500 line-clamp-3 flex-1 leading-relaxed pr-2">
                      {item.description || "Automate tasks and connect your apps seamlessly with this workflow."}
                    </p>

                    {/* Footer (Last run) */}
                    <div className="mt-auto flex items-center justify-between pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-[13px] text-slate-400 font-medium">
                        {isRunning ? (
                           <>
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                             <span className="text-emerald-600">Running now</span>
                           </>
                        ) : item.updatedAt ? (
                           <span>Modified {formatRelativeTime(item.updatedAt)}</span>
                        ) : null}
                      </div>
                      
                      {/* Actions Button */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete "${item.name || item.id}"?`)) return;
                            await onDelete(item.id);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Workflow"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty state */}
              {filtered.length === 0 && search && (
                <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-white shadow-sm rounded-full flex items-center justify-center mb-4 border border-slate-200">
                    <Search className="w-7 h-7 text-slate-400" />
                  </div>
                  <h3 className="text-[16px] font-semibold text-slate-800">No workflows found</h3>
                  <p className="text-[14px] text-slate-500 mt-1">Try adjusting your search query</p>
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

function NavItem({ 
  icon: Icon, 
  label, 
  active, 
  onClick 
}: { 
  icon: any, 
  label: string, 
  active?: boolean, 
  onClick?: () => void 
}) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[16px] transition-all group ${
        active 
          ? "bg-slate-100/80 text-white font-semibold" 
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <Icon className={`w-5 h-5 transition-colors ${
        active ? "text-slate-800" : "text-slate-400 group-hover:text-slate-600"
      }`} />
      <span className="text-[14px] tracking-wide">{label}</span>
    </button>
  );
}

function FilterChip({ 
  label, 
  icon: Icon, 
  active 
}: { 
  label: string, 
  icon?: any, 
  active?: boolean 
}) {
  return (
    <button className={`flex items-center gap-2.5 px-5 py-2.5 rounded-[12px] border text-[13px] font-medium transition-all shrink-0 ${
      active 
        ? "bg-transparent border-blue-600 text-blue-600 shadow-sm" 
        : "bg-transparent border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 hover:text-slate-900 hover:shadow-sm"
    }`}>
      {Icon && <Icon className={`w-4 h-4 ${active ? "text-blue-600" : "text-slate-400"}`} />}
      <span>{label}</span>
    </button>
  );
}


