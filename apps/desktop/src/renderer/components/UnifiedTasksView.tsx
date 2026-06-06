import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Plus,
  Check,
  Calendar,
  Trash2,
  ChevronDown,
  ChevronsUpDown,
  CalendarPlus,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  ArrowRight,
  X,
  Bell,
  Clock,
  ListChecks,
  Pencil,
  Cloud,
  MessageSquare,
} from 'lucide-react';
import type { UnifiedTask, TaskPriority, AgentAssignment } from '../types/tasks';
import { supabase } from '../lib/supabaseClient';

async function syncReminderToCloudSMS(opts: { message: string; scheduledAt: string; deliveryMethod?: string }) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const remindAt = new Date(opts.scheduledAt);
    if (isNaN(remindAt.getTime())) return;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const { error } = await supabase.from('cloud_reminders').insert({
      user_id: user.id,
      title: opts.message || 'Reminder',
      message: opts.message || null,
      remind_at: remindAt.toISOString(),
      timezone: tz,
      delivery_method: opts.deliveryMethod || 'sms',
    });
    if (error) console.error('Failed to sync reminder to cloud:', error.message);
  } catch (e) {
    console.error('Failed to sync reminder to cloud:', e);
  }
}

export type TaskSubTab = 'todo' | 'reminders';

interface UnifiedTasksViewProps {
  compact?: boolean;
  defaultSubTab?: TaskSubTab;
  onSubTabChange?: (tab: TaskSubTab) => void;
}

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; icon: string; bg: string }> = {
  low: { label: 'Low', color: 'text-theme-muted', icon: '', bg: 'bg-theme-muted/10' },
  normal: { label: 'Normal', color: 'text-blue-500', icon: '●', bg: 'bg-blue-500/10' },
  high: { label: 'High', color: 'text-orange-500', icon: '▲', bg: 'bg-orange-500/10' },
  urgent: { label: 'Urgent', color: 'text-red-500', icon: '🔥', bg: 'bg-red-500/10' },
};

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

// Tasks can arrive with a missing or non-standard priority (e.g. an agent/LLM
// writing `priority: "medium"` via task_crud, or older stored tasks). Map any
// unrecognized value to 'normal' so config lookups never return undefined.
function normalizePriority(priority: unknown): TaskPriority {
  return typeof priority === 'string' && priority in PRIORITY_CONFIG
    ? (priority as TaskPriority)
    : 'normal';
}

