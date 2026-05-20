import React, { useEffect, useState, useRef } from 'react';
import clsx from 'clsx';
import { ListTodo, Inbox } from 'lucide-react';
import { AgentTodoList, type AgentTodoItem, type AgentTodoListProps } from '../../../genui/AgentTodoList';

interface TodoSnapshot {
  items: AgentTodoItem[];
  title?: string;
  progress?: AgentTodoListProps['progress'];
  timestamp: number;
}

interface SidebarTodoPanelProps {
  className?: string;
}

export const SidebarTodoPanel: React.FC<SidebarTodoPanelProps> = ({ className }) => {
  const [snapshot, setSnapshot] = useState<TodoSnapshot | null>(null);
  const latestRef = useRef<TodoSnapshot | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.items && Array.isArray(detail.items)) {
        const snap: TodoSnapshot = {
          items: detail.items,
          title: detail.title,
          progress: detail.progress,
          timestamp: Date.now(),
        };
        latestRef.current = snap;
        setSnapshot(snap);
      }
    };

    window.addEventListener('agent-todo-update', handler);
    return () => window.removeEventListener('agent-todo-update', handler);
  }, []);

  if (!snapshot || snapshot.items.length === 0) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-3 p-6', className)}>
        <div className="p-3 rounded-2xl bg-theme-hover/50">
          <Inbox className="w-8 h-8 text-theme-muted/50" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-theme-muted">No active tasks</p>
          <p className="text-xs text-theme-muted/60 mt-1">
            Agent task progress will appear here automatically
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col overflow-hidden', className)}>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        <AgentTodoList
          items={snapshot.items}
          title={snapshot.title || 'Agent Plan'}
          progress={snapshot.progress}
        />
      </div>
    </div>
  );
};
