import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';

export interface SubAgentTask {
  id: string;
  parent_id?: string;
  objective: string;
  status: 'running' | 'completed' | 'failed';
  model: string;
  created_at: string;
  updated_at: string;
  logs: any[];
  result?: any;
  pending_steers?: Array<{ id: string; message: string; created_at: string }>;
}

export interface UseSubagentDashboardReturn {
  tasks: SubAgentTask[];
  activeTask: SubAgentTask | null;
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  dismissed: boolean;
  setDismissed: (v: boolean) => void;
  dismissedTaskIds: Set<string>;
  dismissTask: (id: string) => void;
  visibleTasks: SubAgentTask[];
  hasRunning: boolean;
  refresh: () => void;
  loading: boolean;
}

/**
 * Hook to manage subagent dashboard state: fetching, polling, tab selection,
 * collapse/dismiss behavior.
 */
export function useSubagentDashboard(parentId?: string): UseSubagentDashboardReturn {
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!parentId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('parent_id', parentId);
      const res = await fetch(`${AGENT_HTTP}/v1/subagents/list?${params.toString()}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error('[SubagentDashboard] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => {
    setTasks([]);
    setActiveTaskId(null);
    setCollapsed(false);
    setDismissed(false);
    setDismissedTaskIds(new Set());
  }, [parentId]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  // Poll periodically — fast (2s) when tasks are running, slow (10s) otherwise
  // This prevents the bug where initial fetch returns empty and then never polls again
  useEffect(() => {
    if (!parentId) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const hasRunning = tasks.some(t => t.status === 'running');
    const interval = hasRunning ? 2000 : 10000;
    pollRef.current = setInterval(() => {
      fetchTasks();
    }, interval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [parentId, tasks, fetchTasks]);

  // Auto-show when a new running task appears
  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'running');
    if (hasRunning) {
      setDismissed(false);
      setCollapsed(false);
    }
  }, [tasks]);

  // Auto-select first running task if no active selection
  useEffect(() => {
    if (activeTaskId && tasks.find(t => t.id === activeTaskId)) return;
    const firstRunning = tasks.find(t => t.status === 'running');
    if (firstRunning) {
      setActiveTaskId(firstRunning.id);
    } else if (tasks.length > 0) {
      setActiveTaskId(tasks[0].id);
    }
  }, [tasks, activeTaskId]);

  const dismissTask = useCallback((id: string) => {
    setDismissedTaskIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // If the dismissed task was active, select next
    if (activeTaskId === id) {
      const remaining = tasks.filter(t => t.id !== id && !dismissedTaskIds.has(t.id));
      setActiveTaskId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [activeTaskId, tasks, dismissedTaskIds]);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter(t => !dismissedTaskIds.has(t.id))
      .sort((a, b) => {
        // Running first, then by creation date (newest first)
        if (a.status === 'running' && b.status !== 'running') return -1;
        if (a.status !== 'running' && b.status === 'running') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [tasks, dismissedTaskIds]);

  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    return tasks.find(t => t.id === activeTaskId) || null;
  }, [tasks, activeTaskId]);

  const hasRunning = useMemo(() => tasks.some(t => t.status === 'running'), [tasks]);

  return {
    tasks,
    activeTask,
    activeTaskId,
    setActiveTaskId,
    collapsed,
    setCollapsed,
    dismissed,
    setDismissed,
    dismissedTaskIds,
    dismissTask,
    visibleTasks,
    hasRunning,
    refresh: fetchTasks,
    loading,
  };
}
