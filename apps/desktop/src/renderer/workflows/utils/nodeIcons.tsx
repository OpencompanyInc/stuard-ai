import React from 'react';
import {
  LightningBoltIcon,
  ClockIcon,
  GlobeIcon,
  DesktopIcon,
  FileTextIcon,
  CameraIcon,
  CursorArrowIcon,
  KeyboardIcon,
  CopyIcon,
  GearIcon,
  LaptopIcon,
  RocketIcon,
  TimerIcon,
  Link2Icon,
  EnvelopeClosedIcon,
  TableIcon,
  CalendarIcon,
  MagnifyingGlassIcon,
  ViewHorizontalIcon,
  CodeIcon,
  ImageIcon,
  BoxIcon,
  ChatBubbleIcon
} from "@radix-ui/react-icons";

export function getNodeIcon(type: string, tool: string) {
  // Triggers
  if (type === 'trigger') {
    if (tool.includes('watch')) return <ViewHorizontalIcon className="w-4 h-4" />;
    if (tool.includes('schedule') || tool.includes('cron')) return <ClockIcon className="w-4 h-4" />;
    if (tool.includes('webhook')) return <GlobeIcon className="w-4 h-4" />;
    if (tool.includes('hotkey')) return <KeyboardIcon className="w-4 h-4" />;
    return <LightningBoltIcon className="w-4 h-4" />;
  }

  // Tools
  if (tool.includes('run_command')) return <DesktopIcon className="w-4 h-4" />;
  if (tool.includes('launch')) return <RocketIcon className="w-4 h-4" />;
  if (tool.includes('screenshot') || tool.includes('capture')) return <CameraIcon className="w-4 h-4" />;
  if (tool.includes('click') || tool.includes('drag')) return <CursorArrowIcon className="w-4 h-4" />;
  if (tool.includes('type') || tool.includes('key')) return <KeyboardIcon className="w-4 h-4" />;
  if (tool.includes('window')) return <DesktopIcon className="w-4 h-4" />;
  if (tool.includes('file') || tool.includes('directory')) return <FileTextIcon className="w-4 h-4" />;
  if (tool.includes('clipboard')) return <CopyIcon className="w-4 h-4" />;
  if (tool.includes('memory')) return <BoxIcon className="w-4 h-4" />;
  if (tool.includes('wait')) return <TimerIcon className="w-4 h-4" />;
  
  // Integrations
  if (tool.includes('discord')) return <ChatBubbleIcon className="w-4 h-4" />;
  if (tool.includes('reddit')) return <GlobeIcon className="w-4 h-4" />;
  if (tool.includes('gmail') || tool.includes('mail')) return <EnvelopeClosedIcon className="w-4 h-4" />;
  if (tool.includes('calendar')) return <CalendarIcon className="w-4 h-4" />;
  if (tool.includes('sheet')) return <TableIcon className="w-4 h-4" />;
  if (tool.includes('drive')) return <BoxIcon className="w-4 h-4" />;
  if (tool.includes('docs')) return <FileTextIcon className="w-4 h-4" />;
  
  // Cloud/AI
  if (tool.includes('analyze') || tool.includes('vision')) return <MagnifyingGlassIcon className="w-4 h-4" />;
  if (tool.includes('cloud')) return <GlobeIcon className="w-4 h-4" />;

  return <GearIcon className="w-4 h-4" />;
}

export function getNodeColor(type: string, tool: string) {
  if (type === 'trigger') return 'bg-amber-50 border-amber-200 text-amber-900';
  if (tool.startsWith('discord')) return 'bg-indigo-50 border-indigo-200 text-indigo-900';
  if (tool.startsWith('reddit')) return 'bg-orange-50 border-orange-200 text-orange-900';
  if (tool.includes('cloud') || tool.startsWith('google') || tool.startsWith('gmail') || tool.startsWith('outlook') || tool.startsWith('docs') || tool.startsWith('drive') || tool.startsWith('sheets')) return 'bg-blue-50 border-blue-200 text-blue-900';
  return 'bg-white border-neutral-200 text-neutral-900';
}


