import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  Search,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { TopicsView } from './memories/TopicsView';
import { StickyNotes } from './memories/StickyNotes';
import { MemoryLockGate } from './MemoryLockGate';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

type MemoriesTab = 'topics' | 'notes';

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

function TopicsTab({ refreshNonce }: { refreshNonce: number }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerStats, setDrawerStats] = useState({ count: 0 });

  const drawerLabel = `${drawerStats.count} ${drawerStats.count === 1 ? 'Drawer' : 'Drawers'}`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div className="flex-none px-4 py-4 md:px-6 md:py-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight text-theme-fg">{drawerLabel}</h2>
          </div>

          <div className="relative w-full max-w-[160px] md:max-w-[170px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-muted" />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-2xl border border-theme bg-theme-card pl-11 pr-4 text-sm text-theme-fg shadow-sm outline-none transition-all placeholder:text-theme-muted focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2 md:px-3 md:pb-3">
        <TopicsView
          searchQuery={searchQuery}
          onStatsChange={setDrawerStats}
          refreshNonce={refreshNonce}
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

  const handleDelete = async (id: string, _type: string) => {
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
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function MemoriesView() {
  return (
    <MemoryLockGate label="Memories Locked">
      <MemoriesContent />
    </MemoryLockGate>
  );
}

function MemoriesContent() {
  const [activeTab, setActiveTab] = useState<MemoriesTab>('topics');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const tabs: { id: MemoriesTab; label: string }[] = [
    { id: 'topics', label: 'Collections' },
    { id: 'notes', label: 'My Context' },
  ];

  return (
    <div className="relative h-full px-5 pb-5 pt-6 md:px-6 md:pb-6 md:pt-7" data-onboarding="memories-view">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-[32px] bg-theme-bg/70 shadow-sm backdrop-blur-xl">
        <div className="flex-none px-6 py-6 md:px-8 md:py-8">
          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-theme-fg md:text-[1.65rem]">Memories</h1>
                <div className="flex items-center gap-2 text-[13px] text-theme-muted">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>Review and organize the information Stuard uses to personalize your experience.</span>
                </div>
              </div>

              <button
                onClick={() => setRefreshNonce(value => value + 1)}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-theme bg-theme-card px-4 text-sm font-medium text-theme-fg shadow-sm transition-all hover:bg-theme-hover"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="flex justify-center">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-theme bg-theme-hover/70 p-1 shadow-sm">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      'memory-mode-tab rounded-full px-5 py-2.5 text-sm font-medium transition-all',
                      activeTab === tab.id
                        ? 'memory-mode-tab-active bg-theme-bg text-theme-fg shadow-sm'
                        : 'text-theme-muted hover:bg-theme-card hover:text-theme-fg'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-4 pb-4 md:px-6 md:pb-6">
          <div className="relative h-full overflow-hidden rounded-[28px] bg-transparent">
            <div className={clsx(
              'absolute inset-0 transition-all duration-300 ease-out',
              activeTab === 'topics' ? 'translate-y-0 opacity-100 z-10' : 'pointer-events-none translate-y-3 opacity-0 z-0'
            )}>
              <TopicsTab refreshNonce={refreshNonce} />
            </div>

            <div className={clsx(
              'absolute inset-0 transition-all duration-300 ease-out',
              activeTab === 'notes' ? 'translate-y-0 opacity-100 z-10' : 'pointer-events-none translate-y-3 opacity-0 z-0'
            )}>
              {activeTab === 'notes' && <NotesTab key={`notes-${refreshNonce}`} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
