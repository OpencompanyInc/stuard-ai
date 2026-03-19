import React, { useEffect, useRef, useState, useMemo } from "react";
import { Calendar as CalendarIcon, Clock, Plus, RefreshCw, Link2, ChevronLeft, ChevronRight, ListTodo, Trash2, MapPin, WifiOff, Copy } from "lucide-react";
import { clsx } from 'clsx';

export type PlannerViewMode = "today" | "month";

export interface UnifiedPlannerViewProps {
  calendarView: PlannerViewMode;
  onChangeCalendarView: (view: PlannerViewMode) => void;
  calendarRefDate?: Date;
  onMonthChange?: (date: Date) => void;
  calendarRange: { start: string; end: string } | null;
  calendarLoading: boolean;
  calendarError: string | null;
  calendarBlocksSorted: any[];
  calendarDays: { date: string; blocks: any[] }[];
  selectedBlock: any | null;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onRescheduleBlock?: (block: any, newDateIso: string) => void | Promise<void>;
  onRefresh: () => void;
  AGENT_HTTP?: string;
  // Tasks integration
  tasks?: any[];
  onAddReminder?: (taskId: string, reminder: { message: string; scheduledAt: string }) => void;
  onDeleteReminder?: (taskId: string, reminderId: string) => void;
}

const HOUR_HEIGHT = 92;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DOT_COLORS = ['#f97316', '#a855f7', '#06b6d4', '#f43f5e', '#22c55e', '#eab308', '#6366f1', '#ec4899'];

const formatLocalDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const UnifiedPlannerView: React.FC<UnifiedPlannerViewProps> = ({
  calendarView, onChangeCalendarView, calendarRefDate, onMonthChange, calendarRange,
  calendarLoading, calendarError, calendarBlocksSorted, calendarDays = [],
  selectedBlock, selectedBlockId, onSelectBlock, onRescheduleBlock, onRefresh,
  AGENT_HTTP,
  tasks = [],
  onAddReminder,
  onDeleteReminder,
}) => {

  const [selectedDateKey, setSelectedDateKey] = React.useState<string | null>(null);
  const [dragBlock, setDragBlock] = React.useState<any | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Local event creation
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    date: formatLocalDateKey(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    description: '',
    location: '',
    recurring: 'none' as 'none' | 'daily' | 'weekly' | 'monthly',
  });

  const handleAddLocalEvent = async () => {
    if (!newEvent.title.trim()) return;
    try {
      const start = newEvent.allDay
        ? `${newEvent.date}T00:00:00`
        : `${newEvent.date}T${newEvent.startTime}:00`;
      const end = newEvent.allDay
        ? `${newEvent.date}T23:59:59`
        : `${newEvent.date}T${newEvent.endTime}:00`;

      const res = await (window as any).desktopAPI?.offlineCalendarAdd?.({
        title: newEvent.title.trim(),
        description: newEvent.description.trim() || undefined,
        start,
        end,
        allDay: newEvent.allDay,
        location: newEvent.location.trim() || undefined,
        recurring: newEvent.recurring,
      });

      if (res?.ok) {
        setShowAddEvent(false);
        setNewEvent({
          title: '',
          date: formatLocalDateKey(new Date()),
          startTime: '09:00',
          endTime: '10:00',
          allDay: false,
          description: '',
          location: '',
          recurring: 'none',
        });
        onRefresh(); // Reload calendar data
      }
    } catch (e) {
      console.error('Failed to add local event:', e);
    }
  };

  const handleDeleteLocalEvent = async (eventId: string) => {
    try {
      const res = await (window as any).desktopAPI?.offlineCalendarDelete?.(eventId);
      if (res?.ok) {
        onRefresh();
      }
    } catch (e) {
      console.error('Failed to delete local event:', e);
    }
  };

  const currentLocalIso = formatLocalDateKey(new Date());

  const toLocalDate = (iso: string) => {
    if (typeof iso === 'string' && iso.length === 10 && iso.includes('-')) {
      const parts = iso.split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        const [y, m, d] = parts;
        return new Date(y, m - 1, d);
      }
    }
    return new Date(iso);
  };

  const viewDateIso = React.useMemo(() => {
    if (selectedDateKey) return selectedDateKey;
    return formatLocalDateKey(new Date());
  }, [selectedDateKey]);

  const handleSwitchToToday = () => {
    const nextDate = selectedDateKey ? toLocalDate(selectedDateKey) : new Date();
    if (!selectedDateKey) {
      setSelectedDateKey(formatLocalDateKey(nextDate));
    }
    if (onMonthChange) onMonthChange(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    onChangeCalendarView("today");
  };

  const handleOpenLink = (url: string) => {
    if (!url) return;
    try {
      const w: any = window as any;
      if (w?.desktopAPI?.openExternal) {
        w.desktopAPI.openExternal(url);
      } else if (typeof window.open === "function") {
        window.open(url, "_blank");
      }
    } catch { }
  };

  const renderTimeLabel = (b: any): string => {
    try {
      const start = b.start ? new Date(b.start) : null;
      const end = b.end ? new Date(b.end) : null;
      if (b.allDay) return "All day";
      if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        return `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
      if (start && !isNaN(start.getTime())) {
        return start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    } catch { }
    return "";
  };

  const getBlockMeta = (block: any) => {
    if (block?.source === 'reminder') {
      return {
        label: 'Reminder',
        dotClass: 'bg-amber-500',
        chipClass: 'bg-amber-500/12 text-amber-400 border border-amber-500/20',
      };
    }
    if (block?.source === 'task' || block?.source === 'unified-tasks') {
      return {
        label: 'Task',
        dotClass: 'bg-emerald-500',
        chipClass: 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/20',
      };
    }
    if (block?.source === 'local') {
      return {
        label: 'Local',
        dotClass: 'bg-violet-500',
        chipClass: 'bg-violet-500/12 text-violet-400 border border-violet-500/20',
      };
    }
    return {
      label: 'Event',
      dotClass: 'bg-orange-400',
      chipClass: 'bg-orange-500/12 text-orange-300 border border-orange-500/20',
    };
  };

  const selectedBlockMeta = useMemo(() => getBlockMeta(selectedBlock), [selectedBlock]);
  const selectedDescriptionItems = useMemo(() => {
    return String(selectedBlock?.description || '')
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }, [selectedBlock?.description]);

  const handleCopyLink = async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      try { (window as any).desktopAPI?.notify?.('Copied', 'Calendar link copied to clipboard.'); } catch { }
    } catch {
      handleOpenLink(url);
    }
  };

  // Convert tasks with due dates to calendar blocks, plus reminder blocks
  const taskBlocks = useMemo(() => {
    const blocks: any[] = [];
    for (const t of tasks) {
      if (t.status === 'completed' || t.showInCalendar === false) continue;
      // Task block (if it has a dueDate)
      if (t.dueDate) {
        blocks.push({
          id: `task_${t.id}`,
          title: t.title,
          start: t.dueDate,
          end: t.dueDate,
          allDay: t.allDay !== false,
          source: 'task',
          priority: t.priority,
          taskId: t.id,
          subTodosTotal: t.subTodos?.length || t.subTodosTotal || 0,
          subTodosCompleted: t.subTodos?.filter((s: any) => s.completed).length || t.subTodosCompleted || 0,
        });
      }
      // Reminder blocks from agentAssignments
      const reminders = (t.agentAssignments || []).filter((a: any) => a.status === 'pending' && a.scheduledAt);
      for (const r of reminders) {
        blocks.push({
          id: `reminder_${t.id}_${r.id}`,
          title: r.message || `Reminder: ${t.title}`,
          start: r.scheduledAt,
          end: r.scheduledAt,
          allDay: false,
          source: 'reminder',
          priority: t.priority,
          taskId: t.id,
          reminderOf: t.title,
        });
      }
    }
    return blocks;
  }, [tasks]);

  // Merge calendar blocks with task blocks
  const mergedBlocks = useMemo(() => {
    return [...calendarBlocksSorted, ...taskBlocks];
  }, [calendarBlocksSorted, taskBlocks]);

  const dayBlocks = React.useMemo(() => {
    if (!Array.isArray(mergedBlocks)) return [];
    return mergedBlocks.filter(b => {
      if (b.allDay) return false;
      try {
        const s = b.start ? new Date(b.start) : null;
        if (s && !isNaN(s.getTime())) {
          const y = s.getFullYear();
          const m = String(s.getMonth() + 1).padStart(2, '0');
          const d = String(s.getDate()).padStart(2, '0');
          const localIso = `${y}-${m}-${d}`;
          return localIso === viewDateIso;
        }
      } catch { }
      return false;
    });
  }, [mergedBlocks, viewDateIso]);

  const allDayBlocks = React.useMemo(() => {
    if (!Array.isArray(mergedBlocks)) return [];
    return mergedBlocks.filter(b => {
      if (!b.allDay) return false;
      try {
        const raw = typeof b.start === 'string' ? b.start.slice(0, 10) : '';
        if (raw === viewDateIso) return true;
        const s = b.start ? new Date(b.start) : null;
        if (s && !isNaN(s.getTime())) {
          const y = s.getFullYear();
          const m = String(s.getMonth() + 1).padStart(2, '0');
          const d = String(s.getDate()).padStart(2, '0');
          const localIso = `${y}-${m}-${d}`;
          return localIso === viewDateIso;
        }
      } catch { }
      return false;
    });
  }, [mergedBlocks, viewDateIso]);

  const monthWeeks = React.useMemo(() => {
    if (calendarView !== "month") return [];
    // Merge task blocks into calendarDays
    const tasksByDate: Record<string, any[]> = {};
    for (const tb of taskBlocks) {
      try {
        const s = tb.start ? new Date(tb.start) : null;
        if (s && !isNaN(s.getTime())) {
          const y = s.getFullYear();
          const m = String(s.getMonth() + 1).padStart(2, '0');
          const d = String(s.getDate()).padStart(2, '0');
          const iso = `${y}-${m}-${d}`;
          if (!tasksByDate[iso]) tasksByDate[iso] = [];
          tasksByDate[iso].push(tb);
        }
      } catch { }
    }
    // ALWAYS build dayMap
    const dayMap: Record<string, any[]> = {};
    if (Array.isArray(calendarDays)) {
      for (const d of calendarDays) {
        if (d && d.date) {
          const combined = [...(d.blocks || []), ...(tasksByDate[d.date] || [])];
          dayMap[d.date] = combined;
        }
      }
    }

    // Ensure any dates that only have tasks are also in dayMap
    for (const dateIso in tasksByDate) {
      if (!dayMap[dateIso]) {
        dayMap[dateIso] = tasksByDate[dateIso];
      }
    }

    let base: Date | null = null;
    try {
      if (calendarRefDate) {
        base = new Date(calendarRefDate.getFullYear(), calendarRefDate.getMonth(), 1);
      } else if (calendarRange && calendarRange.start) {
        const s = new Date(calendarRange.start);
        if (!isNaN(s.getTime())) base = new Date(s.getFullYear(), s.getMonth(), 1);
      }
    } catch { }
    if (!base) {
      const now = new Date();
      base = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const start = new Date(base);
    start.setDate(start.getDate() - start.getDay());
    const weeks = [];
    const today = new Date();
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start);
        cur.setDate(start.getDate() + w * 7 + d);
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const day = String(cur.getDate()).padStart(2, '0');
        const iso = `${y}-${m}-${day}`;
        row.push({
          date: iso,
          blocks: dayMap[iso] || [],
          isCurrentMonth: cur.getFullYear() === base.getFullYear() && cur.getMonth() === base.getMonth(),
          isToday: cur.getFullYear() === today.getFullYear() && cur.getMonth() === today.getMonth() && cur.getDate() === today.getDate(),
        });
      }
      weeks.push(row);
    }
    return weeks;
  }, [calendarView, calendarRange, calendarDays, calendarRefDate, taskBlocks]);

  const dayBlockLayouts = useMemo(() => {
    const parsed = dayBlocks
      .map((b) => {
        try {
          const start = new Date(b.start);
          const end = new Date(b.end);
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
          const startMinutes = start.getHours() * 60 + start.getMinutes();
          const endMinutes = Math.max(startMinutes + 15, end.getHours() * 60 + end.getMinutes());
          return {
            block: b,
            start,
            end,
            startMinutes,
            endMinutes,
            top: (startMinutes / 60) * HOUR_HEIGHT,
            height: (Math.max(15, endMinutes - startMinutes) / 60) * HOUR_HEIGHT,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ block: any; start: Date; end: Date; startMinutes: number; endMinutes: number; top: number; height: number }>;

    parsed.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

    const laidOut: Array<{ block: any; start: Date; end: Date; top: number; height: number; column: number; maxColumns: number }> = [];
    let active: Array<{ endMinutes: number; column: number }> = [];
    let currentGroup: Array<{ block: any; start: Date; end: Date; top: number; height: number; column: number; maxColumns: number }> = [];

    const finalizeGroup = () => {
      if (!currentGroup.length) return;
      const maxColumns = currentGroup.reduce((max, item) => Math.max(max, item.column + 1), 1);
      currentGroup.forEach((item) => {
        item.maxColumns = maxColumns;
        laidOut.push(item);
      });
      currentGroup = [];
    };

    for (const item of parsed) {
      active = active.filter((entry) => entry.endMinutes > item.startMinutes);
      if (active.length === 0) finalizeGroup();
      const used = new Set(active.map((entry) => entry.column));
      let column = 0;
      while (used.has(column)) column += 1;
      const laidOutItem = { ...item, column, maxColumns: 1 };
      active.push({ endMinutes: item.endMinutes, column });
      currentGroup.push(laidOutItem);
    }
    finalizeGroup();
    return laidOut;
  }, [dayBlocks]);

  const handleTimelineDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragBlock || !onRescheduleBlock) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollTop = e.currentTarget.scrollTop;
    const offsetY = e.clientY - rect.top + scrollTop;
    let totalMinutes = (offsetY / HOUR_HEIGHT) * 60;
    totalMinutes = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.floor(totalMinutes % 60);
    const newDate = toLocalDate(viewDateIso);
    newDate.setHours(hours, minutes, 0, 0);
    onRescheduleBlock(dragBlock, newDate.toISOString());
    setDragBlock(null);
  };

  useEffect(() => {
    if (calendarView === 'today') {
      const timer = setTimeout(() => {
        if (timelineRef.current) {
          const firstEventTop = dayBlockLayouts.length > 0
            ? Math.max(dayBlockLayouts[0].top - HOUR_HEIGHT, 0)
            : null;
          const fallbackTop = viewDateIso === currentLocalIso
            ? Math.max(((new Date().getHours() - 1) * HOUR_HEIGHT), 0)
            : 8 * HOUR_HEIGHT;
          timelineRef.current.scrollTop = firstEventTop ?? fallbackTop;
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [calendarView, dayBlockLayouts, viewDateIso, currentLocalIso]);

  useEffect(() => {
    if (!selectedBlock?.start) return;
    try {
      const d = new Date(selectedBlock.start);
      if (Number.isNaN(d.getTime())) return;
      const key = formatLocalDateKey(d);
      setSelectedDateKey(prev => prev === key ? prev : key);
      if (onMonthChange) {
        onMonthChange(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    } catch { }
  }, [selectedBlockId]);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col gap-4" data-onboarding="planner-calendar">
      <div className="flex items-center justify-end gap-3 shrink-0">
        {showAddEvent ? (
          <>
            <button
              onClick={() => setShowAddEvent(false)}
              className="dashboard-button-secondary flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-semibold transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleAddLocalEvent}
              disabled={!newEvent.title.trim()}
              className="dashboard-button-primary flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-semibold hover:opacity-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Create
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setNewEvent(e => ({ ...e, date: selectedDateKey || formatLocalDateKey(new Date()) }));
                setShowAddEvent(true);
              }}
              className="dashboard-button-primary flex items-center gap-2 px-5 py-3 rounded-2xl text-[14px] font-semibold hover:opacity-95 transition-all"
              title="Add Local Event"
            >
              <Plus className="w-4 h-4" />
              Create Event
            </button>
            <button
              onClick={onRefresh}
              className="dashboard-refresh-button flex items-center gap-2 px-4 py-3 text-[14px] font-medium transition-all"
              title="Refresh Calendar"
            >
              <RefreshCw className={clsx("w-4 h-4", calendarLoading && "animate-spin")} />
              <span>Refresh</span>
            </button>
          </>
        )}
      </div>

      {showAddEvent ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div>
                <h2 className="text-[28px] font-semibold text-theme-fg tracking-tight">Create Event</h2>
                <p className="mt-2 text-[13px] text-theme-muted font-medium">Define meeting details and attach automated actions.</p>
              </div>

              <div className="dashboard-card p-0 overflow-hidden rounded-[28px]">
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={e => setNewEvent(ev => ({ ...ev, title: e.target.value }))}
                  placeholder="Add Title"
                  className="w-full bg-transparent px-6 py-6 text-[22px] text-theme-fg placeholder:text-theme-muted/70 outline-none"
                  autoFocus
                />

                <div className="border-t border-[color:var(--dashboard-panel-border)] px-6 py-5">
                  <label className="text-[11px] text-theme-muted font-medium block mb-2">Date</label>
                  <input
                    type="date"
                    value={newEvent.date}
                    onChange={e => setNewEvent(ev => ({ ...ev, date: e.target.value }))}
                    className="w-full bg-transparent text-[14px] text-theme-fg outline-none"
                  />
                </div>

                <div className="border-t border-[color:var(--dashboard-panel-border)] px-6 py-5 flex items-center justify-between gap-4">
                  <div className="text-[14px] text-theme-fg font-medium">All day</div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvent.allDay}
                      onChange={e => setNewEvent(ev => ({ ...ev, allDay: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-7 rounded-full bg-[color:var(--dashboard-hover)] border border-[color:var(--dashboard-panel-border)] peer-checked:bg-primary transition-colors" />
                    <div className="absolute left-1 top-1 h-5 w-5 rounded-full bg-white peer-checked:translate-x-5 transition-transform" />
                  </label>
                </div>

                {!newEvent.allDay && (
                  <div className="grid grid-cols-2 border-t border-[color:var(--dashboard-panel-border)]">
                    <div className="px-6 py-5 border-r border-[color:var(--dashboard-panel-border)]">
                      <label className="text-[11px] text-theme-muted font-medium block mb-2">Start</label>
                      <input
                        type="time"
                        value={newEvent.startTime}
                        onChange={e => setNewEvent(ev => ({ ...ev, startTime: e.target.value }))}
                        className="w-full bg-transparent text-[14px] text-theme-fg outline-none"
                      />
                    </div>
                    <div className="px-6 py-5">
                      <label className="text-[11px] text-theme-muted font-medium block mb-2">End</label>
                      <input
                        type="time"
                        value={newEvent.endTime}
                        onChange={e => setNewEvent(ev => ({ ...ev, endTime: e.target.value }))}
                        className="w-full bg-transparent text-[14px] text-theme-fg outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="border-t border-[color:var(--dashboard-panel-border)] px-6 py-5">
                  <label className="text-[11px] text-theme-muted font-medium block mb-2">Repeat</label>
                  <select
                    value={newEvent.recurring}
                    onChange={e => setNewEvent(ev => ({ ...ev, recurring: e.target.value as any }))}
                    className="w-full bg-transparent text-[14px] text-theme-fg outline-none"
                  >
                    <option value="none">Does not Repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="border-t border-[color:var(--dashboard-panel-border)] px-6 py-5">
                  <input
                    type="text"
                    value={newEvent.location}
                    onChange={e => setNewEvent(ev => ({ ...ev, location: e.target.value }))}
                    placeholder="Add Location"
                    className="w-full bg-transparent text-[14px] text-theme-fg placeholder:text-theme-muted/70 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-[52px] xl:pt-[52px]">
              <div className="dashboard-card p-0 overflow-hidden rounded-[28px]">
                <textarea
                  value={newEvent.description}
                  onChange={e => setNewEvent(ev => ({ ...ev, description: e.target.value }))}
                  placeholder="Add description"
                  rows={4}
                  className="w-full bg-transparent px-6 py-6 text-[18px] text-theme-fg placeholder:text-theme-muted/70 outline-none resize-none"
                />

                <div className="border-t border-[color:var(--dashboard-panel-border)] px-6 py-5">
                  <div className="text-[14px] text-theme-fg font-medium mb-2">Side note</div>
                  <textarea
                    value={newEvent.description}
                    onChange={e => setNewEvent(ev => ({ ...ev, description: e.target.value }))}
                    placeholder="Add a side note"
                    rows={7}
                    className="w-full bg-transparent text-[14px] leading-relaxed text-theme-fg placeholder:text-theme-muted/70 outline-none resize-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="flex-1 grid gap-5 min-h-0 xl:grid-cols-[minmax(0,1.4fr)_370px]">
        <div className="flex min-h-0 flex-col overflow-hidden relative">
          {calendarLoading && (
            <div className="absolute inset-0 bg-theme-bg/60 backdrop-blur-[2px] flex items-center justify-center z-30">
              <div className="text-[13px] text-theme-fg flex items-center gap-2 bg-theme-card p-3 rounded-theme-card border border-theme shadow-lg">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading calendar...
              </div>
            </div>
          )}

          {calendarError && (
            <div className="shrink-0 px-4 py-3 border-b border-theme/30 bg-[color:var(--dashboard-panel-solid)]/70">
              <div className="flex items-center gap-2 text-[12px] font-medium text-theme-muted">
                <WifiOff className="w-3.5 h-3.5 text-theme-muted/60 shrink-0" />
                <span>{calendarError}</span>
              </div>
              <div className="text-[11px] text-theme-muted/70 ml-5.5 mt-0.5">Local events, tasks, and reminders work offline.</div>
            </div>
          )}

          <div className="px-6 pb-5 pt-6 shrink-0">
            <div className="flex flex-col items-center gap-4">
              <div className="inline-flex items-center rounded-full border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)] p-1 shadow-sm">
                <button
                  onClick={handleSwitchToToday}
                  className={clsx(
                    "px-4 py-2 text-[14px] font-semibold rounded-full transition-all min-w-[58px]",
                    calendarView === "today" ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Day
                </button>
                <button
                  onClick={() => onChangeCalendarView("month")}
                  className={clsx(
                    "px-4 py-2 text-[14px] font-semibold rounded-full transition-all min-w-[70px]",
                    calendarView === "month" ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Month
                </button>
              </div>

              <div className="flex items-center justify-center gap-3 text-theme-muted">
                <button
                  onClick={() => {
                    if (calendarView === 'today') {
                      const d = toLocalDate(viewDateIso);
                      d.setDate(d.getDate() - 1);
                      setSelectedDateKey(formatLocalDateKey(d));
                      return;
                    }
                    if (onMonthChange && calendarRefDate) {
                      const d = new Date(calendarRefDate);
                      d.setMonth(d.getMonth() - 1);
                      onMonthChange(d);
                    }
                  }}
                  className="p-2 rounded-full hover:bg-[color:var(--dashboard-hover)] hover:text-theme-fg transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[15px] md:text-[16px] font-semibold text-theme-fg min-w-[150px] text-center">
                  {calendarView === 'today'
                    ? toLocalDate(viewDateIso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' })
                    : (calendarRefDate
                        ? calendarRefDate.toLocaleDateString(undefined, { month: 'long' })
                        : new Date().toLocaleDateString(undefined, { month: 'long' }))}
                </span>
                <button
                  onClick={() => {
                    if (calendarView === 'today') {
                      const d = toLocalDate(viewDateIso);
                      d.setDate(d.getDate() + 1);
                      setSelectedDateKey(formatLocalDateKey(d));
                      return;
                    }
                    if (onMonthChange && calendarRefDate) {
                      const d = new Date(calendarRefDate);
                      d.setMonth(d.getMonth() + 1);
                      onMonthChange(d);
                    }
                  }}
                  className="p-2 rounded-full hover:bg-[color:var(--dashboard-hover)] hover:text-theme-fg transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {calendarView === "today" && (
            <div
              className="flex-1 overflow-y-auto custom-scrollbar relative px-6 pb-6"
              ref={timelineRef}
            >
              {allDayBlocks.length > 0 && (
                <div className="mb-4 rounded-[24px] border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/60 px-4 py-3 sticky top-0 z-20 backdrop-blur-sm">
                  <div className="text-[10px] font-bold text-theme-muted mb-1 px-2 uppercase tracking-widest">All Day</div>
                  <div className="flex flex-col gap-1">
                    {allDayBlocks.map((b: any) => (
                      <button
                        key={b.id}
                        onClick={() => onSelectBlock(String(b.id))}
                        className={clsx(
                          "text-left px-3 py-1.5 rounded-theme-button border text-[11px] font-medium truncate transition-all",
                          selectedBlockId === String(b.id) ? "bg-primary text-primary-fg border-primary shadow-md" : "bg-theme-hover text-theme-fg border-theme hover:bg-theme-active hover:shadow-sm"
                        )}
                      >
                        {b.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div
                className="relative"
                style={{ minHeight: `${HOURS.length * HOUR_HEIGHT}px` }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleTimelineDrop}
              >
                {HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute inset-x-0 flex items-start"
                    style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <span className="w-[62px] pr-4 pt-1 text-right text-[12px] text-theme-muted/80 h-fit font-medium tracking-[0.08em]">
                      {h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`}
                    </span>
                    <div className="flex-1 h-[calc(100%-10px)] rounded-[20px] border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]" />
                  </div>
                ))}

                {viewDateIso === currentLocalIso && (
                  <div
                    className="absolute left-[62px] right-0 z-10 pointer-events-none"
                    style={{
                      top: (new Date().getHours() * HOUR_HEIGHT) + (new Date().getMinutes() / 60 * HOUR_HEIGHT)
                    }}
                  >
                    <div className="relative h-[2px] bg-primary/95 shadow-[0_0_18px_rgba(0,122,204,0.35)]">
                      <div className="absolute -left-1.5 -top-[5px] w-4 h-4 rounded-full bg-primary shadow-[0_0_18px_rgba(0,122,204,0.45)]" />
                    </div>
                  </div>
                )}

                <div className="absolute left-[62px] right-0 top-0 bottom-0">
                {dayBlockLayouts.map((entry) => {
                  const b = entry.block;
                  const isSelected = selectedBlockId === String(b.id);
                  const left = `calc(${(entry.column * 100) / entry.maxColumns}% + ${entry.column * 8}px)`;
                  const width = `calc(${100 / entry.maxColumns}% - 8px)`;
                  return (
                    <div
                      key={b.id}
                      draggable={true}
                      className={clsx(
                        "absolute rounded-[18px] border p-4 text-left overflow-hidden cursor-pointer transition-all hover:z-20 cursor-move shadow-[0_14px_34px_rgba(0,0,0,0.18)] group/block",
                        isSelected
                          ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg border-orange-400 z-20 shadow-[0_18px_40px_rgba(0,0,0,0.22)]"
                          : b.source === 'reminder'
                            ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg border-amber-500 hover:border-amber-400 z-10"
                            : b.source === 'task'
                              ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg border-emerald-500 hover:border-emerald-400 z-10"
                              : b.source === 'local'
                                ? "bg-[color:var(--dashboard-panel-solid)] text-theme-fg border-violet-500 hover:border-violet-400 z-10"
                                : "bg-[color:var(--dashboard-panel-solid)] text-theme-fg border-orange-400 hover:border-orange-300 z-10"
                      )}
                      style={{
                        top: entry.top + 8,
                        left,
                        width,
                        height: Math.max(entry.height - 12, 84),
                      }}
                      onDragStart={(e) => {
                        setDragBlock(b);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(b.id));
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectBlock(String(b.id));
                      }}
                    >
                      <div className="text-[16px] font-semibold leading-tight break-words">{b.title || "(No title)"}</div>
                     <div className="text-[13px] opacity-75 mt-4 font-medium">
                        {entry.start.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}, {entry.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {entry.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          )}

          {calendarView === "month" && (
            <div className="flex-1 flex flex-col px-6 pb-6 pt-2 min-h-0 overflow-hidden">
              <div className="grid grid-cols-7 mb-5 shrink-0">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                  <div key={day} className="text-center text-[13px] font-semibold text-theme-fg/90">
                    {day}
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 auto-rows-fr gap-x-2 gap-y-3 min-h-0 overflow-y-auto custom-scrollbar">
                {monthWeeks.map((week, i) => (
                  <React.Fragment key={i}>
                    {week.map((day) => {
                      const isSelected = selectedDateKey === day.date;
                      const dayNum = parseInt(day.date.split('-')[2], 10);
                      const isToday = day.isToday;
                      return (
                        <button
                          key={day.date}
                          onClick={() => {
                            setSelectedDateKey(day.date);
                            if (day.blocks[0]?.id != null) {
                              onSelectBlock(String(day.blocks[0].id));
                            }
                            if (!day.isCurrentMonth && onMonthChange) {
                              const d = toLocalDate(day.date);
                              onMonthChange(new Date(d.getFullYear(), d.getMonth(), 1));
                            }
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragBlock && onRescheduleBlock) {
                              onRescheduleBlock(dragBlock, day.date);
                              setDragBlock(null);
                            }
                          }}
                          className={clsx(
                            "relative h-[64px] rounded-[18px] transition-all hover:z-10 cursor-pointer overflow-hidden flex items-center justify-center",
                            isSelected
                              ? "border border-primary bg-primary/5 shadow-[0_0_0_1px_rgba(37,99,235,0.2)]"
                              : day.isCurrentMonth ? "border border-transparent hover:bg-[color:var(--dashboard-hover)]" : "border border-transparent opacity-30"
                          )}
                        >
                          {day.blocks.length > 0 && (
                            <div className="absolute top-[6px] right-[6px] flex items-center">
                              <div className="flex items-center -space-x-[5px]">
                                {day.blocks.slice(0, 3).map((b: any, idx: number) => {
                                  return (
                                    <span
                                      key={`${b.id}-${idx}`}
                                      className="w-[10px] h-[10px] rounded-full ring-[1.5px] ring-[color:var(--dashboard-bg,var(--theme-bg))]"
                                      style={{ zIndex: 3 - idx, backgroundColor: DOT_COLORS[idx % DOT_COLORS.length] }}
                                    />
                                  );
                                })}
                              </div>
                              {day.blocks.length > 3 && (
                                <span className="text-[8px] leading-none font-bold text-theme-muted ml-1">+{day.blocks.length - 3}</span>
                              )}
                            </div>
                          )}
                          <span className={clsx(
                            "text-[24px] font-medium leading-none transition-all",
                            isSelected ? "text-theme-fg" : isToday ? "text-primary" : day.isCurrentMonth ? "text-theme-fg/92" : "text-theme-muted"
                          )}>
                            {dayNum}
                          </span>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedBlock ? (
          <div className="dashboard-card overflow-y-auto custom-scrollbar animate-in slide-in-from-right-2 duration-300 px-5 py-6 rounded-[30px]">
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[14px] font-medium text-theme-muted">
                  <span className={clsx("w-3.5 h-3.5 rounded-full", selectedBlockMeta.dotClass)} />
                  <span>{selectedBlockMeta.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedBlock.htmlLink && (
                    <button
                      onClick={() => handleOpenLink(selectedBlock.htmlLink)}
                      className="dashboard-card-muted p-2 rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                      title="Open link"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  )}
                  {selectedBlock.htmlLink && (
                    <button
                      onClick={() => handleCopyLink(selectedBlock.htmlLink)}
                      className="dashboard-card-muted p-2 rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                      title="Copy link"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  )}
                  {selectedBlock.source === 'local' && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this local event?')) {
                          handleDeleteLocalEvent(String(selectedBlock.id));
                        }
                      }}
                      className="dashboard-card-muted p-2 rounded-xl text-theme-muted hover:text-red-400 transition-colors"
                      title="Delete event"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[18px] md:text-[20px] font-semibold text-theme-fg leading-tight">{selectedBlock.title || "(No Title)"}</h3>
                <div className="text-[13px] text-theme-muted font-medium">
                  {selectedBlock.start ? new Date(selectedBlock.start).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' }) : ''}
                  {renderTimeLabel(selectedBlock) ? `, ${renderTimeLabel(selectedBlock)}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={clsx("inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-[12px] font-medium", selectedBlockMeta.chipClass)}>
                  <span className={clsx("w-2 h-2 rounded-full", selectedBlockMeta.dotClass)} />
                  {selectedBlockMeta.label}
                </span>
                {selectedBlock.location && (
                  <span className="dashboard-card-muted inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-[12px] font-medium text-theme-fg">
                    <MapPin className="w-3.5 h-3.5 text-theme-muted" />
                    {selectedBlock.location}
                  </span>
                )}
                {selectedBlock.htmlLink && (
                  <button
                    onClick={() => handleCopyLink(selectedBlock.htmlLink)}
                    className="dashboard-card-muted inline-flex items-center gap-2 px-3 py-2 rounded-2xl text-[12px] font-medium text-theme-fg transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-theme-muted" />
                    Copy Link
                  </button>
                )}
              </div>

              {selectedDescriptionItems.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[14px] font-semibold text-theme-fg">Items</div>
                  <div className="dashboard-card-muted p-4 rounded-3xl space-y-3">
                    {selectedDescriptionItems.map((item, idx) => (
                      <div key={`${item}-${idx}`} className="text-[13px] leading-relaxed text-theme-fg font-medium">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedBlock.attendees && selectedBlock.attendees.length > 0 && (
                <div className="space-y-3">
                  <div className="text-[14px] font-semibold text-theme-fg">Attendees</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedBlock.attendees.map((a: string) => (
                      <span key={a} className="dashboard-card-muted px-3 py-2 rounded-2xl text-[12px] text-theme-fg font-medium">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="text-[14px] font-semibold text-theme-fg">Quick Actions</div>
                <div className="space-y-2.5">
                  {selectedBlock.htmlLink && (
                    <button
                      onClick={() => handleOpenLink(selectedBlock.htmlLink)}
                      className="dashboard-card-muted w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium text-theme-fg transition-all"
                    >
                      <Link2 className="w-4 h-4 text-theme-muted" />
                      Open in Calendar
                    </button>
                  )}
                  {selectedBlock.htmlLink && (
                    <button
                      onClick={() => handleCopyLink(selectedBlock.htmlLink)}
                      className="dashboard-card-muted w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium text-theme-fg transition-all"
                    >
                      <Copy className="w-4 h-4 text-theme-muted" />
                      Copy Link
                    </button>
                  )}
                  {selectedBlock.source === 'local' && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this local event?')) {
                          handleDeleteLocalEvent(String(selectedBlock.id));
                        }
                      }}
                      className="dashboard-card-muted w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-medium text-red-400 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Local Event
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard-card min-h-[320px] flex flex-col items-center justify-center text-center p-8 rounded-[30px] group transition-all">
            <div className="w-16 h-16 dashboard-card-muted rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <CalendarIcon className="w-8 h-8 text-theme-muted opacity-30 group-hover:opacity-60 transition-opacity" />
            </div>
            <p className="text-[16px] font-semibold text-theme-fg">No event selected</p>
            <p className="text-[13px] text-theme-muted mt-2 max-w-[220px]">Choose a day or event from the planner to inspect details here.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
};
