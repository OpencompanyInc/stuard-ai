
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

const unifiedTasksPath = () => {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'unified-tasks.json');
};

const loadUnifiedTasks = (): any[] => {
    try {
        const p = unifiedTasksPath();
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch (e) {
        logger.warn('Failed to load unified tasks:', e);
    }
    return [];
};

const saveUnifiedTasks = (tasks: any[]) => {
    try {
        fs.writeFileSync(unifiedTasksPath(), JSON.stringify(tasks, null, 2), 'utf-8');
    } catch (e) {
        logger.warn('Failed to save unified tasks:', e);
    }
    return { ok: true };
};

export const unifiedTasksService = {
    list: () => {
        return { ok: true, tasks: loadUnifiedTasks() };
    },

    get: (taskId: string) => {
        const tasks = loadUnifiedTasks();
        const task = tasks.find((t: any) => t.id === taskId);
        return task ? { ok: true, task } : { ok: false, error: 'Task not found' };
    },

    add: (task: any) => {
        const tasks = loadUnifiedTasks();
        const now = new Date().toISOString();
        const newTask = {
            ...task,
            id: task.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: now,
            updatedAt: now,
            status: task.status || 'pending',
            priority: task.priority || 'normal',
            subTodos: task.subTodos || [],
            agentAssignments: task.agentAssignments || [],
            showInCalendar: task.showInCalendar !== false,
        };
        tasks.unshift(newTask);
        saveUnifiedTasks(tasks);
        return { ok: true, task: newTask, tasks };
    },

    update: (task: any) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === task.id);
        if (idx >= 0) {
            tasks[idx] = { ...tasks[idx], ...task, updatedAt: new Date().toISOString() };
            saveUnifiedTasks(tasks);
            return { ok: true, task: tasks[idx], tasks };
        }
        return { ok: false, error: 'Task not found' };
    },

    delete: (taskId: string) => {
        const tasks = loadUnifiedTasks();
        const filtered = tasks.filter((t: any) => t.id !== taskId);
        saveUnifiedTasks(filtered);
        return { ok: true, tasks: filtered };
    },

    toggleStatus: (taskId: string) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const task = tasks[idx];
            const isCompleted = task.status === 'completed';
            tasks[idx] = {
                ...task,
                status: isCompleted ? 'pending' : 'completed',
                completedAt: isCompleted ? null : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            saveUnifiedTasks(tasks);
            return { ok: true, task: tasks[idx], tasks };
        }
        return { ok: false, error: 'Task not found' };
    },

    addSubtodo: (taskId: string, subtodo: any) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const newSubtodo = {
                id: `subtodo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                content: subtodo.content || '',
                completed: false,
                createdAt: new Date().toISOString(),
            };
            tasks[idx].subTodos = [...(tasks[idx].subTodos || []), newSubtodo];
            tasks[idx].updatedAt = new Date().toISOString();
            saveUnifiedTasks(tasks);
            return { ok: true, subtodo: newSubtodo, task: tasks[idx] };
        }
        return { ok: false, error: 'Task not found' };
    },

    updateSubtodo: (taskId: string, subtodoId: string, updates: any) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const subIdx = (tasks[idx].subTodos || []).findIndex((s: any) => s.id === subtodoId);
            if (subIdx >= 0) {
                const prevSub = tasks[idx].subTodos[subIdx] || {};
                tasks[idx].subTodos[subIdx] = {
                    ...prevSub,
                    ...updates,
                    content: typeof updates?.content === 'string' ? updates.content : prevSub.content,
                };
                tasks[idx].updatedAt = new Date().toISOString();
                saveUnifiedTasks(tasks);
                return { ok: true, task: tasks[idx], subtodo: tasks[idx].subTodos[subIdx] };
            }
            return { ok: false, error: 'Subtodo not found' };
        }
        return { ok: false, error: 'Task not found' };
    },

    toggleSubtodo: (taskId: string, subtodoId: string) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const subIdx = (tasks[idx].subTodos || []).findIndex((s: any) => s.id === subtodoId);
            if (subIdx >= 0) {
                const sub = tasks[idx].subTodos[subIdx];
                tasks[idx].subTodos[subIdx] = {
                    ...sub,
                    completed: !sub.completed,
                    completedAt: sub.completed ? null : new Date().toISOString(),
                };
                tasks[idx].updatedAt = new Date().toISOString();
                saveUnifiedTasks(tasks);
                return { ok: true, task: tasks[idx] };
            }
        }
        return { ok: false, error: 'Subtodo not found' };
    },

    deleteSubtodo: (taskId: string, subtodoId: string) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            tasks[idx].subTodos = (tasks[idx].subTodos || []).filter((s: any) => s.id !== subtodoId);
            tasks[idx].updatedAt = new Date().toISOString();
            saveUnifiedTasks(tasks);
            return { ok: true, task: tasks[idx] };
        }
        return { ok: false, error: 'Task not found' };
    },

    addAgentAssignment: (taskId: string, assignment: any) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const newAssignment = {
                id: `assign_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: assignment.type || 'reminder',
                scheduledAt: assignment.scheduledAt,
                message: assignment.message || '',
                recurring: assignment.recurring || 'none',
                status: 'pending',
            };
            tasks[idx].agentAssignments = [...(tasks[idx].agentAssignments || []), newAssignment];
            tasks[idx].updatedAt = new Date().toISOString();
            saveUnifiedTasks(tasks);
            return { ok: true, assignment: newAssignment, task: tasks[idx] };
        }
        return { ok: false, error: 'Task not found' };
    },

    updateAgentAssignment: (taskId: string, assignmentId: string, updates: any) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            const aIdx = (tasks[idx].agentAssignments || []).findIndex((a: any) => a.id === assignmentId);
            if (aIdx >= 0) {
                tasks[idx].agentAssignments[aIdx] = { ...tasks[idx].agentAssignments[aIdx], ...updates };
                tasks[idx].updatedAt = new Date().toISOString();
                saveUnifiedTasks(tasks);
                return { ok: true, task: tasks[idx] };
            }
        }
        return { ok: false, error: 'Assignment not found' };
    },

    deleteAgentAssignment: (taskId: string, assignmentId: string) => {
        const tasks = loadUnifiedTasks();
        const idx = tasks.findIndex((t: any) => t.id === taskId);
        if (idx >= 0) {
            tasks[idx].agentAssignments = (tasks[idx].agentAssignments || []).filter((a: any) => a.id !== assignmentId);
            tasks[idx].updatedAt = new Date().toISOString();
            saveUnifiedTasks(tasks);
            return { ok: true, task: tasks[idx] };
        }
        return { ok: false, error: 'Task not found' };
    },

    getPendingAssignments: () => {
        const tasks = loadUnifiedTasks();
        const now = new Date().getTime();
        const pending: any[] = [];
        for (const task of tasks) {
            if (task.status === 'completed' || task.status === 'cancelled') continue;
            for (const assignment of (task.agentAssignments || [])) {
                if (assignment.status !== 'pending') continue;
                const scheduledTime = new Date(assignment.scheduledAt).getTime();
                // Return all pending, regardless of schedule (or maybe only overdue/future?)
                // The original implementation filtered ONLY scheduled <= now.
                // Let's keep that logic for consistency with reminders firing.
                if (scheduledTime <= now) {
                    pending.push({ task, assignment });
                }
            }
        }
        return { ok: true, pending };
    },

    getCalendarItems: () => {
        const tasks = loadUnifiedTasks();
        const items = tasks
            .filter((t: any) => t.showInCalendar && (t.dueDate || t.startDate) && t.status !== 'completed' && t.status !== 'cancelled')
            .map((t: any) => ({
                id: t.id,
                title: t.title,
                start: t.startDate || t.dueDate,
                end: t.dueDate || t.startDate,
                allDay: t.allDay ?? true,
                source: 'unified-tasks',
                type: 'task',
                priority: t.priority,
                status: t.status,
                subTodosTotal: (t.subTodos || []).length,
                subTodosCompleted: (t.subTodos || []).filter((s: any) => s.completed).length,
            }));
        return { ok: true, items };
    }
};
