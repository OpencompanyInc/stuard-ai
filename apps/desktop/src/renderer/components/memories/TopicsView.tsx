import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { 
  ChevronDown,
  Loader2,
  FolderOpen,
  X
} from 'lucide-react';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import { createPortal } from 'react-dom';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

interface DrawerSegment {
  id: string;
  conversation_id: string;
  start_turn: number;
  end_turn: number | null;
  summary: string;
  topics: string[];
  created_at: string;
  updated_at: string;
}

interface DrawerCluster {
  id: string;
  title: string;
  count: number;
  segments: DrawerSegment[];
}

interface TopicDrawer {
  topic: string;
  count: number;
  clusters: DrawerCluster[];
  latest_at: string | null;
}

interface TopicsViewProps {
  searchQuery: string;
  onStatsChange?: (stats: { count: number }) => void;
  refreshNonce?: number;
}

function formatDrawerDate(value: string | null) {
  if (!value) return 'No recent activity';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(value));
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

// ----------------------------------------------------------------------------
// Pop-up on scroll wrapper
// ----------------------------------------------------------------------------

function PopUpOnScroll({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-30px 0px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40, scale: 0.94 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.94 }}
      transition={{ 
        delay, 
        duration: 0.45, 
        type: 'spring', 
        stiffness: 130, 
        damping: 18 
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Components
// ----------------------------------------------------------------------------

export function TopicsView({ searchQuery, onStatsChange, refreshNonce = 0 }: TopicsViewProps) {
  const [drawers, setDrawers] = useState<TopicDrawer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrawerTopic, setSelectedDrawerTopic] = useState<string | null>(null);
  const [memoriesRoot, setMemoriesRoot] = useState<HTMLElement | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const selectedDrawer = drawers.find(d => d.topic === selectedDrawerTopic) || null;

  // Fetch drawers
  const loadDrawers = async (q: string) => {
    setLoading(true);
    try {
      abortControllerRef.current?.abort();
      const abort = new AbortController();
      abortControllerRef.current = abort;

      const res = await fetch(`${AGENT_HTTP}/v1/tools/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          tool: 'segment_build_topic_drawers',
          args: {
            query: q || undefined,
            limit_topics: 50,
            limit_segments_per_topic: 200,
            max_clusters_per_topic: 8,
            cluster_threshold: 0.82,
            segments_scan_limit: 2000,
          },
        }),
      });
      
      const data = await res.json().catch(() => null);
      if (data?.ok && Array.isArray(data.drawers)) {
        setDrawers(data.drawers);
        onStatsChange?.({ count: data.drawers.length });
      } else {
        setDrawers([]);
        onStatsChange?.({ count: 0 });
      }
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        console.error('Failed to load drawers:', e);
        onStatsChange?.({ count: 0 });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => loadDrawers(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, refreshNonce]);

  useEffect(() => {
    setSelectedDrawerTopic(null);
  }, [refreshNonce]);

  useEffect(() => {
    setMemoriesRoot(document.querySelector<HTMLElement>('[data-onboarding="memories-view"]'));
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      {loading && drawers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="flex min-w-[260px] flex-col items-center gap-4 rounded-[28px] bg-theme-card px-8 py-10 text-center shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-theme-muted" />
            <p className="text-sm font-medium text-theme-muted">Loading collections...</p>
          </div>
        </div>
      ) : drawers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-md rounded-[28px] bg-theme-card px-8 py-10 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-theme-hover text-theme-muted">
              <FolderOpen className="h-7 w-7" />
            </div>
            <h3 className="text-xl font-semibold text-theme-fg">No collections yet</h3>
            <p className="mt-2 text-sm leading-6 text-theme-muted">
              Stuard will group related conversations and facts here as your memory graph grows.
            </p>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 overflow-y-auto custom-scrollbar px-4 pb-5 pt-3 md:px-5 md:pb-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {drawers.map((drawer, i) => (
              <PopUpOnScroll key={drawer.topic} delay={i * 0.04}>
                <DrawerCard
                  drawer={drawer}
                  isSelected={selectedDrawerTopic === drawer.topic}
                  onClick={() => setSelectedDrawerTopic(
                    selectedDrawerTopic === drawer.topic ? null : drawer.topic
                  )}
                />
              </PopUpOnScroll>
            ))}
          </div>
        </div>
      )}

      {selectedDrawer && memoriesRoot ? createPortal(
        <AnimatePresence>
          <DrawerContentsPanel
            drawer={selectedDrawer}
            onClose={() => setSelectedDrawerTopic(null)}
          />
        </AnimatePresence>,
        memoriesRoot
      ) : (
        <AnimatePresence>
          {selectedDrawer && (
            <DrawerContentsPanel
              drawer={selectedDrawer}
              onClose={() => setSelectedDrawerTopic(null)}
            />
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Drawer Card (Compact grid card — the "face" of the drawer)
// ----------------------------------------------------------------------------

function DrawerCard({ 
  drawer, 
  isSelected,
  onClick 
}: { 
  drawer: TopicDrawer; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.985 }}
      className="relative"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0">
        <div
          className={clsx(
            'absolute left-4 right-4 top-0 h-4 rounded-[18px] bg-theme-hover shadow-sm',
            isSelected ? 'bg-theme-hover/90' : ''
          )}
        />
      </div>

      <button
        onClick={onClick}
        className={clsx(
          'memory-collection-card relative z-10 mt-1.5 w-full overflow-hidden rounded-[24px] text-left shadow-sm transition-all duration-300',
          isSelected
            ? 'bg-theme-card shadow-md'
            : 'bg-theme-card hover:bg-theme-card hover:shadow-lg'
        )}
      >
        <div className="relative z-10 flex min-h-[110px] flex-col gap-3 px-4 py-3.5 md:min-h-[118px]">
          <div className="flex items-start gap-4">
            <p className="text-[11px] font-medium text-theme-muted">{formatDrawerDate(drawer.latest_at)}</p>
          </div>

          <div className="min-h-[30px]">
            <h3 className="line-clamp-2 text-[0.95rem] font-semibold leading-6 text-theme-fg md:text-[1rem]">
              {drawer.topic}
            </h3>
          </div>

          <div className="mt-auto flex flex-col items-start gap-1.5 pt-3">
            <span className="rounded-full bg-[rgba(215,128,38,0.14)] px-3 py-1 text-xs font-medium text-[#d78026]">
              {drawer.clusters.length} {drawer.clusters.length === 1 ? 'Folder' : 'Folders'}
            </span>
            <span className="rounded-full bg-[rgba(39,118,255,0.15)] px-3 py-1 text-xs font-medium text-[#2776ff]">
              {drawer.count} {drawer.count === 1 ? 'Memory' : 'Memories'}
            </span>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Drawer Contents Panel (Slide-up overlay when a drawer is opened)
// ----------------------------------------------------------------------------

function DrawerContentsPanel({
  drawer,
  onClose,
}: {
  drawer: TopicDrawer;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40"
    >
      <div className="memory-collection-detail flex h-full flex-col rounded-[28px] bg-theme-bg px-4 py-4 shadow-xl md:px-5 md:py-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="truncate text-[1.15rem] font-semibold text-theme-fg md:text-[1.25rem]">
            {drawer.topic}
          </h2>

          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-2xl bg-theme-hover px-3 py-2 text-sm font-medium text-theme-fg transition-colors hover:bg-theme-bg"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-6 pt-10 md:px-4 md:pt-12">
          <div className="mx-auto max-w-3xl">
            <p className="text-center text-lg font-semibold text-theme-fg">
              {drawer.count} {drawer.count === 1 ? 'Memory' : 'Memories'} & {drawer.clusters.length} {drawer.clusters.length === 1 ? 'Folder' : 'Folders'}
            </p>

            <div className="mt-8 space-y-4">
            {drawer.clusters.map((cluster, idx) => (
              <PopUpOnScroll key={cluster.id} delay={idx * 0.05}>
                <ManilaFolder 
                  cluster={cluster}
                />
              </PopUpOnScroll>
            ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Manila Folder (Realistic folder with tab)
// ----------------------------------------------------------------------------

function ManilaFolder({ cluster }: { cluster: DrawerCluster }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="group/folder relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'memory-collection-folder relative z-10 w-full overflow-hidden text-left transition-all duration-300',
          isOpen ? 'rounded-t-[20px] rounded-b-none' : 'rounded-[20px]',
          isOpen
            ? 'bg-theme-card shadow-md'
            : 'bg-theme-card hover:bg-theme-card hover:shadow-sm'
        )}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-col items-start gap-2">
              <h4 className="w-full truncate text-[15px] font-medium text-theme-fg md:text-base">
                {cluster.title}
              </h4>
              <span className="rounded-full bg-[rgba(39,118,255,0.15)] px-3 py-1 text-xs font-medium text-[#2776ff]">
                {cluster.count} {cluster.count === 1 ? 'Memory' : 'Memories'}
              </span>
            </div>
          </div>

          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="h-4 w-4 text-theme-muted" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="memory-collection-sublist overflow-hidden rounded-b-[20px] bg-theme-bg/40">
              {cluster.segments.map((seg, sIdx) => (
                <PopUpOnScroll key={seg.id} delay={sIdx * 0.03}>
                  <DocumentPage
                    seg={seg}
                    isLast={sIdx === cluster.segments.length - 1}
                  />
                </PopUpOnScroll>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Document Page (Individual file / paper)
// ----------------------------------------------------------------------------

function DocumentPage({ seg, isLast }: { 
  seg: DrawerSegment; 
  isLast: boolean;
}) {
  return (
    <motion.button
      onClick={() => {
        try {
          (window as any).desktopAPI?.openChat?.(seg.conversation_id);
        } catch {}
      }}
      whileHover={{ y: -2, scale: 1.005 }}
      className={clsx(
        'memory-collection-subitem group/file relative w-full overflow-hidden bg-transparent text-left transition-all hover:bg-theme-card/50',
        !isLast && 'border-b border-black/15 dark:border-white/10'
      )}
    >
      <div className="relative z-10 p-4">
        <div className="min-w-0">
          <p className="text-sm leading-7 text-theme-fg">
            {seg.summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-theme-muted">
            <span>{new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(new Date(seg.created_at))}</span>
            <span>{formatShortTime(seg.created_at)}</span>
            <span className="opacity-0 transition-opacity group-hover/file:opacity-100 text-primary">
              Open chat
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
