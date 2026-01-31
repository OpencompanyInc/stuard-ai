import { useState, useEffect, useCallback, useRef } from 'react';

export interface PendingAssignment {
  task: {
    id: string;
    title: string;
    description?: string;
    dueDate?: string;
    priority: string;
  };
  assignment: {
    id: string;
    type: 'reminder' | 'action' | 'check-in';
    scheduledAt: string;
    message?: string;
    recurring: 'none' | 'daily' | 'weekly' | 'monthly';
    status: string;
  };
}

interface UseTaskAssignmentsResult {
  pendingAssignments: PendingAssignment[];
  checkPendingAssignments: () => Promise<PendingAssignment[]>;
  markAssignmentTriggered: (taskId: string, assignmentId: string) => Promise<void>;
  markAssignmentCompleted: (taskId: string, assignmentId: string) => Promise<void>;
  getAgentContext: () => string;
}

export function useTaskAssignments(): UseTaskAssignmentsResult {
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkPendingAssignments = useCallback(async (): Promise<PendingAssignment[]> => {
    try {
      const res = await (window as any).desktopAPI?.unifiedTasksGetPendingAssignments?.();
      if (res?.ok && Array.isArray(res.pending)) {
        setPendingAssignments(res.pending);
        return res.pending;
      }
    } catch (e) {
      console.error('Failed to check pending assignments:', e);
    }
    return [];
  }, []);

  const markAssignmentTriggered = useCallback(async (taskId: string, assignmentId: string) => {
    try {
      await (window as any).desktopAPI?.unifiedTasksUpdateAgentAssignment?.(taskId, assignmentId, {
        status: 'triggered',
        triggeredAt: new Date().toISOString(),
      });
      // Refresh pending list
      await checkPendingAssignments();
    } catch (e) {
      console.error('Failed to mark assignment triggered:', e);
    }
  }, [checkPendingAssignments]);

  const markAssignmentCompleted = useCallback(async (taskId: string, assignmentId: string) => {
    try {
      await (window as any).desktopAPI?.unifiedTasksUpdateAgentAssignment?.(taskId, assignmentId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      // Refresh pending list
      await checkPendingAssignments();
    } catch (e) {
      console.error('Failed to mark assignment completed:', e);
    }
  }, [checkPendingAssignments]);

  const getAgentContext = useCallback((): string => {
    if (pendingAssignments.length === 0) {
      return '';
    }

    const lines: string[] = [
      '## Scheduled Task Assignments',
      'The following tasks have been assigned to you by the user:',
      '',
    ];

    for (const { task, assignment } of pendingAssignments) {
      const scheduledTime = new Date(assignment.scheduledAt).toLocaleString();
      lines.push(`### ${task.title}`);
      if (task.description) lines.push(`Description: ${task.description}`);
      lines.push(`Type: ${assignment.type}`);
      lines.push(`Scheduled: ${scheduledTime}`);
      if (assignment.message) lines.push(`Message: "${assignment.message}"`);
      if (task.dueDate) lines.push(`Task Due: ${new Date(task.dueDate).toLocaleDateString()}`);
      lines.push(`Priority: ${task.priority}`);
      lines.push('');
    }

    lines.push('Please acknowledge these tasks and take appropriate action based on their type:');
    lines.push('- **reminder**: Remind the user about this task');
    lines.push('- **action**: Take action on this task or ask user what to do');
    lines.push('- **check-in**: Check in with user about progress on this task');

    return lines.join('\n');
  }, [pendingAssignments]);

  // Check for pending assignments periodically
  useEffect(() => {
    // Initial check
    checkPendingAssignments();

    // Check every 30 seconds
    checkIntervalRef.current = setInterval(() => {
      checkPendingAssignments();
    }, 30000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkPendingAssignments]);

  return {
    pendingAssignments,
    checkPendingAssignments,
    markAssignmentTriggered,
    markAssignmentCompleted,
    getAgentContext,
  };
}

export default useTaskAssignments;
