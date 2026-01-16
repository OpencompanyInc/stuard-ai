import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Search,
  Trash2,
  X,
  Archive,
  Pin,
  StickyNote,
  Calendar,
  Shield
} from 'lucide-react';
import { Pinboard } from './memories/Pinboard';
import { StickyNotes } from './memories/StickyNotes';
import { TimelineJourney } from './memories/TimelineJourney';
import { SecuritySettings } from './memories/SecuritySettings';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

type MemoriesTab = 'topics' | 'notes' | 'timeline' | 'security';

interface Entity {
  id: string;
  name: string;
  type: string;
  summary: string;
  created_at: string;
  vector?: number[];
}

interface Fact {
  id: string;
  entity_id?: string;
  category: string;
  subtype: string;
  attribute_key?: string;
  text: string;
  created_at: string;
  validity: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPICS TAB (Formerly Pinboard)
// ═══════════════════════════════════════════════════════════════════════════════

function TopicsTab() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [links, setLinks] = useState<{ source: string, target: string, value: number }[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [entityFacts, setEntityFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadGraph = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/knowledge/graph?limit=200&threshold=0.65`);
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.nodes)) setEntities(data.nodes);
        if (Array.isArray(data.edges)) setLinks(data.edges);
      }
    } catch (e) {
      console.error('Failed to load graph:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadEntityFacts = async (entityName: string) => {
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/knowledge/entities/${encodeURIComponent(entityName)}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.facts)) {
        setEntityFacts(data.facts);
      }
    } catch (e) {
      console.error('Failed to load entity facts:', e);
    }
  };

  const handleDeleteEntity = async (id: string) => {
    if (!confirm('Delete this entity and all its linked facts?')) return;
    try {
      await fetch(`${AGENT_HTTP}/v1/knowledge/entities/${id}`, { method: 'DELETE' });
      setEntities(prev => prev.filter(e => e.id !== id));
      if (selectedEntity?.id === id) {
        setSelectedEntity(null);
        setEntityFacts([]);
      }
    } catch (e) {
      console.error('Failed to delete entity:', e);
    }
  };

  const handleDeleteFact = async (factId: string) => {
    try {
      await fetch(`${AGENT_HTTP}/v1/knowledge/facts/${factId}`, { method: 'DELETE' });
      setEntityFacts(prev => prev.filter(f => f.id !== factId));
    } catch (e) {
      console.error('Failed to delete fact:', e);
    }
  };

  useEffect(() => { loadGraph(); }, []);

  useEffect(() => {
    if (selectedEntity) {
      loadEntityFacts(selectedEntity.name);
    }
  }, [selectedEntity]);

  const filteredEntities = entities.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full gap-0 overflow-hidden bg-transparent">
      {/* Sidebar: Details Panel (Left or Right) */}
      <div className={clsx(
        "w-[420px] flex flex-col border-r border-theme/10 shadow-2xl z-20 transition-all duration-500 ease-in-out relative backdrop-blur-3xl bg-theme-bg/80",
        selectedEntity ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 w-0 overflow-hidden"
      )}>
        {selectedEntity && (
          <div className="h-full flex flex-col min-w-[26rem]">
            {/* Header Area - Premium Space */}
            <div className="p-8 pb-6 bg-gradient-to-b from-theme-card/50 to-transparent border-b border-theme/5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-3xl text-theme-fg font-stuard leading-tight tracking-tight">
                    {selectedEntity.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary text-[10px] font-black uppercase tracking-wider border border-primary/20">
                      {selectedEntity.type}
                    </span>
                    <span className="text-[10px] text-theme-muted font-bold tracking-widest opacity-50 font-mono">
                      NID:{selectedEntity.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedEntity(null)}
                  className="p-2.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-xl transition-all active:scale-90"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {selectedEntity.summary && (
                <div className="mt-6 relative">
                  <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary/20 rounded-full" />
                  <p className="text-[13px] text-theme-muted leading-relaxed italic opacity-80 pl-2">
                    {selectedEntity.summary}
                  </p>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8 pt-2 custom-scrollbar space-y-8">
              <div className="flex items-center justify-between mb-4 sticky top-0 bg-theme-bg/90 backdrop-blur-md py-4 z-10 border-b border-theme/5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  <h4 className="text-[10px] font-black text-theme-muted uppercase tracking-[0.25em]">
                    Connected Neurons ({entityFacts.length})
                  </h4>
                </div>
                <button
                  onClick={() => handleDeleteEntity(selectedEntity.id)}
                  className="text-[9px] font-bold text-red-500/70 hover:text-red-500 uppercase tracking-widest flex items-center gap-2 transition-all hover:translate-x-1"
                >
                  <Trash2 className="w-3 h-3" /> Purge Sector
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 relative pb-12">
                {entityFacts.map((fact, idx) => (
                  <div
                    key={fact.id}
                    className={clsx(
                      "group relative p-6 transition-all duration-300 hover:translate-y-[-4px] border border-theme/10 rounded-2xl bg-theme-card/40 backdrop-blur-sm shadow-sm hover:shadow-xl hover:shadow-black/5",
                      idx % 2 === 0 ? "rotate-[0.5deg]" : "-rotate-[0.5deg]"
                    )}
                  >
                    {/* Visual Anchor Effect */}
                    <div className="absolute -top-3 left-8 w-px h-6 bg-gradient-to-b from-red-500/0 via-red-500/40 to-red-500/60 z-10" />
                    <div className="absolute -top-4 left-[31px] w-1.5 h-1.5 rounded-full bg-red-600 shadow-lg shadow-red-500/50 z-20 transition-transform group-hover:scale-125" />

                    <div className="relative">
                      <span className="text-sm text-theme-fg font-medium leading-relaxed block mb-4 font-stuard opacity-90 group-hover:opacity-100 transition-opacity">
                        {fact.text}
                      </span>
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-theme/5">
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-1 rounded-full bg-primary/40" />
                          <span className="text-[9px] text-theme-muted uppercase tracking-[0.2em] font-black opacity-50">
                            {fact.subtype}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteFact(fact.id)}
                          className="opacity-0 group-hover:opacity-100 p-2 text-theme-muted hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all active:scale-90"
                          title="Prune Connection"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {entityFacts.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 opacity-30">
                    <Archive className="w-12 h-12 mb-4" />
                    <p className="text-xs font-black uppercase tracking-widest text-center">
                      No Data Connected To This Node
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Graph Area */}
      <div className="flex-1 relative h-full flex flex-col">
        {/* Search Bar Floating */}
        <div className="absolute top-4 left-4 z-10 w-64">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted group-focus-within:text-theme-fg transition-colors" />
            <input
              type="text"
              placeholder="Search Knowledge..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-theme-card/80 backdrop-blur-md border border-theme rounded-xl shadow-lg focus:outline-none focus:border-primary/30 text-theme-fg placeholder:text-theme-muted transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="h-full flex items-center justify-center text-neutral-500">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-2 border-neutral-700 border-t-white rounded-full animate-spin" />
                <span className="text-sm">Mapping Knowledge...</span>
              </div>
            </div>
          ) : (
            <Pinboard
              entities={filteredEntities}
              links={links}
              onSelectEntity={setSelectedEntity}
              selectedEntity={selectedEntity}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function NotesTab() {
  const [notes, setNotes] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const [identityRes, bioRes, directivesRes] = await Promise.all([
        fetch(`${AGENT_HTTP}/v1/knowledge/identity`),
        fetch(`${AGENT_HTTP}/v1/knowledge/bio?limit=50`),
        fetch(`${AGENT_HTTP}/v1/knowledge/directives`),
      ]);
      const [identityData, bioData, directivesData] = await Promise.all([
        identityRes.json(),
        bioRes.json(),
        directivesRes.json(),
      ]);

      const allNotes: Fact[] = [];
      if (identityData.ok) allNotes.push(...(identityData.facts || []));
      if (bioData.ok) allNotes.push(...(bioData.facts || []));
      if (directivesData.ok) allNotes.push(...(directivesData.facts || []));

      setNotes(allNotes);
    } catch (e) {
      console.error('Failed to load notes:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (text: string, type: 'bio' | 'instruction') => {
    try {
      const endpoint = type === 'instruction'
        ? `${AGENT_HTTP}/v1/knowledge/instructions`
        : `${AGENT_HTTP}/v1/knowledge/facts`;

      const body = type === 'instruction'
        ? { text: text.trim() }
        : { category: 'personal', subtype: 'bio', text: text.trim(), source: 'user_manual' };

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      loadNotes();
    } catch (e) {
      console.error('Failed to add:', e);
    }
  };

  const handleDelete = async (id: string, type: string) => {
    try {
      await fetch(`${AGENT_HTTP}/v1/knowledge/facts/${id}`, { method: 'DELETE' });
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  };

  useEffect(() => { loadNotes(); }, []);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-neutral-500">Loading notes...</div>;
  }

  return <StickyNotes notes={notes} onAdd={handleAdd} onDelete={handleDelete} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE TAB
// ═══════════════════════════════════════════════════════════════════════════════

function TimelineTab() {
  const [events, setEvents] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/knowledge/events?limit=100`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.facts)) {
        setEvents(data.facts);
      }
    } catch (e) {
      console.error('Failed to load events:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (factId: string) => {
    try {
      await fetch(`${AGENT_HTTP}/v1/knowledge/facts/${factId}`, { method: 'DELETE' });
      setEvents(prev => prev.filter(f => f.id !== factId));
    } catch (e) {
      console.error('Failed to delete event:', e);
    }
  };

  useEffect(() => { loadEvents(); }, []);

  if (loading) {
    return <div className="h-full flex items-center justify-center text-neutral-500">Loading timeline...</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-theme-bg">
      <TimelineJourney events={events} onDelete={handleDelete} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function MemoriesView() {
  const [activeTab, setActiveTab] = useState<MemoriesTab>('topics');

  const tabs: { id: MemoriesTab; label: string; icon: any }[] = [
    { id: 'topics', label: 'Neural Map', icon: Pin },
    { id: 'notes', label: 'Stickies', icon: StickyNote },
    { id: 'timeline', label: 'Chronology', icon: Calendar },
    { id: 'security', label: 'Privacy', icon: Shield },
  ];

  return (
    <div className="flex flex-col h-full bg-theme-bg/50 backdrop-blur-3xl overflow-hidden">
      {/* Tab Navigation Header */}
      <div className="flex-none px-10 py-5 border-b border-theme/10 flex items-center justify-between bg-theme-card/30 z-30 transition-all">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-black text-theme-fg tracking-tight font-stuard">Cognitive Hub</h1>
          <p className="text-[10px] text-theme-muted font-bold uppercase tracking-[0.2em] opacity-40">Persistence Layer</p>
        </div>

        <div className="flex gap-1.5 p-1.5 bg-theme-hover/40 rounded-2xl border border-theme/10 backdrop-blur-md">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex items-center gap-2.5 px-5 py-2 rounded-[14px] text-xs font-black transition-all duration-300",
                activeTab === tab.id
                  ? "bg-primary text-primary-fg shadow-lg shadow-primary/20 scale-105"
                  : "text-theme-muted hover:text-theme-fg hover:bg-theme-active/50 opacity-60 hover:opacity-100"
              )}
            >
              <tab.icon className={clsx("w-3.5 h-3.5", activeTab === tab.id ? "animate-pulse" : "")} />
              <span className="tracking-wide uppercase font-black">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden relative">
        <div className={clsx(
          "absolute inset-0 transition-all duration-500 ease-in-out transform",
          activeTab === 'topics' ? "opacity-100 z-10 translate-y-0" : "opacity-0 z-0 pointer-events-none translate-y-4"
        )}>
          <TopicsTab />
        </div>

        <div className={clsx(
          "absolute inset-0 transition-all duration-500 ease-in-out transform",
          activeTab === 'notes' ? "opacity-100 z-10 translate-y-0" : "opacity-0 z-0 pointer-events-none translate-y-4"
        )}>
          {activeTab === 'notes' && <NotesTab />}
        </div>

        <div className={clsx(
          "absolute inset-0 transition-all duration-500 ease-in-out transform",
          activeTab === 'timeline' ? "opacity-100 z-10 translate-y-0" : "opacity-0 z-0 pointer-events-none translate-y-4"
        )}>
          {activeTab === 'timeline' && <TimelineTab />}
        </div>

        <div className={clsx(
          "absolute inset-0 transition-all duration-500 ease-in-out transform overflow-auto",
          activeTab === 'security' ? "opacity-100 z-10 translate-y-0" : "opacity-0 z-0 pointer-events-none translate-y-4"
        )}>
          {activeTab === 'security' && <SecuritySettings />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPICS TAB INTERNAL POLISH
// ═══════════════════════════════════════════════════════════════════════════════
// I'll update the layout of TopicsTab within the same file below.

