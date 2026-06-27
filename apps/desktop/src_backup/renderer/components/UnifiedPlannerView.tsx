import React, { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, Clock, Plus, RefreshCw, Link2, ChevronLeft, ChevronRight } from "lucide-react";
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
  plannerAddOpen: boolean;
  setPlannerAddOpen: (open: boolean) => void;
  plannerAddType: "task" | "reminder";
  setPlannerAddType: (type: "task" | "reminder") => void;
  plannerAddTitle: string;
  setPlannerAddTitle: (v: string) => void;
  plannerAddWhen: string;
  setPlannerAddWhen: (v: string) => void;
  plannerAddPriority: "low" | "normal" | "high";
  setPlannerAddPriority: (v: "low" | "normal" | "high") => void;
  plannerAddSaving: boolean;
  plannerAddError: string | null;
  setPlannerAddError: (v: string | null) => void;
  onSubmitAdd: () => void;
  AGENT_HTTP?: string;
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
  plannerAddOpen, setPlannerAddOpen,
  plannerAddType, setPlannerAddType,
  plannerAddTitle, setPlannerAddTitle,
  plannerAddWhen, setPlannerAddWhen,
  plannerAddPriority, setPlannerAddPriority,
  plannerAddSaving, plannerAddError, setPlannerAddError,
  onSubmitAdd,
}) => {

  const [selectedDateKey, setSelectedDateKey] = React.useState<string | null>(null);
  const [dragBlock, setDragBlock] = React.useState<any | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

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

  const dayBlocks = React.useMemo(() => {
    if (!Array.isArray(calendarBlocksSorted)) return [];
    return calendarBlocksSorted.filter(b => {
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
  }, [calendarBlocksSorted, viewDateIso]);

  const allDayBlocks = React.useMemo(() => {
    if (!Array.isArray(calendarBlocksSorted)) return [];
    return calendarBlocksSorted.filter(b => {
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
  }, [calendarBlocksSorted, viewDateIso]);

  const monthWeeks = React.useMemo(() => {
    if (calendarView !== "month") return [];
    if (Array.isArray(calendarDays) && calendarDays.length > 0) {
      const dayMap: Record<string, any[]> = {};
      for (const d of calendarDays) {
        if (d && d.date) dayMap[d.date] = d.blocks || [];
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
    }
    return [];
  }, [calendarView, calendarRange, calendarDays, calendarRefDate]);

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
    <div className="h-[calc(100vh-140px)] flex flex-col gap-4">
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
            onClick={onRefresh}
            className="p-2 rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            title="Refresh Calendar"
          >
            <RefreshCw className={clsx("w-4 h-4", calendarLoading && "animate-spin")} />
          </button>
          <button
            onClick={() => { setPlannerAddOpen(true); setPlannerAddError(null); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Item
          </button>
        </div>
      </div>

      {plannerAddOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-card border border-theme rounded-theme-card shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-stuard font-bold text-theme-fg mb-1">New {plannerAddType === 'task' ? 'Task' : 'Reminder'}</h3>
            <p className="text-[12px] text-theme-muted mb-6">Plan your next move with Stuard.</p>

            <div className="flex gap-2 mb-4 p-1 bg-theme-hover rounded-theme-button border border-theme">
              <button
                onClick={() => setPlannerAddType("task")}
                className={clsx("flex-1 py-1.5 text-[12px] font-bold rounded-theme-button transition-all", plannerAddType === "task" ? "bg-theme-card text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg")}
              >
                Task
              </button>
              <button
                onClick={() => setPlannerAddType("reminder")}
                className={clsx("flex-1 py-1.5 text-[12px] font-bold rounded-theme-button transition-all", plannerAddType === "reminder" ? "bg-theme-card text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg")}
              >
                Reminder
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-theme-muted uppercase tracking-wide mb-1">Title</label>
                <input
                  autoFocus
                  value={plannerAddTitle}
                  onChange={(e) => setPlannerAddTitle(e.target.value)}
                  placeholder={plannerAddType === "task" ? "What needs doing?" : "What to remind you about?"}
                  className="w-full px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-theme-muted"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-theme-muted uppercase tracking-wide mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  value={plannerAddWhen}
                  onChange={(e) => setPlannerAddWhen(e.target.value)}
                  className="w-full px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              {plannerAddType === "task" && (
                <div>
                  <label className="block text-[11px] font-bold text-theme-muted uppercase tracking-wide mb-1">Priority</label>
                  <select
                    value={plannerAddPriority}
                    onChange={(e: any) => setPlannerAddPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-theme-button border border-theme bg-theme-hover text-theme-fg text-[13px] focus:outline-none focus:border-primary"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
              )}

              {plannerAddError && (
                <div className="text-[11px] text-red-500 bg-red-500/10 px-3 py-2 rounded-theme-button border border-red-500/20">
                  {plannerAddError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-8">
              <button
                onClick={() => setPlannerAddOpen(false)}
                className="px-4 py-2 rounded-theme-button text-[12px] font-medium text-theme-muted hover:bg-theme-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onSubmitAdd}
                disabled={plannerAddSaving}
                className="px-4 py-2 rounded-theme-button bg-primary text-primary-fg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 transition-colors shadow-sm"
              >
                {plannerAddSaving ? "Saving..." : "Create Item"}
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="flex-1 flex items-center justify-center flex-col gap-2 text-center p-8">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                <span className="text-xl text-red-500">⚠️</span>
              </div>
              <p className="text-[13px] font-bold text-theme-fg">{calendarError}</p>
              <p className="text-[12px] text-theme-muted">Check your integration settings.</p>
            </div>
          )}

          {!calendarError && calendarView === "today" && (
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

          {!calendarError && calendarView === "month" && (
            <div className="flex-1 flex flex-col p-4 bg-theme-bg">
              <div className="grid grid-cols-7 mb-3">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                  <div key={day} className="text-center text-[10px] font-black text-theme-muted uppercase tracking-widest">
                    {day}
                  </div>
                ))}
              </div>
              <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-2">
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
                            "relative p-1.5 flex flex-col items-start justify-start rounded-theme-card border transition-all hover:z-10 cursor-pointer shadow-sm",
                            isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : day.isCurrentMonth ? "border-theme bg-theme-card hover:border-primary/40 hover:bg-theme-hover hover:shadow-md" : "border-transparent bg-transparent text-theme-muted opacity-30"
                          )}
                        >
                          <span className={clsx(
                            "text-[11px] font-black w-7 h-7 flex items-center justify-center rounded-full mb-1 transition-all",
                            isToday ? "bg-primary text-primary-fg shadow-lg" : "text-theme-muted"
                          )}>
                            {dayNum}
                          </span>
                          <div className="w-full space-y-1 overflow-hidden">
                            {day.blocks.slice(0, 3).map((b: any) => (
                              <div key={b.id} className="w-full text-[9px] px-2 py-1 rounded-theme-button bg-theme-hover text-theme-fg truncate text-left pointer-events-none border border-theme font-bold">
                                {b.title}
                              </div>
                            ))}
                            {day.blocks.length > 3 && (
                              <div className="text-[9px] text-theme-muted pl-1 font-bold">+{day.blocks.length - 3} more</div>
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
                <h3 className="text-[18px] font-stuard font-bold text-theme-fg leading-tight mb-2">{selectedBlock.title || "(No Title)"}</h3>
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
    </div>
  );
};