function TaskPriorityPicker({
  value,
  onChange,
  variant = 'dashboard',
}: {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  variant?: 'dashboard' | 'compact';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cfg = PRIORITY_CONFIG[normalizePriority(value)];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isDashboard = variant === 'dashboard';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={clsx(
          'relative flex items-center capitalize outline-none transition-colors',
          isDashboard
            ? 'h-8 min-w-[96px] rounded-[12px] bg-[color:var(--dashboard-hover)] pl-3 pr-7 text-[12px] font-medium text-theme-fg hover:opacity-90'
            : 'rounded-lg bg-theme-hover border border-theme/10 text-[10px] text-theme-muted px-2 py-1 hover:text-theme-fg'
        )}
      >
        <span>{cfg.label}</span>
        <ChevronsUpDown
          className={clsx(
            'absolute right-2 top-1/2 -translate-y-1/2 text-theme-muted pointer-events-none',
            isDashboard ? 'w-3 h-3' : 'w-2.5 h-2.5'
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className={clsx(
            'absolute z-50 min-w-[128px] overflow-hidden rounded-xl border shadow-lg animate-in fade-in zoom-in-95 duration-150',
            isDashboard
              ? 'bottom-full right-0 mb-1.5 border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-panel-solid)] py-1'
              : 'top-full left-0 mt-1 border-theme/10 bg-theme-card py-1'
          )}
        >
          {PRIORITY_OPTIONS.map((priority) => {
            const option = PRIORITY_CONFIG[priority];
            const selected = priority === value;
            return (
              <button
                key={priority}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(priority);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium transition-colors',
                  selected
                    ? isDashboard
                      ? 'bg-[color:var(--dashboard-hover)]'
                      : 'bg-theme-hover'
                    : isDashboard
                      ? 'hover:bg-[color:var(--dashboard-hover)]'
                      : 'hover:bg-theme-hover',
                  option.color
                )}
              >
                <span className="flex-1">{option.label}</span>
                {selected && <Check className="w-3.5 h-3.5 shrink-0 opacity-80" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ReminderWithTask = AgentAssignment & { taskId: string; taskTitle: string };

function UpcomingRemindersSection({
  reminders,
  compact,
  sectionRef,
  editingId,
  editDate,
  editTime,
  editMessage,
  onEditDate,
  onEditTime,
  onEditMessage,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onOpenTask,
}: {
  reminders: ReminderWithTask[];
  compact?: boolean;
  sectionRef?: React.RefObject<HTMLDivElement | null>;
  editingId: string | null;
  editDate: string;
  editTime: string;
  editMessage: string;
  onEditDate: (v: string) => void;
  onEditTime: (v: string) => void;
  onEditMessage: (v: string) => void;
  onStartEdit: (reminder: ReminderWithTask) => void;
  onCancelEdit: () => void;
  onSaveEdit: (reminder: ReminderWithTask) => void;
  onDelete: (reminder: ReminderWithTask) => void;
  onOpenTask: (taskId: string) => void;
}) {
  if (reminders.length === 0) return null;

  return (
    <div ref={sectionRef as React.RefObject<HTMLDivElement>} className={clsx(compact ? 'mb-3' : 'mb-5')}>
      <div className={clsx('flex items-center gap-2', compact ? 'mb-1.5 px-0.5' : 'mb-2.5 px-1')}>
        <Bell className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">
          Upcoming reminders
        </span>
        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold px-1">
          {reminders.length}
        </span>
      </div>
      <div className="space-y-2">
        {reminders.map((reminder) => {
          const reminderDate = new Date(reminder.scheduledAt);
          const isOverdue = reminderDate < new Date();
          const isSoon = !isOverdue && reminderDate.getTime() - Date.now() < 3600000;
          return (
            <div
              key={reminder.id}
              className={clsx(
                'p-3 rounded-xl border transition-all',
                isOverdue
                  ? 'bg-red-500/5 border-red-500/20'
                  : isSoon
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : compact
                      ? 'bg-theme-card border-theme/10 hover:border-theme/20'
                      : 'bg-transparent border-[color:var(--dashboard-panel-border)] hover:bg-[color:var(--dashboard-hover)]'
              )}
            >
              {editingId === reminder.id ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="date"
                      value={editDate}
                      onChange={(e) => onEditDate(e.target.value)}
                      className="bg-theme-hover border border-theme/10 rounded-lg text-[11px] px-2 py-1.5 outline-none"
                    />
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => onEditTime(e.target.value)}
                      className="bg-theme-hover border border-theme/10 rounded-lg text-[11px] px-2 py-1.5 outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    value={editMessage}
                    onChange={(e) => onEditMessage(e.target.value)}
                    placeholder="Reminder message..."
                    className="bg-theme-hover border border-theme/10 rounded-lg text-[11px] px-2 py-1.5 outline-none w-full"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSaveEdit(reminder)}
                      disabled={!editDate}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[11px] font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button
                      onClick={onCancelEdit}
                      className="px-3 py-1.5 text-[11px] text-theme-muted hover:text-theme-fg rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                      isOverdue ? 'bg-red-500/10' : isSoon ? 'bg-amber-500/10' : 'bg-theme-hover'
                    )}
                  >
                    <Bell
                      className={clsx(
                        'w-4 h-4',
                        isOverdue ? 'text-red-500' : isSoon ? 'text-amber-500' : 'text-theme-muted'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-theme-fg">
                      {reminder.message || reminder.taskTitle}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-3 h-3 text-theme-muted" />
                      <span
                        className={clsx(
                          'text-[10px] font-medium',
                          isOverdue ? 'text-red-500' : isSoon ? 'text-amber-600' : 'text-theme-muted'
                        )}
                      >
                        {isOverdue ? 'Overdue: ' : ''}
                        {reminderDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' at '}
                        {reminderDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    {reminder.taskTitle && (
                      <button
                        type="button"
                        onClick={() => onOpenTask(reminder.taskId)}
                        className="text-[10px] text-theme-muted mt-1 flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        <ListChecks className="w-3 h-3" />
                        {reminder.taskTitle}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      await syncReminderToCloudSMS({
                        message: reminder.message || reminder.taskTitle || 'Reminder',
                        scheduledAt: reminder.scheduledAt,
                      });
                      try {
                        (window as any).desktopAPI?.notify?.('Synced', 'Reminder synced to cloud SMS.');
                      } catch { /* ignore */ }
                    }}
                    className="p-1.5 text-theme-muted hover:text-sky-400 hover:bg-sky-400/10 rounded-lg transition-colors"
                    title="Sync to cloud SMS"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onStartEdit(reminder)}
                    className="p-1.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(reminder)}
                    className="p-1.5 text-theme-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const UnifiedTasksView: React.FC<UnifiedTasksViewProps> = ({ compact, defaultSubTab = 'todo', onSubTabChange }) => {
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingGlobalReminderId, setEditingGlobalReminderId] = useState<string | null>(null);
  const [editGlobalReminderDate, setEditGlobalReminderDate] = useState('');
  const [editGlobalReminderTime, setEditGlobalReminderTime] = useState('');
  const [editGlobalReminderMessage, setEditGlobalReminderMessage] = useState('');
  const remindersSectionRef = useRef<HTMLDivElement>(null);

  // New task form state
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    dueDate: '',
    dueTime: '',
    priority: 'normal' as TaskPriority,
  });

  const loadTasks = useCallback(async () => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksList?.();
      if (res?.ok) {
        setTasks(res.tasks || []);
      }
    } catch (e) {
      console.error('Failed to load tasks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleAddTask = async () => {
    if (!newTask.title.trim()) return;

    let dueDate: string | null = null;
    if (newTask.dueDate) {
      dueDate = newTask.dueTime
        ? `${newTask.dueDate}T${newTask.dueTime}:00`
        : newTask.dueDate;
    }

    const task = {
      title: newTask.title.trim(),
      description: newTask.description.trim() || undefined,
      dueDate,
      allDay: !newTask.dueTime,
      priority: newTask.priority,
      showInCalendar: true,
    };

    try {
      const res = await (window as any).desktopAPI?.unifiedTasksAdd?.(task);
      if (res?.ok) {
        setTasks(res.tasks || []);
        setNewTask({ title: '', description: '', dueDate: '', dueTime: '', priority: 'normal' });
        setIsAdding(false);
      }
    } catch (e) {
      console.error('Failed to add task:', e);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    // Optimistic update
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' } : t
    ));

    try {
      const res = await (window as any).desktopAPI?.unifiedTasksToggleStatus?.(taskId);
      if (res?.ok) {
        setTasks(res.tasks || []);
      }
    } catch (e) {
      console.error('Failed to toggle task:', e);
      loadTasks(); // Revert on error
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksDelete?.(taskId);
      if (res?.ok) {
        setTasks(res.tasks || []);
        if (expandedTaskId === taskId) setExpandedTaskId(null);
      }
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  const updateTask = (updatedTask: UnifiedTask) => {
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<UnifiedTask>): Promise<boolean> => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksUpdate?.({ id: taskId, ...updates });
      if (res?.ok) {
        if (Array.isArray(res.tasks)) {
          setTasks(res.tasks);
        } else if (res.task) {
          updateTask(res.task);
        }
        return true;
      }
    } catch (e) {
      console.error('Failed to update task:', e);
    }
    return false;
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (filter === 'pending') return task.status !== 'completed' && task.status !== 'cancelled';
      if (filter === 'completed') return task.status === 'completed';
      return true;
    }).sort((a, b) => {
       // Sort by priority (urgent first) then due date
       const pOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
       const aOrder = pOrder[normalizePriority(a.priority)];
       const bOrder = pOrder[normalizePriority(b.priority)];
       if (aOrder !== bOrder) return aOrder - bOrder;
       if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
       if (a.dueDate) return -1;
       if (b.dueDate) return 1;
       return 0;
    });
  }, [tasks, filter]);

  // Get all reminders from tasks (must be before any early returns for hooks rules)
  const allReminders = useMemo(() => {
    const reminders: Array<AgentAssignment & { taskId: string; taskTitle: string }> = [];
    for (const task of tasks) {
      if (task.agentAssignments) {
        for (const r of task.agentAssignments) {
          if (r.status === 'pending') {
            reminders.push({ ...r, taskId: task.id, taskTitle: task.title });
          }
        }
      }
    }
    return reminders.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [tasks]);

  const startEditingReminder = useCallback((reminder: ReminderWithTask) => {
    const dt = reminder.scheduledAt ? String(reminder.scheduledAt).slice(0, 16) : '';
    setEditGlobalReminderDate(dt.slice(0, 10));
    setEditGlobalReminderTime(dt.slice(11, 16) || '09:00');
    setEditGlobalReminderMessage(reminder.message || reminder.taskTitle || 'Reminder');
    setEditingGlobalReminderId(reminder.id);
  }, []);

  const saveEditingReminder = useCallback(async (reminder: ReminderWithTask) => {
    if (!editGlobalReminderDate) return;
    const scheduledAt = `${editGlobalReminderDate}T${editGlobalReminderTime}:00`;
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksUpdateReminder?.(reminder.taskId, reminder.id, {
        scheduledAt,
        message: editGlobalReminderMessage,
      });
      if (res?.ok) {
        if (Array.isArray(res.tasks)) setTasks(res.tasks);
        else if (res.task) updateTask(res.task);
      }
    } catch (e) {
      console.error(e);
    }
    setEditingGlobalReminderId(null);
  }, [editGlobalReminderDate, editGlobalReminderTime, editGlobalReminderMessage]);

  const deleteReminder = useCallback(async (reminder: ReminderWithTask) => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksDeleteReminder?.(reminder.taskId, reminder.id);
      if (res?.ok) {
        if (Array.isArray(res.tasks)) setTasks(res.tasks);
        else if (res.task) updateTask(res.task);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openTaskFromReminder = useCallback((taskId: string) => {
    setExpandedTaskId(taskId);
    setFilter('pending');
  }, []);

  useEffect(() => {
    if (defaultSubTab === 'reminders' && !loading && allReminders.length > 0) {
      onSubTabChange?.('todo');
      const t = window.setTimeout(() => {
        remindersSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => window.clearTimeout(t);
    }
  }, [defaultSubTab, loading, allReminders.length, onSubTabChange]);

  const showRemindersInList = filter === 'pending' && allReminders.length > 0;
  const showEmptyTasksState = !loading && filteredTasks.length === 0 && !showRemindersInList;

  if (loading && compact) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        compact ? 'flex flex-col h-full min-h-0 p-3' : 'pb-16 max-w-6xl mx-auto w-full'
      )}
    >
      <div className={clsx(compact ? 'shrink-0 space-y-3 mb-3' : 'space-y-6 mb-6')}>
        <div className={clsx('flex', compact ? 'justify-end' : 'justify-center')}>
          <div
            className={clsx(
              'inline-flex items-center p-1 shadow-sm',
              compact
                ? 'gap-1 bg-theme-card/50 rounded-xl border border-theme/10'
                : 'rounded-full border border-[color:var(--dashboard-panel-border)] bg-[color:var(--dashboard-hover)]'
            )}
          >
            {(['pending', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'font-semibold transition-all capitalize',
                  compact
                    ? 'px-2.5 py-1 rounded-lg text-[10px] font-bold'
                    : 'px-5 py-2 text-[13px] rounded-full min-w-[70px]',
                  filter === f
                    ? compact
                      ? 'bg-theme-card shadow-sm text-theme-fg'
                      : 'bg-[color:var(--dashboard-panel-solid)] text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg'
                )}
              >
                {f}
                {f === 'pending' && filteredTasks.length > 0 && (
                  <span
                    className={clsx(
                      'ml-1.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-bold',
                      filter === f ? 'bg-primary/10 text-primary' : 'bg-theme-hover text-theme-muted'
                    )}
                  >
                    {filteredTasks.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {compact ? (
            <div className={clsx(
              "relative transition-all duration-300 ease-in-out group",
              isAdding ? "ring-2 ring-primary/20 rounded-xl" : ""
            )}>
              <div className={clsx(
                "flex items-center gap-3 bg-theme-card border border-theme/10 rounded-xl shadow-sm transition-all",
                compact ? "px-3 py-2" : "px-4 py-3",
                isAdding ? "shadow-lg border-primary/20" : "hover:border-theme/20"
              )}>
                <div className={clsx(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0",
                  isAdding ? "border-primary text-primary" : "border-theme-muted/30 text-transparent"
                )}>
                  <Plus className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  placeholder="Add a task..."
                  className={clsx(
                    "flex-1 bg-transparent border-none outline-none text-theme-fg placeholder:text-theme-muted/60",
                    compact ? "text-[12px]" : "text-sm"
                  )}
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  onFocus={() => setIsAdding(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTask();
                    if (e.key === 'Escape') setIsAdding(false);
                  }}
                />
                {isAdding && (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-200">
                    <input
                      type="date"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                      className="bg-theme-hover border border-theme/10 rounded-lg text-[10px] text-theme-muted px-2 py-1 outline-none focus:ring-1 focus:ring-primary/20"
                    />
                    <TaskPriorityPicker
                      variant="compact"
                      value={newTask.priority}
                      onChange={(priority) => setNewTask({ ...newTask, priority })}
                    />
                    <button 
                      onClick={handleAddTask}
                      disabled={!newTask.title.trim()}
                      className="p-1.5 bg-primary text-primary-fg rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex justify-center w-full">
              <div className="w-full max-w-[480px] flex flex-col rounded-[22px] bg-[color:var(--dashboard-panel-solid)] px-5 pt-4 pb-3.5 min-h-[100px] shadow-sm">
                <input
                  type="text"
                  placeholder="Add Task"
                  className="w-full min-w-0 bg-transparent border-none outline-none text-[15px] text-theme-fg placeholder:text-theme-muted/60"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTask();
                  }}
                />
                <div className="mt-auto flex items-center justify-end gap-2 pt-3">
                  <TaskPriorityPicker
                    variant="dashboard"
                    value={newTask.priority}
                    onChange={(priority) => setNewTask({ ...newTask, priority })}
                  />
                  <label
                    className={clsx(
                      "relative h-8 w-8 rounded-[11px] bg-[color:var(--dashboard-hover)] flex items-center justify-center cursor-pointer transition-colors",
                      newTask.dueDate ? "text-primary" : "text-theme-fg"
                    )}
                    title={newTask.dueDate ? `Due ${newTask.dueDate}` : 'Set due date'}
                  >
                    <CalendarPlus className="w-4 h-4" strokeWidth={1.5} />
                    <input
                      type="date"
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                  <button
                    onClick={handleAddTask}
                    disabled={!newTask.title.trim()}
                    className="h-8 w-8 shrink-0 rounded-[11px] bg-primary text-primary-fg flex items-center justify-center hover:opacity-90 disabled:opacity-50 transition-all"
                    title="Add task"
                  >
                    <CheckCircle2 className="w-[18px] h-[18px]" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          )}
      </div>

      <div
        className={clsx(
          compact
            ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-4 space-y-1.5 -mx-2 px-2'
            : 'space-y-3'
        )}
      >
            {showRemindersInList && (
              <UpcomingRemindersSection
                reminders={allReminders}
                compact={compact}
                sectionRef={remindersSectionRef}
                editingId={editingGlobalReminderId}
                editDate={editGlobalReminderDate}
                editTime={editGlobalReminderTime}
                editMessage={editGlobalReminderMessage}
                onEditDate={setEditGlobalReminderDate}
                onEditTime={setEditGlobalReminderTime}
                onEditMessage={setEditGlobalReminderMessage}
                onStartEdit={startEditingReminder}
                onCancelEdit={() => setEditingGlobalReminderId(null)}
                onSaveEdit={saveEditingReminder}
                onDelete={deleteReminder}
                onOpenTask={openTaskFromReminder}
              />
            )}

            {loading && !compact ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-[64px] rounded-[18px] bg-transparent border border-[color:var(--dashboard-panel-border)] animate-pulse"
                />
              ))
            ) : showEmptyTasksState ? (
              <div
                className={clsx(
                  'flex flex-col items-center justify-center text-center',
                  compact ? 'h-48' : 'h-[360px]'
                )}
              >
                {!compact && filter === 'pending' ? (
                  <>
                    <p className="text-theme-fg font-semibold text-[24px]">You have no Tasks</p>
                    <p className="text-[15px] text-theme-muted mt-2 max-w-[520px]">
                      Start chatting with Stuard to get help with your tasks, coding, and questions.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 bg-theme-muted/5 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-7 h-7 text-theme-muted/30" />
                    </div>
                    <p className="text-theme-fg font-semibold text-sm">All caught up</p>
                    <p className="text-[11px] text-theme-muted mt-1 max-w-[200px]">
                      {filter === 'pending'
                        ? 'No pending tasks. Add a reminder on any task when you expand it.'
                        : 'No completed tasks yet.'}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                {showRemindersInList && filteredTasks.length > 0 && (
                  <div
                    className={clsx(
                      'flex items-center gap-2',
                      compact ? 'px-0.5 pt-1' : 'px-1 pt-2'
                    )}
                  >
                    <ListChecks className="w-3.5 h-3.5 text-theme-muted" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">
                      Tasks
                    </span>
                  </div>
                )}
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    compact={compact}
                    expanded={expandedTaskId === task.id}
                    onToggleExpand={() =>
                      setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                    }
                    onToggle={() => handleToggleTask(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                    onUpdateTask={handleUpdateTask}
                    onUpdate={updateTask}
                    onRefreshTasks={() => loadTasks()}
                  />
                ))}
              </>
            )}
      </div>
    </div>
  );
};

interface TaskCardProps {
  task: UnifiedTask;
  compact?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onUpdateTask: (taskId: string, updates: Partial<UnifiedTask>) => Promise<boolean>;
  onUpdate: (task: UnifiedTask) => void;
  onRefreshTasks: () => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task, compact, expanded, onToggleExpand, onToggle, onDelete, onUpdateTask, onUpdate, onRefreshTasks
}) => {
  const isCompleted = task.status === 'completed';
  const priority = normalizePriority(task.priority);
  const priorityCfg = PRIORITY_CONFIG[priority];
  const subtodosTotal = task.subTodos?.length || 0;
  const subtodosCompleted = task.subTodos?.filter(s => s.completed).length || 0;
  const remindersCount = task.agentAssignments?.filter(a => a.status === 'pending').length || 0;

  // Subtodos state
  const [newSubtodo, setNewSubtodo] = useState('');
  // Reminder state
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [reminderMessage, setReminderMessage] = useState('');
  const [cloudNotify, setCloudNotify] = useState(false);
  // Inline edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [editingSubtodoId, setEditingSubtodoId] = useState<string | null>(null);
  const [editSubtodoValue, setEditSubtodoValue] = useState('');
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [editReminderDate, setEditReminderDate] = useState('');
  const [editReminderTime, setEditReminderTime] = useState('');
  const [editReminderMessage, setEditReminderMessage] = useState('');

  const handleAddSubtodo = async () => {
    if (!newSubtodo.trim()) return;
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksAddSubtodo?.(task.id, { content: newSubtodo });
      if (res?.ok) {
        onUpdate(res.task);
        setNewSubtodo('');
      }
    } catch (e) { console.error(e); }
  };

  const handleEditTask = () => {
    setEditTitleValue(task.title || '');
    setEditingTitle(true);
  };

  const handleSaveTitle = async () => {
    const nextTitle = editTitleValue.trim();
    if (nextTitle && nextTitle !== task.title) {
      await onUpdateTask(task.id, { title: nextTitle });
    }
    setEditingTitle(false);
  };

  const handleEditSubtodo = (sub: { id: string; content: string }) => {
    setEditingSubtodoId(sub.id);
    setEditSubtodoValue(sub.content);
  };

  const handleSaveSubtodo = async (subId: string) => {
    const nextContent = editSubtodoValue.trim();
    if (nextContent) {
      try {
        const res = await (window as any).desktopAPI?.unifiedTasksUpdateSubtodo?.(task.id, subId, { content: nextContent });
        if (res?.ok && res.task) onUpdate(res.task);
      } catch (e) {
        console.error(e);
      }
    }
    setEditingSubtodoId(null);
  };

  const handleEditReminder = (reminder: AgentAssignment) => {
    const dt = reminder.scheduledAt ? String(reminder.scheduledAt).slice(0, 16) : '';
    setEditReminderDate(dt.slice(0, 10));
    setEditReminderTime(dt.slice(11, 16) || '09:00');
    setEditReminderMessage(reminder.message || `Reminder: ${task.title}`);
    setEditingReminderId(reminder.id);
  };

  const handleSaveReminder = async (reminderId: string) => {
    if (!editReminderDate) return;
    const scheduledAt = `${editReminderDate}T${editReminderTime}:00`;
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksUpdateReminder?.(task.id, reminderId, {
        scheduledAt,
        message: editReminderMessage,
      });
      if (res?.ok) onRefreshTasks();
    } catch (e) {
      console.error(e);
    }
    setEditingReminderId(null);
  };

  const handleAddReminder = async () => {
    if (!reminderDate) return;
    try {
      const scheduledAt = `${reminderDate}T${reminderTime}:00`;
      const message = reminderMessage || `Reminder: ${task.title}`;
      const res = await (window as any).desktopAPI?.unifiedTasksAddReminder?.(task.id, {
        type: 'reminder',
        scheduledAt,
        message,
      });
      if (res?.ok) {
        // Sync to cloud SMS if enabled
        if (cloudNotify) {
          syncReminderToCloudSMS({ message, scheduledAt, deliveryMethod: 'sms' });
        }
        onRefreshTasks();
        setShowAddReminder(false);
        setReminderDate('');
        setReminderTime('09:00');
        setReminderMessage('');
        setCloudNotify(false);
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className={clsx(
      "group relative transition-all duration-200",
      expanded 
        ? "bg-transparent border border-[color:var(--dashboard-panel-border)] shadow-lg rounded-xl z-10 my-1" 
        : "hover:bg-[color:var(--dashboard-hover)] border border-transparent rounded-xl hover:border-[color:var(--dashboard-panel-border)]"
    )}>
      {/* Main Row */}
      <div className={clsx("flex items-start gap-3", compact ? "p-2.5" : "p-3")}>
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={clsx(
            "mt-0.5 w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all flex-shrink-0",
            isCompleted
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "border-theme-muted/40 hover:border-primary text-transparent hover:bg-primary/5"
          )}
        >
          <Check className="w-3 h-3" />
        </button>

        {/* Content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={editingTitle ? undefined : onToggleExpand}
        >
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {editingTitle ? (
              <input
                autoFocus
                type="text"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.stopPropagation(); handleSaveTitle(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setEditingTitle(false); }
                }}
                onBlur={handleSaveTitle}
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  "flex-1 bg-theme-hover border border-primary/30 rounded-lg px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary/30 font-semibold text-theme-fg",
                  compact ? "text-[12px]" : "text-[13px]"
                )}
              />
            ) : (
              <>
                <span className={clsx(
                  "font-semibold transition-colors",
                  compact ? "text-[12px]" : "text-[13px]",
                  isCompleted ? "text-theme-muted line-through decoration-theme-muted/50" : "text-theme-fg"
                )}>
                  {task.title}
                </span>
                {priority !== 'normal' && priority !== 'low' && !isCompleted && (
                  <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase", priorityCfg.bg, priorityCfg.color)}>
                    {priorityCfg.label}
                  </span>
                )}
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2.5 text-[10px] text-theme-muted">
            {task.dueDate && (
              <span className={clsx(
                "flex items-center gap-1 font-medium",
                new Date(task.dueDate) < new Date() && !isCompleted ? "text-red-500" : ""
              )}>
                <Calendar className="w-3 h-3" />
                {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
            {subtodosTotal > 0 && (
              <span className="flex items-center gap-1 font-medium">
                <ListChecks className="w-3 h-3" />
                {subtodosCompleted}/{subtodosTotal}
              </span>
            )}
            {remindersCount > 0 && (
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <Bell className="w-3 h-3" />
                {remindersCount}
              </span>
            )}
          </div>
        </div>
        
        {/* Quick Actions (Hover) */}
        <div className={clsx(
          "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
          expanded && "opacity-100"
        )}>
          <button
            onClick={(e) => { e.stopPropagation(); handleEditTask(); }}
            className="p-1.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 text-theme-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            className="p-1.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="pl-8 space-y-3">
            
            {/* Description */}
            {task.description && (
              <p className="text-[11px] text-theme-muted leading-relaxed bg-theme-hover/30 p-2 rounded-lg">
                {task.description}
              </p>
            )}

            {/* Reminders Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1">
                  <Bell className="w-3 h-3" /> Reminders
                </span>
                <button
                  onClick={() => setShowAddReminder(!showAddReminder)}
                  className="text-[10px] font-bold text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              
              {showAddReminder && (
                <div className="space-y-2 p-2 bg-theme-hover/50 rounded-lg animate-in fade-in duration-200">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={reminderDate}
                      onChange={(e) => setReminderDate(e.target.value)}
                      className="bg-theme-card border border-theme/10 rounded-lg text-[10px] px-2 py-1 outline-none"
                    />
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                      className="bg-theme-card border border-theme/10 rounded-lg text-[10px] px-2 py-1 outline-none"
                    />
                    <button
                      onClick={handleAddReminder}
                      disabled={!reminderDate}
                      className="p-1 bg-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setShowAddReminder(false)}
                      className="p-1 text-theme-muted hover:text-theme-fg"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() => setCloudNotify(!cloudNotify)}
                    className={clsx(
                      "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all border",
                      cloudNotify
                        ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                        : "bg-theme-card text-theme-muted border-theme/10 hover:border-theme/20"
                    )}
                  >
                    <MessageSquare className="w-3 h-3" />
                    Notify via SMS
                    {cloudNotify && <Check className="w-2.5 h-2.5" />}
                  </button>
                </div>
              )}

              {task.agentAssignments?.filter(a => a.status === 'pending').map(reminder => (
                <div key={reminder.id} className="flex flex-col gap-1.5 text-[10px] text-theme-muted bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                  {editingReminderId === reminder.id ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          type="date"
                          value={editReminderDate}
                          onChange={(e) => setEditReminderDate(e.target.value)}
                          className="bg-theme-card border border-theme/10 rounded px-2 py-1 text-[10px] outline-none"
                        />
                        <input
                          type="time"
                          value={editReminderTime}
                          onChange={(e) => setEditReminderTime(e.target.value)}
                          className="bg-theme-card border border-theme/10 rounded px-2 py-1 text-[10px] outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={editReminderMessage}
                        onChange={(e) => setEditReminderMessage(e.target.value)}
                        placeholder="Reminder message..."
                        className="bg-theme-card border border-theme/10 rounded px-2 py-1 text-[10px] outline-none w-full"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSaveReminder(reminder.id)}
                          disabled={!editReminderDate}
                          className="p-1 bg-amber-500 text-white rounded hover:opacity-90 disabled:opacity-50"
                        >
                          <Check className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={() => setEditingReminderId(null)}
                          className="p-1 text-theme-muted hover:text-theme-fg"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Bell className="w-3 h-3 text-amber-500" />
                      <span className="flex-1">
                        {new Date(reminder.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' at '}
                        {new Date(reminder.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={async () => {
                          await syncReminderToCloudSMS({
                            message: reminder.message || `Reminder: ${task.title}`,
                            scheduledAt: reminder.scheduledAt,
                          });
                          try { (window as any).desktopAPI?.notify?.('Synced', 'Reminder synced to cloud SMS.'); } catch { }
                        }}
                        className="p-0.5 text-theme-muted hover:text-sky-400"
                        title="Sync to cloud SMS"
                      >
                        <Cloud className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleEditReminder(reminder)}
                        className="p-0.5 text-theme-muted hover:text-theme-fg"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const res = await (window as any).desktopAPI?.unifiedTasksDeleteReminder?.(task.id, reminder.id);
                            if (res?.ok) onRefreshTasks();
                          } catch (e) { console.error(e); }
                        }}
                        className="p-0.5 text-theme-muted hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Sub-todos */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1">
                <ListChecks className="w-3 h-3" /> Sub-tasks
              </span>
              {task.subTodos?.map(sub => (
                <div key={sub.id} className="flex items-center gap-2 group/sub">
                  <button
                    onClick={() => {
                      (window as any).desktopAPI?.unifiedTasksToggleSubtodo?.(task.id, sub.id)
                         .then((r: any) => r?.ok && onUpdate(r.task));
                    }}
                    className={clsx(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center transition-all",
                      sub.completed ? "bg-primary border-primary text-primary-fg" : "border-theme-muted/30 hover:border-primary"
                    )}
                  >
                    {sub.completed && <Check className="w-2.5 h-2.5" />}
                  </button>
                  {editingSubtodoId === sub.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editSubtodoValue}
                      onChange={(e) => setEditSubtodoValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveSubtodo(sub.id);
                        if (e.key === 'Escape') setEditingSubtodoId(null);
                      }}
                      onBlur={() => handleSaveSubtodo(sub.id)}
                      className="flex-1 bg-theme-hover border border-primary/30 rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                    />
                  ) : (
                    <span className={clsx("text-xs flex-1", sub.completed ? "text-theme-muted line-through" : "text-theme-fg")}>
                      {sub.content}
                    </span>
                  )}
                  <button
                    onClick={() => handleEditSubtodo(sub)}
                    className="opacity-0 group-hover/sub:opacity-100 p-0.5 text-theme-muted hover:text-theme-fg"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      (window as any).desktopAPI?.unifiedTasksDeleteSubtodo?.(task.id, sub.id)
                        .then((r: any) => r?.ok && onUpdate(r.task));
                    }}
                    className="opacity-0 group-hover/sub:opacity-100 p-0.5 text-theme-muted hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Plus className="w-3.5 h-3.5 text-theme-muted" />
                <input
                  type="text"
                  value={newSubtodo}
                  onChange={(e) => setNewSubtodo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSubtodo()}
                  placeholder="Add sub-task..."
                  className="flex-1 bg-transparent border-none text-xs outline-none placeholder:text-theme-muted/50"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedTasksView;
