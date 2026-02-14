import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Plus,
  Check,
  Calendar,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  ArrowRight,
  X,
  Bell,
  Clock,
  ListChecks,
  Pencil
} from 'lucide-react';
import type { UnifiedTask, TaskPriority, AgentAssignment } from '../types/tasks';

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

export const UnifiedTasksView: React.FC<UnifiedTasksViewProps> = ({ compact, defaultSubTab = 'todo', onSubTabChange }) => {
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [subTab, setSubTab] = useState<TaskSubTab>(defaultSubTab);

  // Sync subTab with defaultSubTab prop
  useEffect(() => {
    setSubTab(defaultSubTab);
  }, [defaultSubTab]);

  const handleSubTabChange = (tab: TaskSubTab) => {
    setSubTab(tab);
    onSubTabChange?.(tab);
  };

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
       if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col h-full bg-theme-bg", compact ? "p-3" : "p-6")}>
      {/* Header with Sub-tabs */}
      <div className={clsx("flex items-center justify-between shrink-0", compact ? "mb-3" : "mb-6")}>
        {!compact && <h1 className="text-xl font-black text-theme-fg tracking-tight font-stuard">Tasks</h1>}
        
        {/* Sub-tabs: Todo / Reminders */}
        <div className="flex items-center gap-1 bg-theme-card/50 p-1 rounded-xl border border-theme/10">
          <button
            onClick={() => handleSubTabChange('todo')}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
              subTab === 'todo' ? "bg-primary text-primary-fg shadow-sm" : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
            )}
          >
            <ListChecks className="w-3.5 h-3.5" />
            To-do
            {filteredTasks.length > 0 && (
              <span className={clsx(
                "min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold",
                subTab === 'todo' ? "bg-white/20" : "bg-primary/10 text-primary"
              )}>
                {filteredTasks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => handleSubTabChange('reminders')}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
              subTab === 'reminders' ? "bg-amber-500 text-white shadow-sm" : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
            )}
          >
            <Bell className="w-3.5 h-3.5" />
            Reminders
            {allReminders.length > 0 && (
              <span className={clsx(
                "min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold",
                subTab === 'reminders' ? "bg-white/20" : "bg-amber-500/10 text-amber-500"
              )}>
                {allReminders.length}
              </span>
            )}
          </button>
        </div>

        {/* Filter (only for todo tab) */}
        {subTab === 'todo' && !compact && (
          <div className="flex items-center gap-1 bg-theme-card/50 p-1 rounded-xl border border-theme/10">
            {(['pending', 'completed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all capitalize",
                  filter === f ? "bg-theme-card shadow-sm text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reminders Tab Content */}
      {subTab === 'reminders' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 pb-4">
          {allReminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mb-4">
                <Bell className="w-7 h-7 text-amber-500/40" />
              </div>
              <p className="text-theme-fg font-semibold text-sm">No reminders set</p>
              <p className="text-[11px] text-theme-muted mt-1 max-w-[200px]">
                Add reminders to tasks to get notified at specific times.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allReminders.map(reminder => {
                const reminderDate = new Date(reminder.scheduledAt);
                const isOverdue = reminderDate < new Date();
                const isSoon = !isOverdue && reminderDate.getTime() - Date.now() < 3600000;
                return (
                  <div
                    key={reminder.id}
                    className={clsx(
                      "flex items-start gap-3 p-3 rounded-xl border transition-all",
                      isOverdue
                        ? "bg-red-500/5 border-red-500/20"
                        : isSoon
                          ? "bg-amber-500/5 border-amber-500/20"
                          : "bg-theme-card border-theme/10 hover:border-theme/20"
                    )}
                  >
                    <div className={clsx(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      isOverdue ? "bg-red-500/10" : isSoon ? "bg-amber-500/10" : "bg-theme-hover"
                    )}>
                      <Bell className={clsx(
                        "w-4 h-4",
                        isOverdue ? "text-red-500" : isSoon ? "text-amber-500" : "text-theme-muted"
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-theme-fg">
                        {reminder.message || reminder.taskTitle}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3 text-theme-muted" />
                        <span className={clsx(
                          "text-[10px] font-medium",
                          isOverdue ? "text-red-500" : isSoon ? "text-amber-600" : "text-theme-muted"
                        )}>
                          {isOverdue ? 'Overdue: ' : ''}
                          {reminderDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          {' at '}
                          {reminderDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                      {reminder.taskTitle && reminder.message && (
                        <div className="text-[10px] text-theme-muted mt-1 flex items-center gap-1">
                          <ListChecks className="w-3 h-3" />
                          {reminder.taskTitle}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        const defaultDateTime = reminder.scheduledAt ? String(reminder.scheduledAt).slice(0, 16) : '';
                        const dateTime = prompt('Edit reminder date/time (YYYY-MM-DDTHH:mm):', defaultDateTime);
                        if (dateTime === null) return;
                        const message = prompt('Edit reminder message:', reminder.message || reminder.taskTitle || 'Reminder');
                        if (message === null) return;
                        const dt = dateTime.trim();
                        const scheduledAt = dt ? (dt.length === 16 ? `${dt}:00` : dt) : reminder.scheduledAt;
                        try {
                          const res = await (window as any).desktopAPI?.unifiedTasksUpdateReminder?.(reminder.taskId, reminder.id, {
                            scheduledAt,
                            message,
                          });
                          if (res?.ok) {
                            if (Array.isArray(res.tasks)) setTasks(res.tasks);
                            else if (res.task) updateTask(res.task);
                          }
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      className="p-1.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const res = await (window as any).desktopAPI?.unifiedTasksDeleteReminder?.(reminder.taskId, reminder.id);
                          if (res?.ok) {
                            if (Array.isArray(res.tasks)) setTasks(res.tasks);
                            else if (res.task) updateTask(res.task);
                          }
                        } catch (e) { console.error(e); }
                      }}
                      className="p-1.5 text-theme-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Todo Tab Content */}
      {subTab === 'todo' && (
        <>
          {/* Quick Add Input */}
          <div className={clsx(
            "relative transition-all duration-300 ease-in-out shrink-0 group",
            compact ? "mb-3" : "mb-4",
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
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as TaskPriority })}
                    className="bg-theme-hover border border-theme/10 rounded-lg text-[10px] text-theme-muted px-2 py-1 outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
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

          {/* Task List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 -mx-2 px-2 pb-4">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <div className="w-14 h-14 bg-theme-muted/5 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-7 h-7 text-theme-muted/30" />
                </div>
                <p className="text-theme-fg font-semibold text-sm">All caught up</p>
                <p className="text-[11px] text-theme-muted mt-1 max-w-[200px]">
                  {filter === 'pending' ? "No pending tasks. Enjoy!" : "No completed tasks yet."}
                </p>
              </div>
            ) : (
              filteredTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  compact={compact}
                  expanded={expandedTaskId === task.id}
                  onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  onToggle={() => handleToggleTask(task.id)}
                  onDelete={() => handleDeleteTask(task.id)}
                  onUpdateTask={handleUpdateTask}
                  onUpdate={updateTask}
                  onRefreshTasks={() => loadTasks()}
                />
              ))
            )}
          </div>
        </>
      )}
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
  const priorityCfg = PRIORITY_CONFIG[task.priority];
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

  const handleEditTask = async () => {
    const title = prompt('Edit task title:', task.title || '');
    if (title === null) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    await onUpdateTask(task.id, { title: nextTitle });
  };

  const handleEditSubtodo = async (sub: { id: string; content: string }) => {
    const content = prompt('Edit sub-task:', sub.content || '');
    if (content === null) return;
    const nextContent = content.trim();
    if (!nextContent) return;
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksUpdateSubtodo?.(task.id, sub.id, { content: nextContent });
      if (res?.ok && res.task) onUpdate(res.task);
    } catch (e) {
      console.error(e);
    }
  };

  const handleEditReminder = async (reminder: AgentAssignment) => {
    const defaultDateTime = reminder.scheduledAt ? String(reminder.scheduledAt).slice(0, 16) : '';
    const dateTime = prompt('Edit reminder date/time (YYYY-MM-DDTHH:mm):', defaultDateTime);
    if (dateTime === null) return;
    const message = prompt('Edit reminder message:', reminder.message || `Reminder: ${task.title}`);
    if (message === null) return;

    const dt = dateTime.trim();
    const scheduledAt = dt ? (dt.length === 16 ? `${dt}:00` : dt) : reminder.scheduledAt;

    try {
      const res = await (window as any).desktopAPI?.unifiedTasksUpdateReminder?.(task.id, reminder.id, {
        scheduledAt,
        message,
      });
      if (res?.ok) onRefreshTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddReminder = async () => {
    if (!reminderDate) return;
    try {
      const scheduledAt = `${reminderDate}T${reminderTime}:00`;
      const res = await (window as any).desktopAPI?.unifiedTasksAddReminder?.(task.id, {
        type: 'reminder',
        scheduledAt,
        message: reminderMessage || `Reminder: ${task.title}`,
      });
      if (res?.ok) {
        onRefreshTasks();
        setShowAddReminder(false);
        setReminderDate('');
        setReminderTime('09:00');
        setReminderMessage('');
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className={clsx(
      "group relative transition-all duration-200",
      expanded 
        ? "bg-theme-card border border-theme/20 shadow-lg rounded-xl z-10 my-1" 
        : "hover:bg-theme-card/50 border border-transparent rounded-xl hover:border-theme/10"
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
          onClick={onToggleExpand}
        >
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={clsx(
              "font-semibold transition-colors",
              compact ? "text-[12px]" : "text-[13px]",
              isCompleted ? "text-theme-muted line-through decoration-theme-muted/50" : "text-theme-fg"
            )}>
              {task.title}
            </span>
            {task.priority !== 'normal' && task.priority !== 'low' && !isCompleted && (
              <span className={clsx("text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase", priorityCfg.bg, priorityCfg.color)}>
                {priorityCfg.label}
              </span>
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
                <div className="flex items-center gap-2 p-2 bg-theme-hover/50 rounded-lg animate-in fade-in duration-200">
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
              )}

              {task.agentAssignments?.filter(a => a.status === 'pending').map(reminder => (
                <div key={reminder.id} className="flex items-center gap-2 text-[10px] text-theme-muted bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                  <Bell className="w-3 h-3 text-amber-500" />
                  <span className="flex-1">
                    {new Date(reminder.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' at '}
                    {new Date(reminder.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
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
                  <span className={clsx("text-xs flex-1", sub.completed ? "text-theme-muted line-through" : "text-theme-fg")}>
                    {sub.content}
                  </span>
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
