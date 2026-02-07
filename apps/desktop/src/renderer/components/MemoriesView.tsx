import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Search,
  Pin,
  StickyNote,
  Calendar,
  Shield,
} from 'lucide-react';

import { TopicsView } from './memories/TopicsView';
import { StickyNotes } from './memories/StickyNotes';
import { TimelineJourney } from './memories/TimelineJourney';
import { SecuritySettings } from './memories/SecuritySettings';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

type MemoriesTab = 'topics' | 'notes' | 'timeline' | 'security';

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
// TOPICS TAB (Drawers)
// ═══════════════════════════════════════════════════════════════════════════════

function TopicsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerStats, setDrawerStats] = useState({ count: 0 });

  return (
    <div className="flex flex-col h-full relative overflow-hidden" style={{ background: 'linear-gradient(180deg, #F5F0E8 0%, #EDE6DA 40%, #E8E0D0 100%)' }}>
      {/* Search Header */}
      <div className="flex-none px-10 py-5 z-20" style={{ background: 'rgba(237, 230, 218, 0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(139, 115, 85, 0.12)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors" style={{ color: '#8B7355' }} />
            <input
              type="text"
              placeholder="Search drawers..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 text-sm rounded-xl shadow-sm focus:outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(139, 115, 85, 0.15)', color: '#5C4530' }}
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8B7355', opacity: 0.6 }}>
              <span>{drawerStats.count} Drawers</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <TopicsView 
          searchQuery={searchQuery} 
          onStatsChange={setDrawerStats}
        />
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
