import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Calendar,
  Flag,
  ChevronDown,
  ChevronRight,
  Pencil,
  X,
  Check,
  ListTodo,
  Clock,
  Sparkles
} from 'lucide-react';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string | null;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
}

interface TodoListViewProps {
  compact?: boolean;
}

type FilterType = 'all' | 'active' | 'completed';
type SortType = 'newest' | 'oldest' | 'priority' | 'dueDate';

const PRIORITY_CONFIG = {
  high: { color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'High' },
  medium: { color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Medium' },
  low: { color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Low' },
};

export const TodoListView: React.FC<TodoListViewProps> = ({ compact }) => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [newTodoText, setNewTodoText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [newTodoPriority, setNewTodoPriority] = useState<'low' | 'medium' | 'high'>('medium');

  const loadTodos = useCallback(async () => {
    try {
      const result = await (window as any).desktopAPI?.todosList?.();
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      }
    } catch (e) {
      console.error('Failed to load todos:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const saveTodos = useCallback(async (newTodos: Todo[]) => {
    try {
      await (window as any).desktopAPI?.todosSave?.(newTodos);
      setTodos(newTodos);
    } catch (e) {
      console.error('Failed to save todos:', e);
    }
  }, []);

  const addTodo = useCallback(async () => {
    const text = newTodoText.trim();
    if (!text) return;

    const todo: Todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      completed: false,
      createdAt: new Date().toISOString(),
      priority: newTodoPriority,
    };

    try {
      const result = await (window as any).desktopAPI?.todosAdd?.(todo);
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      } else {
        setTodos(prev => [todo, ...prev]);
      }
      setNewTodoText('');
    } catch (e) {
      console.error('Failed to add todo:', e);
    }
  }, [newTodoText, newTodoPriority]);

  const toggleTodo = useCallback(async (id: string) => {
    try {
      const result = await (window as any).desktopAPI?.todosToggle?.(id);
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      } else {
        setTodos(prev => prev.map(t =>
          t.id === id
            ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : null }
            : t
        ));
      }
    } catch (e) {
      console.error('Failed to toggle todo:', e);
    }
  }, []);

  const deleteTodo = useCallback(async (id: string) => {
    try {
      const result = await (window as any).desktopAPI?.todosDelete?.(id);
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      } else {
        setTodos(prev => prev.filter(t => t.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete todo:', e);
    }
  }, []);

  const updateTodo = useCallback(async (id: string, updates: Partial<Todo>) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    const updated = { ...todo, ...updates };
    try {
      const result = await (window as any).desktopAPI?.todosUpdate?.(updated);
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      } else {
        setTodos(prev => prev.map(t => t.id === id ? updated : t));
      }
    } catch (e) {
      console.error('Failed to update todo:', e);
    }
    setEditingId(null);
  }, [todos]);

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = () => {
    if (editingId && editText.trim()) {
      updateTodo(editingId, { text: editText.trim() });
    }
    setEditingId(null);
  };

  const filteredTodos = useMemo(() => {
    let filtered = [...todos];

    if (filter === 'active') {
      filtered = filtered.filter(t => !t.completed);
    } else if (filter === 'completed') {
      filtered = filtered.filter(t => t.completed);
    }

    // Sort: uncompleted first, then by creation date (newest first)
    filtered.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // Priority sort for uncompleted
      if (!a.completed && !b.completed) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aPriority = priorityOrder[a.priority || 'medium'];
        const bPriority = priorityOrder[b.priority || 'medium'];
        if (aPriority !== bPriority) return aPriority - bPriority;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return filtered;
  }, [todos, filter]);

  const activeTodos = filteredTodos.filter(t => !t.completed);
  const completedTodos = filteredTodos.filter(t => t.completed);

  const stats = useMemo(() => ({
    total: todos.length,
    active: todos.filter(t => !t.completed).length,
    completed: todos.filter(t => t.completed).length,
  }), [todos]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-theme-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col h-full", compact ? "px-2 pt-2" : "pb-12 mx-auto max-w-2xl w-full px-4")}>
      {/* Header */}
      <div className={clsx("flex-none", compact ? "mb-3" : "mb-6")}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className={clsx("font-stuard text-theme-fg tracking-tight flex items-center gap-2", compact ? "text-lg" : "text-2xl")}>
              <ListTodo className={clsx(compact ? "w-5 h-5" : "w-6 h-6", "text-emerald-500")} />
              To-Do List
            </h2>
            {!compact && (
              <p className="text-theme-muted text-sm font-medium mt-1">
                {stats.active} active • {stats.completed} completed
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Add New Todo */}
      <div className={clsx("flex-none mb-4", compact ? "space-y-2" : "space-y-3")}>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTodo()}
              placeholder="Add a new task..."
              className={clsx(
                "w-full px-4 py-2.5 rounded-xl bg-theme-card border border-theme/20 text-theme-fg placeholder:text-theme-muted/60",
                "focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50",
                "transition-all text-[13px]"
              )}
            />
          </div>
          <select
            value={newTodoPriority}
            onChange={(e) => setNewTodoPriority(e.target.value as any)}
            className={clsx(
              "px-3 py-2 rounded-xl bg-theme-card border border-theme/20 text-theme-fg text-[12px] font-medium",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500/30",
              newTodoPriority === 'high' && "border-red-500/30 bg-red-500/5",
              newTodoPriority === 'medium' && "border-amber-500/30 bg-amber-500/5",
              newTodoPriority === 'low' && "border-blue-500/30 bg-blue-500/5"
            )}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            onClick={addTodo}
            disabled={!newTodoText.trim()}
            className={clsx(
              "px-4 py-2 rounded-xl bg-emerald-500 text-white font-semibold text-[13px]",
              "hover:bg-emerald-600 active:scale-95 transition-all",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
              "flex items-center gap-1.5"
            )}
          >
            <Plus className="w-4 h-4" />
            {!compact && "Add"}
          </button>
        </div>
      </div>

      {/* Filters */}
      {!compact && (
        <div className="flex items-center gap-1 mb-4 pb-3 border-b border-theme/10">
          {(['all', 'active', 'completed'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize",
                filter === f
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Todo List */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {filteredTodos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-base font-semibold text-theme-fg mb-2">
              {filter === 'all' ? "No tasks yet" : `No ${filter} tasks`}
            </h3>
            <p className="text-sm text-theme-muted max-w-xs font-medium leading-relaxed">
              {filter === 'all'
                ? "Add your first task above to get started!"
                : `You don't have any ${filter} tasks.`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Todos */}
            {activeTodos.length > 0 && (
              <div className="space-y-1.5">
                {activeTodos.map(todo => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    compact={compact}
                    isEditing={editingId === todo.id}
                    editText={editText}
                    onEditTextChange={setEditText}
                    onToggle={() => toggleTodo(todo.id)}
                    onDelete={() => deleteTodo(todo.id)}
                    onStartEdit={() => startEdit(todo)}
                    onSaveEdit={saveEdit}
                    onCancelEdit={() => setEditingId(null)}
                    onUpdatePriority={(priority) => updateTodo(todo.id, { priority })}
                  />
                ))}
              </div>
            )}

            {/* Completed Section */}
            {completedTodos.length > 0 && filter !== 'active' && (
              <div className="pt-2">
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-muted hover:text-theme-fg transition-colors"
                >
                  {showCompleted ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Completed ({completedTodos.length})
                </button>
                {showCompleted && (
                  <div className="space-y-1.5 mt-2">
                    {completedTodos.map(todo => (
                      <TodoItem
                        key={todo.id}
                        todo={todo}
                        compact={compact}
                        isEditing={editingId === todo.id}
                        editText={editText}
                        onEditTextChange={setEditText}
                        onToggle={() => toggleTodo(todo.id)}
                        onDelete={() => deleteTodo(todo.id)}
                        onStartEdit={() => startEdit(todo)}
                        onSaveEdit={saveEdit}
                        onCancelEdit={() => setEditingId(null)}
                        onUpdatePriority={(priority) => updateTodo(todo.id, { priority })}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface TodoItemProps {
  todo: Todo;
  compact?: boolean;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onToggle: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onUpdatePriority: (priority: 'low' | 'medium' | 'high') => void;
}

const TodoItem: React.FC<TodoItemProps> = ({
  todo,
  compact,
  isEditing,
  editText,
  onEditTextChange,
  onToggle,
  onDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onUpdatePriority,
}) => {
  const priorityConfig = PRIORITY_CONFIG[todo.priority || 'medium'];

  return (
    <div
      className={clsx(
        "group relative flex items-start gap-3 p-3 rounded-xl transition-all",
        "bg-theme-card border hover:shadow-sm",
        todo.completed
          ? "border-theme/10 opacity-60"
          : `border-theme/20 hover:border-theme/30`,
        compact && "p-2.5"
      )}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={clsx(
          "flex-shrink-0 mt-0.5 transition-all",
          todo.completed ? "text-emerald-500" : "text-theme-muted hover:text-emerald-500"
        )}
      >
        {todo.completed ? (
          <CheckCircle2 className={clsx(compact ? "w-4.5 h-4.5" : "w-5 h-5")} />
        ) : (
          <Circle className={clsx(compact ? "w-4.5 h-4.5" : "w-5 h-5")} />
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              className="flex-1 px-2 py-1 text-[13px] bg-theme-bg border border-theme/30 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
            <button
              onClick={onSaveEdit}
              className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCancelEdit}
              className="p-1.5 rounded-lg bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <p className={clsx(
              "text-[13px] font-medium leading-snug break-words",
              todo.completed ? "line-through text-theme-muted" : "text-theme-fg"
            )}>
              {todo.text}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              {/* Priority Badge */}
              {!todo.completed && (
                <span className={clsx(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
                  priorityConfig.color, priorityConfig.bg, priorityConfig.border
                )}>
                  <Flag className="w-2.5 h-2.5" />
                  {priorityConfig.label}
                </span>
              )}
              {/* Timestamp */}
              <span className="text-[10px] text-theme-muted/70 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {todo.completed && todo.completedAt
                  ? `Done ${new Date(todo.completedAt).toLocaleDateString()}`
                  : new Date(todo.createdAt).toLocaleDateString()}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className={clsx(
          "flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
          compact && "gap-0"
        )}>
          {!todo.completed && (
            <button
              onClick={onStartEdit}
              className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-all"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTodos = useCallback(async () => {
    try {
      const result = await (window as any).desktopAPI?.todosList?.();
      if (result?.ok && Array.isArray(result.todos)) {
        setTodos(result.todos);
      }
    } catch (e) {
      console.error('Failed to load todos:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const addTodo = useCallback(async (text: string, priority: 'low' | 'medium' | 'high' = 'medium') => {
    const todo: Todo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      completed: false,
      createdAt: new Date().toISOString(),
      priority,
    };
    try {
      const result = await (window as any).desktopAPI?.todosAdd?.(todo);
      if (result?.ok) {
        setTodos(result.todos);
      }
    } catch (e) {
      console.error('Failed to add todo:', e);
    }
  }, []);

  const toggleTodo = useCallback(async (id: string) => {
    try {
      const result = await (window as any).desktopAPI?.todosToggle?.(id);
      if (result?.ok) {
        setTodos(result.todos);
      }
    } catch (e) {
      console.error('Failed to toggle todo:', e);
    }
  }, []);

  return { todos, loading, addTodo, toggleTodo, reload: loadTodos };
}
