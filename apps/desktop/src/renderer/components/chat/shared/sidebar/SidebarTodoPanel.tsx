import React from 'react';
import clsx from 'clsx';
import { ListTodo } from 'lucide-react';
import { AgentTodoList } from '../../../genui/AgentTodoList';
import { useAgentTodos, useAgentTodoActivity } from './agentTodoStore';

interface SidebarTodoPanelProps {
  className?: string;
}

export const SidebarTodoPanel: React.FC<SidebarTodoPanelProps> = ({ className }) => {
  // Read from the shared store so the plan survives tab switches / remounts.
  const snapshot = useAgentTodos();
  const active = useAgentTodoActivity();

  const hasItems = !!snapshot && snapshot.items.length > 0;
  const hasStatus = !!snapshot?.status?.label;

  if (!snapshot || (!hasItems && !hasStatus)) {
    return (
      <div className={clsx('flex flex-col items-center justify-center gap-3 px-6 py-10', className)}>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <ListTodo className="h-5 w-5 text-theme-muted" strokeWidth={1.75} />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-semibold text-theme-fg">Nothing running</p>
          <p className="mt-1 text-[11px] leading-relaxed text-theme-muted">
            When the agent starts working, you'll see
            <br />
            what it's doing — and each step — right here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('flex flex-col overflow-hidden', className)}>
      <AgentTodoList
        items={snapshot.items}
        title={snapshot.title || 'Agent Plan'}
        status={snapshot.status}
        active={active}
        progress={snapshot.progress}
        variant="sidebar"
      />
    </div>
  );
};
