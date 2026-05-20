/**
 * Unified Task System Types
 * Central task model with sub-todos, agent assignments, and calendar integration
 */

export interface SubTodoItem {
  id: string;
  content: string;
  completed: boolean;
  completedAt?: string | null;
  createdAt: string;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  days?: number[]; // 0=Mon..6=Sun
  until?: string; // ISO datetime
  count?: number;
}

export interface AgentAssignment {
  id: string;
  type: 'reminder' | 'action' | 'check-in';
  scheduledAt: string; // ISO datetime when agent should act
  message?: string; // What to remind/do
  // Legacy string format ('daily'|'weekly'|'monthly') still supported for backward compat.
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly' | RecurrenceRule | null;
  status: 'pending' | 'triggered' | 'completed' | 'cancelled';
  triggeredAt?: string | null;
  completedAt?: string | null;
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface UnifiedTask {
  id: string;
  title: string;
  description?: string;
  
  // Timing
  startDate?: string | null; // ISO date or datetime
  dueDate?: string | null; // ISO date or datetime (deadline)
  allDay?: boolean; // If true, dates are date-only (no time)
  
  // Status & Priority
  status: TaskStatus;
  priority: TaskPriority;
  completedAt?: string | null;
  
  // Sub-items
  subTodos: SubTodoItem[];
  
  // Agent Assignments
  agentAssignments: AgentAssignment[];
  
  // Categorization
  tags?: string[];
  color?: string;
  projectId?: string | null; // Project Mode: null/undefined = unscoped, otherwise FK to projects.id
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  
  // Calendar visibility
  showInCalendar: boolean;
}

// Helper to create new task
export function createTask(partial: Partial<UnifiedTask>): UnifiedTask {
  const now = new Date().toISOString();
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    status: 'pending',
    priority: 'normal',
    subTodos: [],
    agentAssignments: [],
    showInCalendar: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// Helper to create sub-todo
export function createSubTodo(content: string): SubTodoItem {
  return {
    id: `subtodo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

// Helper to create agent assignment
export function createAgentAssignment(partial: Partial<AgentAssignment>): AgentAssignment {
  return {
    id: `assign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'reminder',
    scheduledAt: new Date().toISOString(),
    recurring: 'none',
    status: 'pending',
    ...partial,
  };
}

// Convert unified task to calendar block format (for planner integration)
export function taskToCalendarBlock(task: UnifiedTask): any | null {
  if (!task.showInCalendar) return null;
  if (!task.dueDate && !task.startDate) return null;
  if (task.status === 'completed' || task.status === 'cancelled') return null;
  
  const start = task.startDate || task.dueDate;
  const end = task.dueDate || task.startDate;
  
  return {
    id: task.id,
    title: task.title,
    start,
    end,
    allDay: task.allDay ?? true,
    source: 'tasks',
    type: 'task',
    priority: task.priority,
    status: task.status,
    subTodosTotal: task.subTodos.length,
    subTodosCompleted: task.subTodos.filter(s => s.completed).length,
  };
}
