'use client';

import { useState } from 'react';
import {
  Bug, Lightbulb, AlertTriangle, Clock, CheckCircle2, XCircle,
  MessageSquare, ChevronDown, Plus, Search, ArrowUpDown, Send
} from 'lucide-react';
import {
  FeedbackEntry, FeedbackComment, FeedbackStats,
  formatTimeAgo, formatDate
} from '../lib/api';

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open:        { label: 'Open',        color: 'bg-amber-50 text-amber-700 border-amber-200',     icon: AlertTriangle },
  in_progress: { label: 'In Progress', color: 'bg-blue-50 text-blue-700 border-blue-200',        icon: Clock },
  resolved:    { label: 'Resolved',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  closed:      { label: 'Closed',      color: 'bg-gray-100 text-gray-600 border-gray-200',       icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 text-red-700' },
  high:     { label: 'High',     color: 'bg-orange-100 text-orange-700' },
  medium:   { label: 'Medium',   color: 'bg-yellow-100 text-yellow-700' },
  low:      { label: 'Low',      color: 'bg-gray-100 text-gray-600' },
};

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  bug:     { label: 'Bug',     icon: Bug,       color: 'text-red-600' },
  feature: { label: 'Feature', icon: Lightbulb, color: 'text-purple-600' },
};

