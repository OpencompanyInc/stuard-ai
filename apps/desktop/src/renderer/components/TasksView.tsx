import React from 'react';
import { clsx } from 'clsx';
import { UnifiedTasksView } from './UnifiedTasksView';

export type { TaskSubTab } from './UnifiedTasksView';

interface TasksViewProps {
  compact?: boolean;
  defaultSubTab?: import('./UnifiedTasksView').TaskSubTab;
  onSubTabChange?: (tab: import('./UnifiedTasksView').TaskSubTab) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ 
  compact, 
  defaultSubTab,
  onSubTabChange,
}) => {
  return (
    <div className={clsx("flex flex-col h-full", compact ? "" : "")}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <UnifiedTasksView compact={compact} defaultSubTab={defaultSubTab} onSubTabChange={onSubTabChange} />
      </div>
    </div>
  );
};

export default TasksView;
