import React from 'react';
import { Calendar, Bell, ListTodo, Video } from 'lucide-react';
import type { NextUpItem } from '../../../../hooks/usePlannerData';

export const NextUpIcon: React.FC<{ type: NextUpItem["icon"] }> = ({ type }) => {
  switch (type) {
    case "calendar":
      return <Calendar className="w-3.5 h-3.5 text-white" />;
    case "bell":
      return <Bell className="w-3.5 h-3.5 text-white" />;
    case "task":
      return <ListTodo className="w-3.5 h-3.5 text-white" />;
    default:
      return <Video className="w-3.5 h-3.5 text-white" />;
  }
};

// Helper to get background color for next up item based on urgency
export const getNextUpBgColor = (item: NextUpItem) => {
  if (item.urgency === "now") return "bg-red-500 animate-pulse";
  if (item.urgency === "soon") return "bg-amber-500";

  switch (item.icon) {
    case "calendar":
      return "bg-blue-500";
    case "bell":
      return "bg-amber-500";
    case "task":
      return "bg-emerald-500";
    default:
      return "bg-blue-500";
  }
};

// Helper to get text color based on urgency
export const getNextUpTextColor = (item: NextUpItem) => {
  if (item.urgency === "now") return "text-red-600";
  if (item.urgency === "soon") return "text-amber-700 dark:text-amber-500";
  return "text-theme-fg";
};
