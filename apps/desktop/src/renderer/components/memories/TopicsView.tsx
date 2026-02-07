import React, { useEffect, useRef, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { 
  Folder, 
  ChevronRight, 
  ChevronDown, 
  Clock,
  Archive,
  Loader2,
  FileText,
  FolderOpen,
  X,
  ArrowLeft
} from 'lucide-react';
import { AnimatePresence, motion, useInView } from 'framer-motion';

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
}

// Folder tab colors for manila folders
const FOLDER_TAB_COLORS = [
  { bg: '#D4A574', text: '#5C3D1E', border: '#C4956A' },  // manila
  { bg: '#A8C5DA', text: '#2E4A5C', border: '#8FB5CE' },  // blue
  { bg: '#C5D4A0', text: '#3D4A2E', border: '#B2C48A' },  // green
  { bg: '#D4B0C5', text: '#5C2E4A', border: '#C49AB2' },  // pink
  { bg: '#D4C5A0', text: '#4A3D1E', border: '#C4B58A' },  // gold
  { bg: '#A8D4D0', text: '#2E5C56', border: '#8FC4BE' },  // teal
];

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

export function TopicsView({ searchQuery, onStatsChange }: TopicsViewProps) {
  const [drawers, setDrawers] = useState<TopicDrawer[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDrawerTopic, setSelectedDrawerTopic] = useState<string | null>(null);
  
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
  }, [searchQuery]);

  return (
    <div className="h-full flex flex-col relative overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #F5F0E8 0%, #EDE6DA 40%, #E8E0D0 100%)',
      }}
    >
      {/* Subtle paper texture overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='4' type='fractalNoise'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: '200px 200px',
        }}
      />

      {loading && drawers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-amber-700/50 animate-spin" />
            <p className="text-sm text-amber-900/40 font-medium">Opening drawers...</p>
          </div>
        </div>
      ) : drawers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-32 h-24 relative mb-6">
            {/* Empty drawer illustration */}
            <div className="absolute inset-x-0 bottom-0 h-20 rounded-lg border-2 border-amber-800/20"
              style={{ background: 'linear-gradient(180deg, #C4956A 0%, #B8895E 100%)' }}
            />
            <div className="absolute inset-x-2 bottom-2 h-14 rounded bg-amber-100/30" />
            <div className="absolute left-1/2 -translate-x-1/2 bottom-[70px] w-10 h-3 rounded-t bg-amber-700/30 border border-amber-800/20" />
          </div>
          <p className="text-sm font-bold text-amber-900/40 uppercase tracking-widest">Empty Drawer</p>
          <p className="text-xs text-amber-800/30 mt-1">Your memories will be filed here</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 relative">
          {/* Drawer Grid */}
          <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-3 gap-4">
            {drawers.map((drawer, i) => (
              <PopUpOnScroll key={drawer.topic} delay={i * 0.04}>
                <DrawerCard
                  drawer={drawer}
                  isSelected={selectedDrawerTopic === drawer.topic}
                  onClick={() => setSelectedDrawerTopic(
                    selectedDrawerTopic === drawer.topic ? null : drawer.topic
                  )}
                  index={i}
                />
              </PopUpOnScroll>
            ))}
          </div>
          <div className="h-6" />
        </div>
      )}

      {/* Opened Drawer Overlay */}
      <AnimatePresence>
        {selectedDrawer && (
          <DrawerContentsPanel
            drawer={selectedDrawer}
            drawerIndex={drawers.indexOf(selectedDrawer)}
            onClose={() => setSelectedDrawerTopic(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Drawer Card (Compact grid card — the "face" of the drawer)
// ----------------------------------------------------------------------------

function DrawerCard({ 
  drawer, 
  isSelected,
  onClick, 
  index 
}: { 
  drawer: TopicDrawer; 
  isSelected: boolean; 
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={clsx(
        "relative w-full text-left rounded-xl overflow-hidden border-2 cursor-pointer transition-shadow duration-300",
        isSelected && "ring-2 ring-amber-500/40"
      )}
      style={{
        background: 'linear-gradient(180deg, #9C8468 0%, #8B7355 50%, #7A6348 100%)',
        borderColor: '#8B7355',
        boxShadow: isSelected
          ? '0 12px 32px -6px rgba(92, 69, 48, 0.5), inset 0 1px 0 rgba(255,255,255,0.15)'
          : '0 4px 12px -3px rgba(92, 69, 48, 0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}
    >
      {/* Wood grain texture */}
      <div className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 6px, rgba(0,0,0,0.04) 6px, rgba(0,0,0,0.04) 7px)`,
        }}
      />

      {/* Top highlight */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 px-4 py-4">
        {/* Handle centered at top */}
        <div className="flex justify-center mb-3">
          <div 
            className="w-12 h-[6px] rounded-full"
            style={{
              background: 'linear-gradient(180deg, #B8A080 0%, #988060 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.25)',
              border: '0.5px solid #7A6348',
            }}
          />
        </div>

        {/* Label plate */}
        <div className="rounded-lg px-3 py-2 mb-2"
          style={{
            background: 'rgba(245, 240, 230, 0.12)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <h3 className="text-sm font-bold tracking-tight truncate"
            style={{ color: '#F5EFE5', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
          >
            {drawer.topic}
          </h3>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: '#D4C4A8', background: 'rgba(0,0,0,0.15)' }}
          >
            {drawer.count} mem
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: '#D4C4A8', background: 'rgba(0,0,0,0.15)' }}
          >
            {drawer.clusters.length} folders
          </span>
        </div>

        {drawer.latest_at && (
          <div className="flex items-center gap-1 mt-2 text-[9px] font-bold uppercase tracking-widest"
            style={{ color: '#B8A888' }}
          >
            <Clock className="w-2.5 h-2.5" />
            {new Date(drawer.latest_at).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Bottom edge */}
      <div className="absolute bottom-0 inset-x-0 h-[2px]" style={{ background: 'rgba(0,0,0,0.25)' }} />
    </motion.button>
  );
}

// ----------------------------------------------------------------------------
// Drawer Contents Panel (Slide-up overlay when a drawer is opened)
// ----------------------------------------------------------------------------

function DrawerContentsPanel({
  drawer,
  drawerIndex,
  onClose,
}: {
  drawer: TopicDrawer;
  drawerIndex: number;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40 flex flex-col"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-amber-950/10 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative z-10 mt-auto flex flex-col overflow-hidden rounded-t-2xl"
        style={{
          maxHeight: '85%',
          background: 'linear-gradient(180deg, #D4C4A0 0%, #E8DCC8 6%, #F0E8D8 100%)',
          boxShadow: '0 -8px 40px rgba(92, 69, 48, 0.3)',
          borderTop: '3px solid #8B7355',
        }}
      >
        {/* Wooden drawer rail at top */}
        <div className="flex-none relative"
          style={{
            background: 'linear-gradient(180deg, #8B7355 0%, #7A6348 100%)',
          }}
        >
          <div className="absolute inset-0 pointer-events-none opacity-10"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 6px, rgba(0,0,0,0.04) 6px, rgba(0,0,0,0.04) 7px)`,
            }}
          />
          <div className="relative z-10 flex items-center justify-between px-5 py-3">
            <button onClick={onClose}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: '#D4C4A8' }}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">Back</span>
            </button>
            <h2 className="text-base font-bold tracking-tight"
              style={{ color: '#F5EFE5', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
            >
              {drawer.topic}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ color: '#D4C4A8', background: 'rgba(0,0,0,0.15)' }}
              >
                {drawer.count} Memories
              </span>
            </div>
          </div>
          <div className="h-[2px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        {/* Inner shadow for depth */}
        <div className="h-3 bg-gradient-to-b from-amber-900/10 to-transparent flex-none" />

        {/* Scrollable folder contents */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-6 space-y-4">
          {drawer.clusters.map((cluster, idx) => (
            <PopUpOnScroll key={cluster.id} delay={idx * 0.06}>
              <ManilaFolder 
                cluster={cluster} 
                idx={idx} 
                colorIdx={drawerIndex * 3 + idx}
              />
            </PopUpOnScroll>
          ))}
        </div>

        {/* Bottom rail */}
        <div className="h-2 flex-none bg-gradient-to-t from-amber-900/5 to-transparent" />
      </motion.div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Manila Folder (Realistic folder with tab)
// ----------------------------------------------------------------------------

function ManilaFolder({ cluster, idx, colorIdx }: { cluster: DrawerCluster; idx: number; colorIdx: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const color = FOLDER_TAB_COLORS[colorIdx % FOLDER_TAB_COLORS.length];
  const tabOffset = (idx % 3) * 28;

  return (
    <div className="group/folder relative">
      {/* Folder body */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          "w-full text-left relative transition-all duration-300",
          !isOpen && "hover:-translate-y-1"
        )}
      >
        {/* Tab sticking up */}
        <div 
          className="absolute -top-3 h-7 rounded-t-lg flex items-center px-3 text-[10px] font-bold uppercase tracking-wide z-10"
          style={{ 
            left: `${tabOffset + 8}%`,
            maxWidth: '50%',
            background: color.bg,
            color: color.text,
            border: `1px solid ${color.border}`,
            borderBottom: 'none',
            boxShadow: '0 -2px 6px rgba(0,0,0,0.08)',
          }}
        >
          <span className="truncate">{cluster.title}</span>
        </div>

        {/* Main folder body */}
        <div 
          className={clsx(
            "relative rounded-lg p-4 pt-5 flex items-center gap-4 transition-all duration-300",
            isOpen ? "shadow-lg" : "shadow-sm hover:shadow-md"
          )}
          style={{
            background: isOpen
              ? `linear-gradient(180deg, ${color.bg}dd 0%, ${color.bg}cc 100%)`
              : `linear-gradient(180deg, ${color.bg}bb 0%, ${color.bg}aa 100%)`,
            border: `1.5px solid ${color.border}`,
          }}
        >
          {/* Folder icon */}
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: `${color.text}15`, color: color.text }}
          >
            {isOpen 
              ? <FolderOpen className="w-5 h-5" /> 
              : <Folder className="w-5 h-5" />
            }
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold truncate" style={{ color: color.text }}>
              {cluster.title}
            </h4>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5"
              style={{ color: `${color.text}88` }}
            >
              {cluster.count} {cluster.count === 1 ? 'Document' : 'Documents'}
            </p>
          </div>

          <motion.div
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4" style={{ color: `${color.text}66` }} />
          </motion.div>
        </div>

        {/* Stacked papers behind folder (when closed) */}
        {!isOpen && cluster.count > 1 && (
          <>
            <div className="absolute inset-x-1 -bottom-1 h-full rounded-lg -z-10 opacity-40"
              style={{ background: color.bg, border: `1px solid ${color.border}` }}
            />
            {cluster.count > 2 && (
              <div className="absolute inset-x-2 -bottom-2 h-full rounded-lg -z-20 opacity-20"
                style={{ background: color.bg, border: `1px solid ${color.border}` }}
              />
            )}
          </>
        )}
      </button>

      {/* Documents spilling out of the open folder */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2 pb-1 space-y-1.5 ml-4 mr-2">
              {cluster.segments.map((seg, sIdx) => (
                <PopUpOnScroll key={seg.id} delay={sIdx * 0.03}>
                  <DocumentPage seg={seg} sIdx={sIdx} folderColor={color} />
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

function DocumentPage({ seg, sIdx, folderColor }: { 
  seg: DrawerSegment; 
  sIdx: number; 
  folderColor: typeof FOLDER_TAB_COLORS[0];
}) {
  const rotation = sIdx % 3 === 0 ? -0.4 : sIdx % 3 === 1 ? 0.3 : 0;

  return (
    <motion.button
      onClick={() => {
        try {
          (window as any).desktopAPI?.openChat?.(seg.conversation_id);
        } catch {}
      }}
      whileHover={{ y: -3, scale: 1.01, rotate: 0 }}
      className="w-full group/file text-left rounded-lg transition-all relative overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAF5 100%)',
        border: '1px solid #E0D8C8',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        transform: `rotate(${rotation}deg)`,
      }}
    >
      {/* Page lines */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 27px, #8B7355 27px, #8B7355 28px)`,
          backgroundPosition: '0 20px',
        }}
      />

      {/* Red margin line */}
      <div className="absolute left-10 top-0 bottom-0 w-px pointer-events-none"
        style={{ background: '#E8A0A0', opacity: 0.25 }}
      />

      {/* Content */}
      <div className="relative z-10 flex items-start gap-3 p-3 pl-14">
        <FileText className="w-4 h-4 mt-0.5 flex-shrink-0"
          style={{ color: '#B8A888' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed line-clamp-2"
            style={{ color: '#5C4530' }}
          >
            {seg.summary}
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest"
              style={{ color: '#B8A888' }}
            >
              {new Date(seg.created_at).toLocaleDateString()}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest opacity-0 group-hover/file:opacity-100 transition-opacity"
              style={{ color: folderColor.text }}
            >
              Open Chat
            </span>
          </div>
        </div>
      </div>

      {/* Corner fold */}
      <div className="absolute top-0 right-0 w-4 h-4 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, transparent 50%, #E8E0D0 50%)' }}
      />
      <div className="absolute top-0 right-0 w-4 h-4 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, transparent 48%, #D8D0C0 48%, #D8D0C0 50%, transparent 50%)' }}
      />
    </motion.button>
  );
}
