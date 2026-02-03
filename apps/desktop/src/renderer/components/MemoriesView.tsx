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
  Shield,
  Loader2
} from 'lucide-react';

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
// TOPICS TAB (Formerly Neural Map)
// ═══════════════════════════════════════════════════════════════════════════════

function TopicsTab() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [entityFacts, setEntityFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadTopics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_HTTP}/v1/knowledge/graph?limit=200&threshold=0.65`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.nodes)) {
        setEntities(data.nodes);
      }
    } catch (e) {
      console.error('Failed to load topics:', e);
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

  useEffect(() => { loadTopics(); }, []);

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
    <div className="flex flex-col h-full relative overflow-hidden bg-transparent">
      {/* Search Header */}
      <div className="flex-none px-10 py-6 border-b border-theme/5 bg-theme-bg/30 backdrop-blur-md z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted group-focus-within:text-theme-fg transition-colors" />
            <input
              type="text"
              placeholder="Search Memories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 text-sm bg-theme-card/50 backdrop-blur-xl border border-theme/10 rounded-2xl shadow-sm focus:outline-none focus:border-primary/30 text-theme-fg placeholder:text-theme-muted transition-all"
            />
          </div>
          <div className="flex items-center gap-4 text-xs font-black uppercase tracking-widest text-theme-muted opacity-50">
            <span>{filteredEntities.length} Total Topics</span>
          </div>
        </div>
      </div>

      {/* Main Grid Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-10">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <span className="text-xs font-black tracking-[0.3em] uppercase opacity-30">Loading Memories</span>
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
              {filteredEntities.map((entity) => (
                <button
                  key={entity.id}
                  onClick={() => setSelectedEntity(entity)}
                  className={clsx(
                    "group relative p-8 rounded-[2.5rem] text-left transition-all duration-500 transform hover:-translate-y-3 hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] hover:shadow-primary/5",
                    "bg-theme-card/30 hover:bg-theme-card/60 border border-theme/10 hover:border-primary/20",
                    selectedEntity?.id === entity.id && "ring-2 ring-primary border-primary/40 bg-theme-card/60"
                  )}
                >
                  <div className="h-full flex flex-col justify-between gap-6">
                    <div>
                      <div className="w-14 h-14 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 group-hover:bg-primary/20">
                        <Pin className="w-7 h-7 text-primary" />
                      </div>
                      <h3 className="font-black text-2xl leading-tight font-stuard tracking-tight text-theme-fg group-hover:text-primary transition-colors">
                        {entity.name}
                      </h3>
                    </div>

                    <div className="space-y-4">
                      <p className="text-[13px] line-clamp-3 font-medium leading-relaxed text-theme-muted group-hover:text-theme-fg transition-colors">
                        {entity.summary || "No shared context found for this memory node."}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-theme-bg/50 text-theme-muted border border-theme/10 group-hover:border-primary/30 group-hover:text-primary transition-all">
                          {entity.type}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {filteredEntities.length === 0 && (
              <div className="py-40 flex flex-col items-center text-center opacity-20">
                <Archive className="w-20 h-20 mb-8" />
                <p className="text-xl font-black uppercase tracking-[0.3em]">No Memories Found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Topic Detail Modal */}
      {selectedEntity && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300"
          onClick={() => setSelectedEntity(null)}
        >
          {/* Backdrop Blur */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" />

          <div
            className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-theme-bg overflow-hidden rounded-[3rem] border border-theme shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] animate-in zoom-in-95 slide-in-from-bottom-10 duration-500"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex-none p-10 pb-6 bg-gradient-to-b from-theme-card/50 to-transparent border-b border-theme/5">
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="inline-flex items-center px-4 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-[0.2em] border border-primary/20">
                      {selectedEntity.type}
                    </span>
                  </div>
                  <h3 className="font-black text-5xl text-theme-fg font-stuard leading-tight tracking-tighter">
                    {selectedEntity.name}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedEntity(null)}
                  className="p-4 bg-theme-card/80 hover:bg-theme-hover border border-theme/10 text-theme-muted hover:text-theme-fg rounded-3xl transition-all hover:rotate-90 active:scale-95"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {selectedEntity.summary && (
                <div className="mt-8 relative max-w-2xl">
                  <div className="absolute -left-6 top-1 bottom-1 w-1.5 bg-primary/30 rounded-full" />
                  <p className="text-lg text-theme-muted font-medium leading-relaxed italic opacity-80 pl-2">
                    {selectedEntity.summary}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Content - Facts List */}
            <div className="flex-1 overflow-y-auto p-10 pt-4 custom-scrollbar">
              <div className="flex items-center justify-between mb-8 sticky top-0 bg-theme-bg/95 backdrop-blur-md py-4 z-10 border-b border-theme/5">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <h4 className="text-xs font-black text-theme-muted uppercase tracking-[0.3em]">
                    Associated Context ({entityFacts.length})
                  </h4>
                </div>
                <button
                  onClick={() => handleDeleteEntity(selectedEntity.id)}
                  className="text-[10px] font-black text-red-500/50 hover:text-red-500 uppercase tracking-widest flex items-center gap-2 transition-all p-2 hover:bg-red-500/5 rounded-xl"
                >
                  <Trash2 className="w-4 h-4" /> Delete Topic
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
                {entityFacts.map((fact) => (
                  <div
                    key={fact.id}
                    className="group relative p-8 transition-all duration-300 border border-theme/10 rounded-[2rem] bg-theme-card/20 hover:bg-theme-card/40 hover:scale-[1.02] shadow-sm"
                  >
                    <div className="relative">
                      <p className="text-[15px] text-theme-fg font-medium leading-relaxed mb-6 font-stuard opacity-90 group-hover:opacity-100 transition-opacity">
                        {fact.text}
                      </p>
                      <div className="flex items-center justify-between mt-auto pt-6 border-t border-theme/5">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                          <span className="text-[10px] text-theme-muted uppercase tracking-[0.25em] font-black opacity-40">
                            {fact.subtype}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteFact(fact.id)}
                          className="opacity-0 group-hover:opacity-100 p-2.5 text-theme-muted hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {entityFacts.length === 0 && (
                  <div className="col-span-full py-20 flex flex-col items-center opacity-20">
                    <Archive className="w-12 h-12 mb-4" />
                    <p className="text-xs font-black uppercase tracking-widest">No detailed facts found</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Shadow Gradient */}
            <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-theme-bg to-transparent pointer-events-none" />
          </div>
        </div>
      )}
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
    { id: 'topics', label: 'Topics', icon: Pin },
    { id: 'notes', label: 'Stickies', icon: StickyNote },
    { id: 'timeline', label: 'Chronology', icon: Calendar },
    { id: 'security', label: 'Privacy', icon: Shield },
  ];

  return (
    <div className="flex flex-col h-full bg-theme-bg/50 backdrop-blur-3xl overflow-hidden" data-onboarding="memories-view">
      <div className="flex-none px-10 py-5 border-b border-theme/10 flex items-center justify-between bg-theme-card/30 z-30 transition-all">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-black text-theme-fg tracking-tight font-stuard">Memories</h1>
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
