import React, { useEffect, useRef, useState, useMemo } from "react";
import { Calendar as CalendarIcon, Clock, Plus, RefreshCw, Link2, ChevronLeft, ChevronRight, ListTodo, Bell, Trash2, MapPin, WifiOff } from "lucide-react";
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

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
    setSelectedDateKey(formatLocalDateKey(new Date()));
    if (onMonthChange) onMonthChange(new Date());
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

  // Convert tasks with due dates to calendar blocks
  const taskBlocks = useMemo(() => {
    return tasks
      .filter(t => t.dueDate && t.status !== 'completed' && t.showInCalendar !== false)
      .map(t => ({
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
      }));
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
          timelineRef.current.scrollTop = 8 * HOUR_HEIGHT;
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [calendarView]);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col gap-4" data-onboarding="planner-calendar">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-theme-card rounded-theme-button p-0.5 border border-theme">
            <button
              onClick={handleSwitchToToday}
              className={clsx(
                "px-3 py-1.5 text-[12px] font-bold rounded-theme-button transition-all",
                calendarView === "today" ? "bg-primary text-primary-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
              )}
            >
              Day
            </button>
            <button
              onClick={() => onChangeCalendarView("month")}
              className={clsx(
                "px-3 py-1.5 text-[12px] font-bold rounded-theme-button transition-all",
                calendarView === "month" ? "bg-primary text-primary-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
              )}
            >
              Month
            </button>
          </div>

          {calendarView === 'today' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const d = toLocalDate(viewDateIso);
                  d.setDate(d.getDate() - 1);
                  setSelectedDateKey(formatLocalDateKey(d));
                }}
                className="p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[15px] font-stuard font-bold text-theme-fg min-w-[140px] text-center">
                {toLocalDate(viewDateIso).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
              </span>
              <button
                onClick={() => {
                  const d = toLocalDate(viewDateIso);
                  d.setDate(d.getDate() + 1);
                  setSelectedDateKey(formatLocalDateKey(d));
                }}
                className="p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {calendarView === 'month' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (onMonthChange && calendarRefDate) {
                    const d = new Date(calendarRefDate);
                    d.setMonth(d.getMonth() - 1);
                    onMonthChange(d);
                  }
                }}
                className="p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[15px] font-stuard font-bold text-theme-fg min-w-[140px] text-center">
                {calendarRefDate
                  ? calendarRefDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
                  : new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => {
                  if (onMonthChange && calendarRefDate) {
                    const d = new Date(calendarRefDate);
                    d.setMonth(d.getMonth() + 1);
                    onMonthChange(d);
                  }
                }}
                className="p-1.5 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewEvent(e => ({ ...e, date: selectedDateKey || formatLocalDateKey(new Date()) }));
              setShowAddEvent(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 transition-all shadow-sm"
            title="Add Local Event"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Event
          </button>
          <button
            onClick={onRefresh}
            className="p-2 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            title="Refresh Calendar"
          >
            <RefreshCw className={clsx("w-4 h-4", calendarLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        <div className="flex-1 bg-theme-card rounded-theme-card border border-theme shadow-sm overflow-hidden flex flex-col relative">
          {calendarLoading && (
            <div className="absolute inset-0 bg-theme-bg/60 backdrop-blur-[2px] flex items-center justify-center z-30">
              <div className="text-[13px] text-theme-fg flex items-center gap-2 bg-theme-card p-3 rounded-theme-card border border-theme shadow-lg">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading calendar...
              </div>
            </div>
          )}

          {calendarError && (
            <div className="shrink-0 px-4 py-2 border-b border-theme/30 bg-theme-card/50">
              <div className="flex items-center gap-2 text-[12px] font-medium text-theme-muted">
                <WifiOff className="w-3.5 h-3.5 text-theme-muted/60 shrink-0" />
                <span>{calendarError}</span>
              </div>
              <div className="text-[11px] text-theme-muted/70 ml-5.5 mt-0.5">Local events, tasks, and reminders work offline.</div>
            </div>
          )}

          {calendarView === "today" && (
            <div
              className="flex-1 overflow-y-auto custom-scrollbar relative flex flex-col bg-theme-bg"
              ref={timelineRef}
            >
              {allDayBlocks.length > 0 && (
                <div className="border-b border-theme p-2 bg-theme-card sticky top-0 z-20 shadow-sm">
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
                className="relative min-h-[1536px]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleTimelineDrop}
              >
                {HOURS.map(h => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-theme/50 flex"
                    style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <span className="w-14 text-right pr-3 text-[10px] text-theme-muted/60 -mt-2.5 bg-transparent h-fit sticky left-0 font-mono font-bold uppercase">
                      {h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`}
                    </span>
                  </div>
                ))}

                {viewDateIso === currentLocalIso && (
                  <div
                    className="absolute w-full border-t-2 border-red-500 z-10 pointer-events-none opacity-60"
                    style={{
                      top: (new Date().getHours() * HOUR_HEIGHT) + (new Date().getMinutes() / 60 * HOUR_HEIGHT)
                    }}
                  >
                    <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500 shadow-sm" />
                  </div>
                )}

                {dayBlocks.map((b: any) => {
                  let start: Date;
                  let end: Date;
                  try {
                    start = new Date(b.start);
                    end = new Date(b.end);
                    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
                  } catch { return null; }
                  const startMinutes = start.getHours() * 60 + start.getMinutes();
                  const endMinutes = end.getHours() * 60 + end.getMinutes();
                  const durationMinutes = Math.max(15, endMinutes - startMinutes);
                  const top = (startMinutes / 60) * HOUR_HEIGHT;
                  const height = (durationMinutes / 60) * HOUR_HEIGHT;
                  const isSelected = selectedBlockId === String(b.id);
                  return (
                    <div
                      key={b.id}
                      draggable={true}
                      className={clsx(
                        "absolute left-16 right-4 rounded-theme-button border p-2.5 text-[11px] overflow-hidden cursor-pointer transition-all hover:z-20 cursor-move shadow-sm group/block",
                        isSelected
                          ? "bg-primary text-primary-fg border-primary z-20 shadow-xl scale-[1.01]"
                          : b.source === 'task'
                            ? "bg-emerald-500/10 text-theme-fg border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 z-10 border-l-4 border-l-emerald-500"
                            : b.source === 'local'
                              ? "bg-violet-500/10 text-theme-fg border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 z-10 border-l-4 border-l-violet-500"
                              : "bg-theme-card text-theme-fg border-theme hover:border-primary/30 hover:bg-theme-hover z-10 border-l-4 border-l-primary"
                      )}
                      style={{
                        top,
                        height: Math.max(height, 28),
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
                      <div className="font-bold truncate leading-tight group-hover/block:text-primary transition-colors">{b.title || "(No title)"}</div>
                      <div className={clsx("text-[10px] truncate opacity-70 mt-0.5 font-medium")}>
                        {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {calendarView === "month" && (
            <div className="flex-1 flex flex-col p-3 bg-theme-bg min-h-0 overflow-hidden">
              <div className="grid grid-cols-7 mb-2 shrink-0">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                  <div key={day} className="text-center text-[10px] font-black text-theme-muted uppercase tracking-widest">
                    {day}
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 auto-rows-fr gap-1 min-h-0 overflow-y-auto custom-scrollbar">
                {monthWeeks.map((week, i) => (
                  <React.Fragment key={i}>
                    {week.map((day) => {
                      const isSelected = selectedDateKey === day.date;
                      const dayNum = parseInt(day.date.split('-')[2], 10);
                      const isToday = day.isToday;
                      return (
                        <div
                          key={day.date}
                          onClick={() => {
                            setSelectedDateKey(day.date);
                            onChangeCalendarView("today");
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
                            "relative p-1.5 flex flex-col items-start rounded-lg border transition-all hover:z-10 cursor-pointer min-h-0 overflow-hidden",
                            isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : day.isCurrentMonth ? "border-theme/50 bg-theme-card/50 hover:border-primary/40 hover:bg-theme-hover" : "border-transparent bg-transparent text-theme-muted opacity-30"
                          )}
                        >
                          <span className={clsx(
                            "text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-full shrink-0 transition-all",
                            isToday ? "bg-primary text-primary-fg shadow-lg" : "text-theme-muted"
                          )}>
                            {dayNum}
                          </span>
                          <div className="w-full space-y-0.5 overflow-hidden flex-1 min-h-0">
                            {day.blocks.slice(0, 2).map((b: any) => (
                              <div
                                key={b.id}
                                className={clsx(
                                  "w-full text-[8px] px-1.5 py-0.5 rounded truncate text-left pointer-events-none font-semibold flex items-center gap-1",
                                  b.source === 'task'
                                    ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/20"
                                    : b.source === 'local'
                                      ? "bg-violet-500/15 text-violet-600 border border-violet-500/20"
                                      : "bg-theme-hover text-theme-fg border border-theme"
                                )}
                              >
                                {b.source === 'task' && <ListTodo className="w-2.5 h-2.5 shrink-0" />}
                                {b.source === 'local' && <CalendarIcon className="w-2.5 h-2.5 shrink-0" />}
                                <span className="truncate">{b.title}</span>
                              </div>
                            ))}
                            {day.blocks.length > 2 && (
                              <div className="text-[8px] text-theme-muted pl-1 font-bold">+{day.blocks.length - 2}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>

        {selectedBlock ? (
          <div className="w-80 bg-theme-card rounded-theme-card border border-theme shadow-xl p-6 overflow-y-auto custom-scrollbar animate-in slide-in-from-right-2 duration-300">
            <div className="space-y-8">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[18px] font-stuard font-bold text-theme-fg leading-tight flex-1">{selectedBlock.title || "(No Title)"}</h3>
                  {selectedBlock.source === 'local' && (
                    <span className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 text-[9px] font-black uppercase tracking-wider border border-violet-500/20 shrink-0">Local</span>
                  )}
                  {selectedBlock.source === 'task' || selectedBlock.source === 'unified-tasks' ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-wider border border-emerald-500/20 shrink-0">Task</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-[12px] text-theme-muted font-bold">
                  <CalendarIcon className="w-4 h-4 text-primary" />
                  <span>{selectedBlock.start ? new Date(selectedBlock.start).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}</span>
                </div>
              </div>
              <div className="space-y-6">
                <div className="flex items-center gap-4 p-4 bg-theme-hover rounded-theme-card border border-theme shadow-inner">
                  <div className="p-2 bg-theme-card rounded-lg border border-theme">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-theme-muted uppercase tracking-widest">Time Slot</div>
                    <div className="text-[13px] text-theme-fg font-bold mt-0.5">{renderTimeLabel(selectedBlock)}</div>
                  </div>
                </div>
                {selectedBlock.description && (
                  <div>
                    <div className="text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      Description
                    </div>
                    <div className="text-[13px] text-theme-fg leading-relaxed bg-theme-hover/50 p-4 rounded-theme-card border border-theme/50 whitespace-pre-wrap font-medium">
                      {selectedBlock.description}
                    </div>
                  </div>
                )}
                {selectedBlock.location && (
                  <div>
                    <div className="text-[10px] font-black text-theme-muted uppercase tracking-widest mb-2">Location</div>
                    <div className="text-[13px] text-theme-fg font-medium bg-theme-hover px-3 py-2 rounded-lg border border-theme inline-block">{selectedBlock.location}</div>
                  </div>
                )}
                {selectedBlock.attendees && selectedBlock.attendees.length > 0 && (
                  <div>
                    <div className="text-[10px] font-black text-theme-muted uppercase tracking-widest mb-3">Attendees</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedBlock.attendees.map((a: string) => (
                        <span key={a} className="px-3 py-1.5 rounded-full bg-theme-hover text-[11px] text-theme-fg border border-theme font-bold shadow-sm">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {selectedBlock.htmlLink && (
                <div className="pt-6 border-t border-theme">
                  <button
                    onClick={() => handleOpenLink(selectedBlock.htmlLink)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-theme-button bg-theme-hover text-primary hover:text-primary-fg hover:bg-primary text-[12px] font-bold transition-all border border-theme hover:border-primary shadow-sm"
                  >
                    <Link2 className="w-4 h-4" />
                    Open in Calendar
                  </button>
                </div>
              )}
              {selectedBlock.source === 'local' && (
                <div className="pt-4 border-t border-theme">
                  <button
                    onClick={() => {
                      if (confirm('Delete this local event?')) {
                        handleDeleteLocalEvent(String(selectedBlock.id));
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-theme-button bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white text-[12px] font-bold transition-all border border-red-500/20 hover:border-red-500 shadow-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Local Event
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="w-80 flex flex-col items-center justify-center text-center p-8 bg-theme-card rounded-theme-card border border-theme border-dashed group shadow-sm hover:bg-theme-hover/20 transition-all">
            <div className="w-16 h-16 bg-theme-hover rounded-full flex items-center justify-center mb-6 border border-theme group-hover:scale-110 transition-transform">
              <CalendarIcon className="w-8 h-8 text-theme-muted opacity-30 group-hover:opacity-60 transition-opacity" />
            </div>
            <p className="text-[14px] font-bold text-theme-fg">No event selected</p>
            <p className="text-[12px] text-theme-muted mt-2 max-w-[160px]">Select an item from the calendar to view full details here.</p>
          </div>
        )}
      </div>

      {/* Add Local Event Modal */}
      {showAddEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddEvent(false)}>
          <div
            className="bg-theme-card rounded-2xl border border-theme shadow-2xl w-[420px] max-h-[80vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-theme">
              <h3 className="text-[16px] font-black text-theme-fg tracking-tight">Add Local Event</h3>
              <p className="text-[11px] text-theme-muted mt-0.5">This event is stored locally and works offline.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Title *</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={e => setNewEvent(ev => ({ ...ev, title: e.target.value }))}
                  placeholder="Meeting, Appointment, etc."
                  className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg placeholder:text-theme-muted/50 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Date</label>
                  <input
                    type="date"
                    value={newEvent.date}
                    onChange={e => setNewEvent(ev => ({ ...ev, date: e.target.value }))}
                    className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  />
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <input
                    type="checkbox"
                    id="allDay"
                    checked={newEvent.allDay}
                    onChange={e => setNewEvent(ev => ({ ...ev, allDay: e.target.checked }))}
                    className="rounded border-theme accent-primary"
                  />
                  <label htmlFor="allDay" className="text-[11px] font-bold text-theme-muted cursor-pointer">All day</label>
                </div>
              </div>

              {!newEvent.allDay && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Start Time</label>
                    <input
                      type="time"
                      value={newEvent.startTime}
                      onChange={e => setNewEvent(ev => ({ ...ev, startTime: e.target.value }))}
                      className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">End Time</label>
                    <input
                      type="time"
                      value={newEvent.endTime}
                      onChange={e => setNewEvent(ev => ({ ...ev, endTime: e.target.value }))}
                      className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Location</label>
                <input
                  type="text"
                  value={newEvent.location}
                  onChange={e => setNewEvent(ev => ({ ...ev, location: e.target.value }))}
                  placeholder="Optional"
                  className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg placeholder:text-theme-muted/50 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Description</label>
                <textarea
                  value={newEvent.description}
                  onChange={e => setNewEvent(ev => ({ ...ev, description: e.target.value }))}
                  placeholder="Optional notes..."
                  rows={2}
                  className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg placeholder:text-theme-muted/50 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all resize-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-theme-muted uppercase tracking-widest block mb-1.5">Repeat</label>
                <select
                  value={newEvent.recurring}
                  onChange={e => setNewEvent(ev => ({ ...ev, recurring: e.target.value as any }))}
                  className="w-full bg-theme-bg border border-theme rounded-xl px-3 py-2.5 text-[13px] text-theme-fg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-theme flex items-center justify-end gap-3">
              <button
                onClick={() => setShowAddEvent(false)}
                className="px-4 py-2 rounded-xl text-[12px] font-bold text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLocalEvent}
                disabled={!newEvent.title.trim()}
                className="px-5 py-2 rounded-xl bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