// ── Component ────────────────────────────────────────────────────────────────
export default function FeedbackTab({
  items, stats, total, loading,
  filterType, filterStatus, searchQuery,
  onFilterTypeChange, onFilterStatusChange, onSearchChange, onSearch,
  onUpdateStatus, onUpdatePriority,
  // Detail / Comments
  selectedItem, selectedComments, onSelectItem, onCloseDetail,
  onAddComment, onCreateFeedback,
}: {
  items: FeedbackEntry[];
  stats: FeedbackStats | null;
  total: number;
  loading: boolean;
  filterType: string;
  filterStatus: string;
  searchQuery: string;
  onFilterTypeChange: (t: string) => void;
  onFilterStatusChange: (s: string) => void;
  onSearchChange: (q: string) => void;
  onSearch: () => void;
  onUpdateStatus: (id: string, status: string) => void;
  onUpdatePriority: (id: string, priority: string) => void;
  selectedItem: (FeedbackEntry & { comments?: FeedbackComment[] }) | null;
  selectedComments: FeedbackComment[];
  onSelectItem: (id: string) => void;
  onCloseDetail: () => void;
  onAddComment: (feedbackId: string, content: string) => void;
  onCreateFeedback: (fb: { type: 'bug' | 'feature'; title: string; description?: string; priority?: string }) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<'bug' | 'feature'>('bug');
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createPriority, setCreatePriority] = useState('medium');
  const [commentText, setCommentText] = useState('');

  const handleCreate = () => {
    if (!createTitle.trim()) return;
    onCreateFeedback({ type: createType, title: createTitle.trim(), description: createDesc.trim() || undefined, priority: createPriority });
    setCreateTitle(''); setCreateDesc(''); setCreatePriority('medium'); setShowCreate(false);
  };

  const handleComment = () => {
    if (!commentText.trim() || !selectedItem) return;
    onAddComment(selectedItem.id, commentText.trim());
    setCommentText('');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Feedback & Bugs</h2>
          <p className="text-sm text-gray-500">{total} total items — track bugs, feature requests, and user feedback</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> New Item
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Open Bugs" value={stats.openBugs} icon={Bug} color="red" />
          <StatCard label="Open Features" value={stats.openFeatures} icon={Lightbulb} color="purple" />
          <StatCard label="In Progress" value={stats.inProgress} icon={Clock} color="blue" />
          <StatCard label="Resolved" value={stats.resolved} icon={CheckCircle2} color="emerald" />
          <StatCard label="Critical" value={stats.byPriority.critical} icon={AlertTriangle} color="amber" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type filter */}
        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
          {['', 'bug', 'feature'].map(t => (
            <button key={t || 'all'} onClick={() => onFilterTypeChange(t)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filterType === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {t ? TYPE_CONFIG[t]?.label : 'All Types'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
          {['', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s || 'all'} onClick={() => onFilterStatusChange(s)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              {s ? STATUS_CONFIG[s]?.label : 'All'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input-field pl-9 pr-4 py-1.5 text-sm w-full"
            placeholder="Search feedback..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSearch(); }}
          />
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="card p-5 border-2 border-blue-200 bg-blue-50/30">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Create New Item</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Type</label>
              <div className="flex gap-2">
                {(['bug', 'feature'] as const).map(t => (
                  <button key={t} onClick={() => setCreateType(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      createType === t
                        ? t === 'bug' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-purple-50 border-purple-300 text-purple-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {t === 'bug' ? <Bug className="w-3.5 h-3.5" /> : <Lightbulb className="w-3.5 h-3.5" />}
                    {TYPE_CONFIG[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Priority</label>
              <select value={createPriority} onChange={e => setCreatePriority(e.target.value)}
                className="input-field py-1.5 text-sm w-full">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <input className="input-field py-2 text-sm w-full mb-3" placeholder="Title..." value={createTitle}
            onChange={e => setCreateTitle(e.target.value)} autoFocus />
          <textarea className="input-field py-2 text-sm w-full mb-3 h-20 resize-none" placeholder="Description (optional)..."
            value={createDesc} onChange={e => setCreateDesc(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={!createTitle.trim()} className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40">Create</button>
          </div>
        </div>
      )}

      {/* List + Detail split view */}
      <div className={`grid gap-6 ${selectedItem ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* Items list */}
        <div className="card overflow-hidden">
          {loading && items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading feedback...
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              No feedback items found. Create one to get started.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map(item => {
                const typeConf = TYPE_CONFIG[item.type] || TYPE_CONFIG.bug;
                const statusConf = STATUS_CONFIG[item.status] || STATUS_CONFIG.open;
                const priorityConf = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.medium;
                const TypeIcon = typeConf.icon;
                const isSelected = selectedItem?.id === item.id;

                return (
                  <button key={item.id} onClick={() => onSelectItem(item.id)}
                    className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/50 border-l-2 border-blue-500' : ''}`}>
                    <div className="flex items-start gap-3">
                      <TypeIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${typeConf.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{item.title}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${statusConf.color}`}>
                            {statusConf.label}
                          </span>
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${priorityConf.color}`}>
                            {priorityConf.label}
                          </span>
                          {(item.commentCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                              <MessageSquare className="w-3 h-3" /> {item.commentCount}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 ml-auto">{formatTimeAgo(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <div className="card p-5 space-y-4 animate-fade-in">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {selectedItem.type === 'bug'
                  ? <Bug className="w-5 h-5 text-red-600" />
                  : <Lightbulb className="w-5 h-5 text-purple-600" />}
                <h3 className="text-base font-semibold text-gray-900">{selectedItem.title}</h3>
              </div>
              <button onClick={onCloseDetail} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>

            {selectedItem.description && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{selectedItem.description}</p>
            )}

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-400 block mb-1">Status</span>
                <select value={selectedItem.status} onChange={e => onUpdateStatus(selectedItem.id, e.target.value)}
                  className="input-field py-1 text-xs w-full">
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Priority</span>
                <select value={selectedItem.priority} onChange={e => onUpdatePriority(selectedItem.id, e.target.value)}
                  className="input-field py-1 text-xs w-full">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Reporter</span>
                <span className="text-gray-700">{selectedItem.reporter_email || '—'}</span>
              </div>
              <div>
                <span className="text-gray-400 block mb-1">Created</span>
                <span className="text-gray-700">{formatDate(selectedItem.created_at)}</span>
              </div>
              {selectedItem.resolved_at && (
                <div>
                  <span className="text-gray-400 block mb-1">Resolved</span>
                  <span className="text-gray-700">{formatDate(selectedItem.resolved_at)}</span>
                </div>
              )}
              {selectedItem.assigned_to && (
                <div>
                  <span className="text-gray-400 block mb-1">Assigned</span>
                  <span className="text-gray-700">{selectedItem.assigned_to}</span>
                </div>
              )}
            </div>

            {/* Comments */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Comments ({selectedComments.length})
              </h4>
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {selectedComments.length === 0 ? (
                  <p className="text-xs text-gray-400 p-2">No comments yet.</p>
                ) : selectedComments.map(c => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">{c.author}</span>
                      <span className="text-[10px] text-gray-400">{formatTimeAgo(c.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-600">{c.content}</p>
                  </div>
                ))}
              </div>

              {/* Add comment */}
              <div className="flex gap-2 mt-3">
                <input className="input-field py-1.5 text-xs flex-1" placeholder="Add a comment..."
                  value={commentText} onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleComment(); }} />
                <button onClick={handleComment} disabled={!commentText.trim()}
                  className="btn-primary p-1.5 disabled:opacity-40" title="Send">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat card sub-component ──────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  const bg = { red: 'bg-red-50', purple: 'bg-purple-50', blue: 'bg-blue-50', emerald: 'bg-emerald-50', amber: 'bg-amber-50' }[color] || 'bg-gray-50';
  const iconColor = { red: 'text-red-600', purple: 'text-purple-600', blue: 'text-blue-600', emerald: 'text-emerald-600', amber: 'text-amber-600' }[color] || 'text-gray-600';
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div>
        <div className="text-lg font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}
