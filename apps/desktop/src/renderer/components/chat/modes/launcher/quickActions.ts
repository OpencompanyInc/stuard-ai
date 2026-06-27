import { MessageCircle, Zap, FolderSearch, ListTodo, Plus } from 'lucide-react';

// Quick action card data shown on the empty launcher
export const quickActions = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    color: "from-violet-500 to-purple-600",
    bgLight: "bg-primary/10",
    textColor: "text-primary",
    description: "Start a conversation",
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: Zap,
    color: "from-amber-500 to-orange-600",
    bgLight: "bg-amber-500/10",
    textColor: "text-amber-500",
    description: "Automate tasks",
  },
  {
    id: "files",
    label: "Files",
    icon: FolderSearch,
    color: "from-emerald-500 to-teal-600",
    bgLight: "bg-emerald-500/10",
    textColor: "text-emerald-500",
    description: "Search your files",
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: ListTodo,
    color: "from-sky-500 to-indigo-600",
    bgLight: "bg-sky-500/10",
    textColor: "text-sky-500",
    description: "View your tasks",
  },
  {
    id: "add",
    label: "Add",
    icon: Plus,
    color: "from-slate-400 to-slate-600",
    bgLight: "bg-theme-hover",
    textColor: "text-theme-muted",
    description: "Create a shortcut",
  },
];
