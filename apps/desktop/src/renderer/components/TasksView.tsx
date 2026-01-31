import React from 'react';
import { clsx } from 'clsx';
import { UnifiedTasksView } from './UnifiedTasksView';

interface TasksViewProps {
  compact?: boolean;
}

export const TasksView: React.FC<TasksViewProps> = ({ 
  compact, 
}) => {
  return (
    <div className={clsx("flex flex-col h-full", compact ? "" : "")}>
      <div className="flex-1 min-h-0 overflow-hidden">
        <UnifiedTasksView compact={compact} />
      </div>
    </div>
  );
};

export default TasksView;
