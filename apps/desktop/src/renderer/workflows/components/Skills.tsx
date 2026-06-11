/**
 * Skills - Visual agent skills/routines system
 * Allows users to define reusable skill patterns for Stuard AI
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Search, Plus, Trash2, Wand2, MessageSquare, Terminal, Eye, Brain,
  GripVertical, X, Save, ToggleLeft, ToggleRight, AlertCircle, Check,
  Zap, FileText, Settings, ChevronDown, Lightbulb,
  Code, MousePointer, Image, Mail, Globe, Database, Mic, Video,
  FolderOpen, Play, Clock, ArrowRight, Cpu, Box, Layers, Send,
  BarChart, HardDrive, Cloud, Webhook, Type, ListChecks, Sparkles,
  CheckCheck, XCircle, Upload, Inbox, PowerOff, LayoutGrid
} from "lucide-react";
import { TOOL_SCHEMAS, getCategories } from "../constants/tool-schemas";
import { ChatHistory } from "./chat/ChatHistory";
import { ChatInput, ChatInputRef } from "./chat/ChatInput";
import { useSkillChat } from "../hooks/useSkillChat";
import { useModelRegistry } from "../../hooks/useModelRegistry";
import { buildContextUsageMetrics } from "../../utils/contextUsage";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import { usePreferences } from "../../hooks/usePreferences";
import type { ReasoningLevel } from "../../hooks/usePreferences";

const WF_INPUT = "wf-input focus:outline-none";

// ============================================================================
// TYPES
// ============================================================================

export type SkillStepType = 'prompt' | 'tool' | 'condition' | 'output';

export interface SkillStep {
  id: string;
  type: SkillStepType;
  label: string;
  content: string;
  toolName?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  trigger: string;
  steps: SkillStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  source?: 'auto' | 'manual';
  metadata?: {
    sourceConversationId?: string;
    confidence?: number;
    antiPatterns?: string[];
    toolUsage?: Array<{ toolName: string; count: number }>;
    userInjections?: Array<{ summary: string }>;
    generatedAt?: string;
    [key: string]: any;
  };
}

// ============================================================================
// TOOLS FROM TOOL-SCHEMAS
// ============================================================================

// Map category names to icons
const CATEGORY_ICONS: Record<string, any> = {
  flow: Layers,
  system: Terminal,
  input: MousePointer,
  vision: Eye,
  data: Database,
  integrations: Cloud,
  ui: LayoutGrid,
  utils: Zap,
  core: Cpu,
};

// Format category name for display
function formatCategory(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

// Get icon for a tool based on its category or name
function getToolIcon(toolId: string, category: string): any {
  // Special cases for common tools
  const iconMap: Record<string, any> = {
    run_command: Terminal,
    run_python_script: Code,
    run_node_script: Code,
    read_file: FileText,
    write_file: FileText,
    take_screenshot: Image,
    capture_media: Video,
    capture_screen: Video,
    ai_inference: Brain,
    web_search: Globe,
    send_notification: MessageSquare,
    gmail_send_message: Mail,
    calendar_list_events: Clock,
    text_to_speech: Mic,
    play_audio: Play,
    custom_ui: LayoutGrid,
    http_request: Webhook,
    type_text: Type,
    send_hotkey: Zap,
    db_store: HardDrive,
    db_query: Database,
    agent_todo: ListChecks,
    analyze_image: Eye,
    analyze_current_screen: Eye,
  };
  return iconMap[toolId] || CATEGORY_ICONS[category] || Box;
}

// Build tools list from TOOL_SCHEMAS
export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: any;
}

export const AVAILABLE_TOOLS: ToolInfo[] = Object.entries(TOOL_SCHEMAS).map(([id, schema]) => ({
  id,
  name: schema.label || id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  description: schema.description || '',
  category: formatCategory(schema.category || 'core'),
  icon: getToolIcon(id, schema.category || 'core'),
}));

// Get unique categories from tool schemas
export const TOOL_CATEGORIES = getCategories().map(formatCategory);

// ============================================================================
// CONSTANTS
// ============================================================================

export const STEP_TYPE_CONFIG: Record<SkillStepType, { label: string; color: string; icon: any; description: string }> = {
  prompt: { label: 'Prompt', color: 'blue', icon: MessageSquare, description: 'Instructions for the AI to follow' },
  tool: { label: 'Tool', color: 'purple', icon: Terminal, description: 'Execute a specific tool or action' },
  condition: { label: 'Condition', color: 'amber', icon: AlertCircle, description: 'Branch based on a condition' },
  output: { label: 'Output', color: 'emerald', icon: Check, description: 'Define the output format' },
};

export const SKILL_COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose', 'cyan', 'indigo', 'teal'];

export const SKILL_ICONS = [
  { name: 'Eye', icon: Eye },
  { name: 'MessageSquare', icon: MessageSquare },
  { name: 'Search', icon: Search },
  { name: 'Terminal', icon: Terminal },
  { name: 'Brain', icon: Brain },
  { name: 'Wand2', icon: Wand2 },
  { name: 'Zap', icon: Zap },
  { name: 'FileText', icon: FileText },
  { name: 'Code', icon: Code },
  { name: 'Globe', icon: Globe },
  { name: 'Mail', icon: Mail },
  { name: 'Database', icon: Database },
];

// ============================================================================
// MOCK DATA
// ============================================================================

export const DEFAULT_SKILLS: Skill[] = [
  {
    id: 'skill_code_review',
    name: 'Code Reviewer',
    description: 'Analyzes code for bugs, security issues, and suggests improvements following best practices.',
    icon: 'Eye',
    color: 'purple',
    trigger: 'When user asks to review code or mentions "code review"',
    steps: [
      { id: 's1', type: 'prompt', label: 'Analyze Code', content: 'First, identify the programming language and framework being used.' },
      { id: 's2', type: 'tool', label: 'Read File', content: 'Read the file to review', toolName: 'read_file' },
      { id: 's3', type: 'prompt', label: 'Check Issues', content: 'Look for: bugs, security vulnerabilities, performance issues, code style.' },
      { id: 's4', type: 'output', label: 'Report', content: 'Provide a structured report with severity levels for each issue found.' },
    ],
    isActive: true,
    createdAt: '2026-02-20T10:00:00Z',
    updatedAt: '2026-02-27T15:30:00Z',
  },
  {
    id: 'skill_email_draft',
    name: 'Email Drafter',
    description: 'Composes professional emails based on context and user intent.',
    icon: 'Mail',
    color: 'blue',
    trigger: 'When user asks to write or draft an email',
    steps: [
      { id: 's1', type: 'prompt', label: 'Understand Intent', content: 'Identify the purpose, tone, and recipient of the email.' },
      { id: 's2', type: 'condition', label: 'Check Tone', content: 'If formal, use professional language. If casual, be friendly.' },
      { id: 's3', type: 'output', label: 'Draft Email', content: 'Write the email with subject line, greeting, body, and sign-off.' },
    ],
    isActive: true,
    createdAt: '2026-02-18T09:00:00Z',
    updatedAt: '2026-02-26T11:00:00Z',
  },
  {
    id: 'skill_research',
    name: 'Research Assistant',
    description: 'Searches the web and synthesizes information on any topic.',
    icon: 'Globe',
    color: 'emerald',
    trigger: 'When user asks to research or find information about a topic',
    steps: [
      { id: 's1', type: 'prompt', label: 'Define Query', content: 'Extract the main research question and key terms.' },
      { id: 's2', type: 'tool', label: 'Web Search', content: 'Search for relevant information', toolName: 'web_search' },
      { id: 's3', type: 'prompt', label: 'Synthesize', content: 'Combine findings into a coherent summary with citations.' },
      { id: 's4', type: 'output', label: 'Report', content: 'Present findings with key points and sources.' },
    ],
    isActive: false,
    createdAt: '2026-02-15T14:00:00Z',
    updatedAt: '2026-02-25T09:00:00Z',
  },
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getSkillColorClasses(color: string, d = false): { bg: string; icon: string; border: string; bgSoft: string; accent: string } {
  const light: Record<string, { bg: string; icon: string; border: string; bgSoft: string; accent: string }> = {
    blue: { bg: 'bg-blue-600', icon: 'text-blue-600', border: 'border-blue-200', bgSoft: 'bg-blue-50', accent: 'border-blue-500' },
    purple: { bg: 'bg-purple-600', icon: 'text-purple-600', border: 'border-purple-200', bgSoft: 'bg-purple-50', accent: 'border-purple-500' },
    emerald: { bg: 'bg-emerald-600', icon: 'text-emerald-600', border: 'border-emerald-200', bgSoft: 'bg-emerald-50', accent: 'border-emerald-500' },
    amber: { bg: 'bg-amber-500', icon: 'text-amber-600', border: 'border-amber-200', bgSoft: 'bg-amber-50', accent: 'border-amber-500' },
    rose: { bg: 'bg-rose-600', icon: 'text-rose-600', border: 'border-rose-200', bgSoft: 'bg-rose-50', accent: 'border-rose-500' },
    cyan: { bg: 'bg-cyan-600', icon: 'text-cyan-600', border: 'border-cyan-200', bgSoft: 'bg-cyan-50', accent: 'border-cyan-500' },
    indigo: { bg: 'bg-indigo-600', icon: 'text-indigo-600', border: 'border-indigo-200', bgSoft: 'bg-indigo-50', accent: 'border-indigo-500' },
    teal: { bg: 'bg-teal-600', icon: 'text-teal-600', border: 'border-teal-200', bgSoft: 'bg-teal-50', accent: 'border-teal-500' },
  };
  const dark: Record<string, { bg: string; icon: string; border: string; bgSoft: string; accent: string }> = {
    blue: { bg: 'bg-blue-500', icon: 'text-blue-400', border: 'border-blue-500/30', bgSoft: 'bg-blue-500/15', accent: 'border-blue-500' },
    purple: { bg: 'bg-purple-500', icon: 'text-purple-400', border: 'border-purple-500/30', bgSoft: 'bg-purple-500/15', accent: 'border-purple-500' },
    emerald: { bg: 'bg-emerald-500', icon: 'text-emerald-400', border: 'border-emerald-500/30', bgSoft: 'bg-emerald-500/15', accent: 'border-emerald-500' },
    amber: { bg: 'bg-amber-500', icon: 'text-amber-400', border: 'border-amber-500/30', bgSoft: 'bg-amber-500/15', accent: 'border-amber-500' },
    rose: { bg: 'bg-rose-500', icon: 'text-rose-400', border: 'border-rose-500/30', bgSoft: 'bg-rose-500/15', accent: 'border-rose-500' },
    cyan: { bg: 'bg-cyan-500', icon: 'text-cyan-400', border: 'border-cyan-500/30', bgSoft: 'bg-cyan-500/15', accent: 'border-cyan-500' },
    indigo: { bg: 'bg-indigo-500', icon: 'text-indigo-400', border: 'border-indigo-500/30', bgSoft: 'bg-indigo-500/15', accent: 'border-indigo-500' },
    teal: { bg: 'bg-teal-500', icon: 'text-teal-400', border: 'border-teal-500/30', bgSoft: 'bg-teal-500/15', accent: 'border-teal-500' },
  };
  const colors = d ? dark : light;
  return colors[color] || colors.blue;
}

function getStepColorClasses(type: SkillStepType, d = false) {
  const light = {
    prompt: {
      border: 'border-blue-200',
      headerBg: 'bg-blue-50/50',
      iconBg: 'bg-blue-100',
      iconText: 'text-blue-600',
      badge: 'bg-blue-50 text-blue-700 border-blue-200',
      accent: 'border-l-blue-500',
    },
    tool: {
      border: 'border-purple-200',
      headerBg: 'bg-purple-50/50',
      iconBg: 'bg-purple-100',
      iconText: 'text-purple-600',
      badge: 'bg-purple-50 text-purple-700 border-purple-200',
      accent: 'border-l-purple-500',
    },
    condition: {
      border: 'border-amber-200',
      headerBg: 'bg-amber-50/50',
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-600',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      accent: 'border-l-amber-500',
    },
    output: {
      border: 'border-emerald-200',
      headerBg: 'bg-emerald-50/50',
      iconBg: 'bg-emerald-100',
      iconText: 'text-emerald-600',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      accent: 'border-l-emerald-500',
    },
  };
  const dark = {
    prompt: {
      border: 'border-blue-500/25',
      headerBg: 'bg-blue-500/10',
      iconBg: 'bg-blue-500/20',
      iconText: 'text-blue-400',
      badge: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
      accent: 'border-l-blue-500',
    },
    tool: {
      border: 'border-purple-500/25',
      headerBg: 'bg-purple-500/10',
      iconBg: 'bg-purple-500/20',
      iconText: 'text-purple-400',
      badge: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
      accent: 'border-l-purple-500',
    },
    condition: {
      border: 'border-amber-500/25',
      headerBg: 'bg-amber-500/10',
      iconBg: 'bg-amber-500/20',
      iconText: 'text-amber-400',
      badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
      accent: 'border-l-amber-500',
    },
    output: {
      border: 'border-emerald-500/25',
      headerBg: 'bg-emerald-500/10',
      iconBg: 'bg-emerald-500/20',
      iconText: 'text-emerald-400',
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
      accent: 'border-l-emerald-500',
    },
  };
  const colors = d ? dark : light;
  return colors[type];
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// SKILLS LIBRARY VIEW
// ============================================================================

export type SkillsTab = 'all' | 'suggested' | 'inactive';

export function isSkillPending(skill: Skill): boolean {
  return skill.source === 'auto' && !skill.metadata?.approvedAt;
}

interface SkillsLibraryProps {
  skills: Skill[];
  search: string;
  onSearchChange: (search: string) => void;
  onCreateSkill: () => void;
  onEditSkill: (skill: Skill) => void;
  onDeleteSkill: (id: string) => void;
  onToggleSkill: (id: string) => void;
  onApproveSkill?: (skill: Skill) => void;
  onPublishSkill?: (skill: Skill) => void;
}

export function SkillsLibrary({
  skills,
  search,
  onSearchChange,
  onCreateSkill,
  onEditSkill,
  onDeleteSkill,
  onToggleSkill,
  onApproveSkill,
  onPublishSkill,
}: SkillsLibraryProps) {
  const { isDark: d } = useWorkflowTheme();
  const [tab, setTab] = useState<SkillsTab>('all');

  const buckets = useMemo(() => {
    const pending: Skill[] = [];
    const inactive: Skill[] = [];
    const all: Skill[] = [];
    for (const s of skills) {
      if (isSkillPending(s)) {
        pending.push(s);
      } else if (!s.isActive) {
        inactive.push(s);
        all.push(s);
      } else {
        all.push(s);
      }
    }
    return { all, pending, inactive };
  }, [skills]);

  const visibleSource = tab === 'suggested' ? buckets.pending : tab === 'inactive' ? buckets.inactive : buckets.all;

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return visibleSource;
    const q = search.toLowerCase();
    return visibleSource.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [visibleSource, search]);

  const tabs: { id: SkillsTab; label: string; count: number; icon: any; description: string }[] = [
    { id: 'all',       label: 'All Skills',  count: buckets.all.length,      icon: LayoutGrid, description: 'Approved skills ready to use' },
    { id: 'suggested', label: 'Suggested',   count: buckets.pending.length,  icon: Lightbulb,  description: 'Auto-detected skills awaiting your approval' },
    { id: 'inactive',  label: 'Inactive',    count: buckets.inactive.length, icon: PowerOff,   description: 'Skills you have toggled off' },
  ];

  return (
    <>
      {/* Tabs + create */}
      <div className="px-8 pb-3 shrink-0 flex items-center justify-between gap-3">
        <div className="inline-flex p-0.5 rounded-full wf-surface-muted">
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            const isPendingTab = t.id === 'suggested';
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isActive ? 'wf-bg-elevated wf-fg shadow-sm' : 'wf-fg-muted wf-hover-fg'
                }`}
                title={t.description}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold wf-icon-chip ${isActive ? 'wf-fg' : 'wf-fg-faint'}`}>
                    {t.count}
                  </span>
                )}
                {isPendingTab && t.count > 0 && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--wf-fg-faint)' }} />
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onCreateSkill}
          className="wf-primary-btn inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold shrink-0"
        >
          <Plus className="w-4 h-4" /> New Skill
        </button>
      </div>

      {/* Skills Info Bar */}
      <div className="px-8 pb-5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg border shadow-sm wf-bg-elevated wf-border">
          <Brain className="w-4 h-4 wf-fg-muted" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium wf-fg">{skills.filter(s => s.isActive).length} active</span>
            <span className="text-xs wf-fg-muted">of {skills.length} skills</span>
          </div>
        </div>
        {buckets.pending.length > 0 && tab !== 'suggested' && (
          <button
            onClick={() => setTab('suggested')}
            className="wf-card wf-card-interactive flex items-center gap-2 px-3 py-2 rounded-full wf-fg-muted hover:wf-fg"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">{buckets.pending.length} pending review</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
        <p className="text-sm wf-fg-muted">
          {tab === 'suggested'
            ? 'Review auto-detected skills and approve to add them to your library.'
            : tab === 'inactive'
              ? 'Skills currently disabled. Toggle them back on to use them again.'
              : 'Skills define how Stuard responds to specific requests with structured steps.'}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 px-8 pb-8 overflow-y-auto scrollbar-minimal">
        {filteredSkills.length === 0 ? (
          /* Empty state per tab */
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 shadow-sm rounded-full flex items-center justify-center mb-4 border wf-bg-elevated wf-border">
              {search ? (
                <Search className="w-5 h-5 wf-fg-faint" />
              ) : tab === 'suggested' ? (
                <Lightbulb className="w-5 h-5 wf-fg-faint" />
              ) : tab === 'inactive' ? (
                <PowerOff className="w-5 h-5 wf-fg-faint" />
              ) : (
                <Inbox className="w-5 h-5 wf-fg-faint" />
              )}
            </div>
            <h3 className="text-sm font-semibold wf-fg">
              {search
                ? 'No skills found'
                : tab === 'suggested' ? 'No suggestions yet'
                : tab === 'inactive' ? 'No inactive skills'
                : 'No skills yet'}
            </h3>
            <p className="text-xs mt-1 max-w-sm wf-fg-muted">
              {search
                ? 'Try adjusting your search query.'
                : tab === 'suggested' ? 'Stuard will surface skills here as it learns patterns from your conversations.'
                : tab === 'inactive' ? 'Skills toggled off will appear here for easy re-enabling.'
                : 'Create your first skill to define a reusable behavior for Stuard.'}
            </p>
            {!search && tab === 'all' && (
              <button
                onClick={onCreateSkill}
                className="wf-primary-btn mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Create skill
              </button>
            )}
          </div>
        ) : (
          /* List */
          <div className="wf-card rounded-[16px] overflow-hidden">
            {filteredSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                tab={tab}
                d={d}
                onEdit={onEditSkill}
                onDelete={onDeleteSkill}
                onToggle={onToggleSkill}
                onApprove={onApproveSkill}
                onPublish={onPublishSkill}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface SkillRowProps {
  skill: Skill;
  tab: SkillsTab;
  d: boolean;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onApprove?: (skill: Skill) => void;
  onPublish?: (skill: Skill) => void;
}

/**
 * SkillRow — a calm, neutral list row (no card chrome, no brand-red tints).
 * The skill's own colour shows only as a quiet icon tint for identity; status
 * uses muted neutrals, with semantic green/red reserved for published/failed.
 */
function SkillRow({ skill, tab, d, onEdit, onDelete, onToggle, onApprove, onPublish }: SkillRowProps) {
  const IconComponent = SKILL_ICONS.find(i => i.name === skill.icon)?.icon || Wand2;
  const colorClasses = getSkillColorClasses(skill.color, d);
  const isPending = tab === 'suggested';
  const publishStatus = skill.metadata?.publishStatus as 'published' | 'failed' | undefined;
  const lastPublishError = (skill.metadata?.lastPublishError as string | undefined) || '';
  const metaTime = skill.source === 'auto'
    ? `Learned ${formatRelativeTime(skill.metadata?.generatedAt || skill.createdAt)}`
    : (skill.updatedAt ? `Updated ${formatRelativeTime(skill.updatedAt)}` : '');

  return (
    <div
      onClick={() => onEdit(skill)}
      className="group flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors wf-hover-bg border-b wf-border-subtle last:border-b-0"
    >
      {/* Icon — quiet skill-colour tint, dimmed when inactive */}
      <div className={`w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 border ${colorClasses.bgSoft} ${colorClasses.border} ${!skill.isActive && !isPending ? 'opacity-50' : ''}`}>
        <IconComponent className={`w-[18px] h-[18px] ${colorClasses.icon}`} />
      </div>

      {/* Main */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-[13.5px] wf-fg truncate">{skill.name}</h3>
          {(isPending || skill.source === 'auto') && (
            <span className="wf-icon-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider wf-fg-muted shrink-0">
              <Lightbulb className="w-2.5 h-2.5" />
              {isPending ? 'Pending' : 'Auto'}
            </span>
          )}
          {!isPending && publishStatus === 'published' && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                d ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}
              title="Published to Marketplace"
            >
              <Check className="w-2.5 h-2.5" />
              Published
            </span>
          )}
          {!isPending && publishStatus === 'failed' && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 ${
                d ? 'bg-rose-500/15 text-rose-300 border border-rose-500/25' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
              title={lastPublishError || 'Last publish attempt failed'}
            >
              <AlertCircle className="w-2.5 h-2.5" />
              Failed
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] wf-fg-faint">
          <span className="shrink-0">{skill.steps.length} step{skill.steps.length !== 1 ? 's' : ''}</span>
          {skill.trigger && (
            <>
              <span className="opacity-50 shrink-0">·</span>
              <span className="truncate">{skill.trigger}</span>
            </>
          )}
        </div>
      </div>

      {/* Right — actions */}
      {isPending ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onApprove?.(skill); }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-sm"
            title="Approve and add to library"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(skill); }}
            className="wf-card wf-card-interactive inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium wf-fg-muted hover:wf-fg"
            title="Edit before approving"
          >
            <FileText className="w-3.5 h-3.5" />
            Review
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(skill.id); }}
            className="inline-flex items-center justify-center p-1.5 rounded-full transition-colors wf-fg-faint hover:text-rose-400 hover:bg-rose-500/10"
            title="Dismiss"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          {metaTime && <span className="hidden md:block text-[11px] wf-fg-faint mr-1">{metaTime}</span>}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onPublish && (
              <button
                onClick={(e) => { e.stopPropagation(); onPublish(skill); }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  publishStatus === 'published'
                    ? d ? 'text-emerald-300 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'
                    : 'wf-fg-muted hover:wf-fg wf-hover-bg'
                }`}
                title={publishStatus === 'published' ? 'Push a new version to the Marketplace' : 'Publish to Marketplace'}
              >
                <Upload className="w-3 h-3" />
                {publishStatus === 'published' ? 'Update' : 'Publish'}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(skill.id); }}
              className="p-1.5 rounded-full transition-colors wf-fg-faint hover:text-rose-400 hover:bg-rose-500/10"
              title="Delete skill"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(skill.id); }}
            className={`p-1 rounded-md transition-colors shrink-0 ${skill.isActive ? 'text-emerald-500 hover:bg-emerald-500/10' : 'wf-fg-faint wf-hover-bg'}`}
            title={skill.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
          >
            {skill.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SKILL EDITOR
// ============================================================================

interface SkillEditorProps {
  skill: Skill;
  onSave: (skill: Skill) => void;
  onCancel: () => void;
  cloudAiHttp?: string;
  onPublish?: (skill: Skill) => void;
}

export function SkillEditor({ skill, onSave, onCancel, cloudAiHttp, onPublish }: SkillEditorProps) {
  const { isDark: d } = useWorkflowTheme();
  const { modelSource, setModelSource } = usePreferences();
  const [editedSkill, setEditedSkill] = useState<Skill>(skill);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [toolSearchOpen, setToolSearchOpen] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState("");
  const [showAI, setShowAI] = useState(false);
  const chatInputRef = useRef<ChatInputRef>(null);
  const [skillChatModelId, setSkillChatModelId] = useState<string | 'auto'>(() => {
    try {
      const raw = window.localStorage.getItem('skill.chat_model_id');
      const v = raw ? String(raw).trim() : 'auto';
      return v ? (v as string | 'auto') : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [skillReasoningLevel, setSkillReasoningLevel] = useState<ReasoningLevel>(() => {
    try {
      const raw = window.localStorage.getItem('skill.reasoning_level');
      return raw === 'none' || raw === 'minimal' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh' ? raw : 'high';
    } catch {
      return 'high';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('skill.chat_model_id', String(skillChatModelId || 'auto'));
    } catch { /* ignore */ }
  }, [skillChatModelId]);

  useEffect(() => {
    try {
      window.localStorage.setItem('skill.reasoning_level', skillReasoningLevel);
    } catch { /* ignore */ }
  }, [skillReasoningLevel]);

  const applySkillUpdates = useCallback((updates: Partial<Skill>) => {
    setEditedSkill(prev => ({
      ...prev,
      ...updates,
      id: prev.id,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const skillChat = useSkillChat({
    skill: editedSkill,
    onApplySkill: applySkillUpdates,
    cloudAiHttp,
    selectedModelId: skillChatModelId,
    selectedModelSource: modelSource,
    selectedReasoningLevel: skillReasoningLevel,
  });
  const { modelById } = useModelRegistry();
  const skillContextMetrics = useMemo(() => buildContextUsageMetrics({
    usage: skillChat.latestUsage,
    modelId: skillChat.latestModelId || (skillChatModelId !== 'auto' ? skillChatModelId : undefined),
    modelById,
  }), [modelById, skillChat.latestModelId, skillChat.latestUsage, skillChatModelId]);

  const updateSkill = (updates: Partial<Skill>) => {
    setEditedSkill(prev => ({ ...prev, ...updates }));
  };

  const addStep = (type: SkillStepType) => {
    const newStep: SkillStep = {
      id: `step_${Date.now()}`,
      type,
      label: `New ${STEP_TYPE_CONFIG[type].label}`,
      content: '',
      toolName: type === 'tool' ? '' : undefined,
    };
    updateSkill({ steps: [...editedSkill.steps, newStep] });
  };

  const updateStep = (stepId: string, updates: Partial<SkillStep>) => {
    updateSkill({
      steps: editedSkill.steps.map(s => s.id === stepId ? { ...s, ...updates } : s)
    });
  };

  const deleteStep = (stepId: string) => {
    updateSkill({ steps: editedSkill.steps.filter(s => s.id !== stepId) });
  };

  const moveStep = (fromIndex: number, toIndex: number) => {
    const newSteps = [...editedSkill.steps];
    const [removed] = newSteps.splice(fromIndex, 1);
    newSteps.splice(toIndex, 0, removed);
    updateSkill({ steps: newSteps });
  };

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return AVAILABLE_TOOLS;
    const q = toolSearch.toLowerCase();
    return AVAILABLE_TOOLS.filter(t => 
      t.name.toLowerCase().includes(q) || 
      t.description.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  }, [toolSearch]);

  const IconComponent = SKILL_ICONS.find(i => i.name === editedSkill.icon)?.icon || Wand2;
  const colorClasses = getSkillColorClasses(editedSkill.color, d);

  return (
    <div className="flex-1 flex h-screen w-screen overflow-hidden font-sans wf-bg wf-fg">

      {/* Left Panel - Skill Settings */}
      <div className="w-[320px] flex flex-col border-r overflow-hidden shrink-0 z-10 wf-bg-elevated border wf-border">
        {/* Header */}
        <div className="h-14 px-4 border-b flex items-center justify-between shrink-0 wf-border wf-bg-overlay">
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="p-1.5 rounded-md wf-fg-faint wf-hover-fg wf-hover-bg transition-colors">
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold wf-fg">
              {skill.id.startsWith('skill_') && skill.name === 'New Skill' ? 'Create Skill' : skill.source === 'auto' ? 'Auto-Skill Settings' : 'Skill Settings'}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {onPublish && (
              <button
                onClick={() => onPublish(editedSkill)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium border wf-border wf-fg-muted hover:text-[color:var(--wf-accent)] hover:bg-[var(--wf-accent-soft)]"
                title="Publish to Marketplace"
              >
                <Upload className="w-3.5 h-3.5" />
                Publish
              </button>
            )}
            <button
              onClick={() => onSave(editedSkill)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-xs font-medium ${
                d ? 'bg-white text-slate-900 hover:bg-white/90' : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>

        {/* Settings Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Auto-Skill Origin Banner */}
          {editedSkill.source === 'auto' && (
            <div className="wf-surface-muted p-3 rounded-[12px] space-y-2">
              <div className="flex items-center gap-2">
                <div className="wf-icon-chip w-6 h-6 rounded-full flex items-center justify-center">
                  <Lightbulb className="w-3.5 h-3.5 wf-fg-muted" />
                </div>
                <div>
                  <span className="text-xs font-semibold wf-fg">Auto-Generated Skill</span>
                  <p className="text-[10px] wf-fg-muted">Learned from conversation patterns</p>
                </div>
              </div>
              {editedSkill.metadata?.confidence != null && (
                <div className="flex items-center gap-3 text-[10px] wf-fg-muted">
                  <span>Confidence: <strong className="wf-fg">{Math.round(editedSkill.metadata.confidence * 100)}%</strong></span>
                  {editedSkill.metadata.generatedAt && (
                    <span>Detected: {formatRelativeTime(editedSkill.metadata.generatedAt)}</span>
                  )}
                </div>
              )}
              {editedSkill.metadata?.antiPatterns && editedSkill.metadata.antiPatterns.length > 0 && (
                <div className="pt-1 border-t wf-border-subtle">
                  <span className="text-[10px] font-medium flex items-center gap-1 mb-1 wf-fg-muted">
                    <AlertCircle className="w-3 h-3" /> Mistakes to avoid
                  </span>
                  <ul className="space-y-0.5">
                    {editedSkill.metadata.antiPatterns.slice(0, 3).map((ap: string, i: number) => (
                      <li key={i} className="text-[10px] pl-3 wf-fg-muted">· {ap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Active Toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg border ${d ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${editedSkill.isActive ? 'bg-emerald-500' : (d ? 'bg-white/20' : 'bg-slate-300')}`} />
              <span className="text-sm font-medium wf-fg">Skill Active</span>
            </div>
            <button
              onClick={() => updateSkill({ isActive: !editedSkill.isActive })}
              className={`transition-colors ${editedSkill.isActive ? 'text-emerald-500' : 'wf-fg-faint'}`}
            >
              {editedSkill.isActive ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
            </button>
          </div>
          
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium wf-fg">Name</label>
            <input
              type="text"
              value={editedSkill.name}
              onChange={(e) => updateSkill({ name: e.target.value })}
              className={`w-full px-3 py-2 rounded-md text-sm ${WF_INPUT}`}
              placeholder="e.g., Code Reviewer"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium wf-fg">Description</label>
            <textarea
              value={editedSkill.description}
              onChange={(e) => updateSkill({ description: e.target.value })}
              rows={3}
              className={`w-full px-3 py-2 rounded-md text-sm resize-none ${WF_INPUT}`}
              placeholder="What does this skill do..."
            />
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium wf-fg">Trigger</label>
            </div>
            <textarea
              value={editedSkill.trigger}
              onChange={(e) => updateSkill({ trigger: e.target.value })}
              rows={2}
              className={`w-full px-3 py-2 rounded-md text-sm resize-none font-mono text-xs ${WF_INPUT}`}
              placeholder="When the user asks to..."
            />
            <p className="text-[10px] wf-fg-muted">Natural language trigger instruction for the orchestrator agent.</p>
          </div>

          {/* Icon & Color Picker */}
          <div className="space-y-4 pt-4 border-t wf-border-subtle">
            <div className="space-y-2">
              <label className="text-xs font-medium wf-fg">Icon</label>
              <div className="flex flex-wrap gap-1.5">
                {SKILL_ICONS.map(({ name, icon: Icon }) => (
                  <button
                    key={name}
                    onClick={() => updateSkill({ icon: name })}
                    className={`p-2 rounded-md border transition-colors ${
                      editedSkill.icon === name
                        ? d ? 'bg-white/[0.08] border-white/20 wf-fg shadow-sm' : 'bg-slate-50 border-slate-400 text-slate-800 shadow-sm'
                        : d ? 'border-transparent wf-fg-muted wf-hover-bg' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium wf-fg">Theme Color</label>
              <div className="flex flex-wrap gap-2">
                {SKILL_COLORS.map(color => {
                  const cc = getSkillColorClasses(color, d);
                  return (
                    <button
                      key={color}
                      onClick={() => updateSkill({ color })}
                      className={`w-6 h-6 rounded-full ${cc.bg} transition-all ${editedSkill.color === color ? `ring-2 scale-110 ${d ? 'ring-white ring-offset-2 ring-offset-[#0d0d0f]' : 'ring-slate-900 ring-offset-2'}` : 'hover:scale-110'}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Right Section - Steps + optional AI chat */}
      <div className="flex-1 flex overflow-hidden">

      {/* Steps Builder */}
      <div className="flex-1 flex flex-col overflow-hidden wf-bg-sunken">

        {/* Steps Header */}
        <div className="h-14 px-6 border-b flex items-center justify-between shrink-0 wf-border wf-bg-elevated">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold wf-fg">Skill Steps</h3>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${d ? 'bg-white/[0.06] wf-fg-muted' : 'bg-slate-50 text-slate-600'}`}>{editedSkill.steps.length} steps</span>
          </div>

          {/* Add Step Buttons + AI Toggle */}
          <div className="flex items-center gap-2">
            {(Object.keys(STEP_TYPE_CONFIG) as SkillStepType[]).map(type => {
              const config = STEP_TYPE_CONFIG[type];
              const Icon = config.icon;
              return (
                <button
                  key={type}
                  onClick={() => addStep(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border wf-fg-muted ${
                    d ? 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                  title={config.description}
                >
                  <Icon className="w-3.5 h-3.5 wf-fg-faint" />
                  {config.label}
                </button>
              );
            })}
            <div className="w-px h-5 mx-1" style={{ background: 'var(--wf-border)' }} />
            <button
              onClick={() => { setShowAI(v => !v); setTimeout(() => chatInputRef.current?.focus(), 100); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                showAI
                  ? 'wf-surface-muted wf-fg'
                  : 'wf-card wf-card-interactive wf-fg-muted hover:wf-fg'
              }`}
              title="AI Assistant"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI
            </button>
          </div>
        </div>

        {/* Steps List */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          <div className="max-w-3xl mx-auto space-y-4">
            {editedSkill.steps.map((step, index) => {
              const config = STEP_TYPE_CONFIG[step.type];
              const StepIcon = config.icon;
              const stepColorClasses = getStepColorClasses(step.type, d);
              const selectedTool = AVAILABLE_TOOLS.find(t => t.id === step.toolName);
              
              return (
                <div
                  key={step.id}
                  draggable
                  onDragStart={() => setDraggedStepId(step.id)}
                  onDragEnd={() => setDraggedStepId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedStepId && draggedStepId !== step.id) {
                      const fromIdx = editedSkill.steps.findIndex(s => s.id === draggedStepId);
                      moveStep(fromIdx, index);
                    }
                  }}
                  className={`group relative rounded-lg border shadow-sm transition-all border-l-[3px] ${stepColorClasses.accent} ${
                    d ? 'bg-white/[0.04] border-white/[0.08]' : 'bg-white border-slate-200'
                  } ${draggedStepId === step.id ? 'opacity-50' : d ? 'hover:border-white/[0.14]' : 'hover:border-slate-300'}`}
                >
                  {/* Step Header */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 ${stepColorClasses.headerBg} border-b wf-border-subtle rounded-tr-lg rounded-tl-sm`}>
                    <div className="cursor-grab active:cursor-grabbing p-1 -ml-1 wf-fg-faint wf-hover-fg transition-colors">
                      <GripVertical className="w-4 h-4" />
                    </div>
                    
                    <div className="flex items-center justify-center w-5 h-5">
                      <StepIcon className={`w-4 h-4 ${stepColorClasses.iconText}`} />
                    </div>
                    
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs font-medium wf-fg-faint w-5 text-right">{index + 1}.</span>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(e) => updateStep(step.id, { label: e.target.value })}
                        className="bg-transparent font-medium text-sm wf-fg focus:outline-none w-full placeholder:wf-fg-faint"
                        placeholder="Step name..."
                      />
                    </div>
                    
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wider ${stepColorClasses.badge}`}>
                      {config.label}
                    </span>
                    
                    <button
                      onClick={() => deleteStep(step.id)}
                      className="p-1 wf-fg-faint hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  {/* Step Content */}
                  <div className="p-4 space-y-3">
                    {step.type === 'tool' && (
                      <div className="relative">
                        <label className="text-[10px] font-medium wf-fg-muted uppercase tracking-wider mb-1.5 block">Tool</label>
                        <button
                          onClick={() => setToolSearchOpen(toolSearchOpen === step.id ? null : step.id)}
                          className={`w-full px-3 py-2 rounded-md text-sm text-left flex items-center justify-between transition-colors focus:outline-none ${WF_INPUT}`}
                        >
                          {selectedTool ? (
                            <div className="flex items-center gap-2.5">
                              <selectedTool.icon className="w-4 h-4 wf-fg-faint" />
                              <span className="font-medium wf-fg">{selectedTool.name}</span>
                              <span className="wf-fg-faint text-xs hidden sm:inline truncate max-w-[200px]"> - {selectedTool.description}</span>
                            </div>
                          ) : (
                            <span className="wf-fg-faint">Select a tool...</span>
                          )}
                          <ChevronDown className={`w-4 h-4 wf-fg-faint transition-transform ${toolSearchOpen === step.id ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {/* Tool Dropdown */}
                        {toolSearchOpen === step.id && (
                          <div className={`absolute z-50 mt-1 w-full rounded-lg border shadow-lg max-h-[280px] overflow-hidden flex flex-col ${d ? 'bg-[#12141a] border-white/[0.1]' : 'bg-white border-slate-200'}`}>
                            <div className="p-2 border-b wf-border-subtle">
                              <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 wf-fg-faint" />
                                <input
                                  type="text"
                                  value={toolSearch}
                                  onChange={(e) => setToolSearch(e.target.value)}
                                  placeholder="Search tools..."
                                  className={`w-full pl-8 pr-3 py-1.5 rounded text-xs ${WF_INPUT}`}
                                  autoFocus
                                />
                              </div>
                            </div>
                            <div className="overflow-y-auto p-1.5 flex-1">
                              {TOOL_CATEGORIES.map(category => {
                                const categoryTools = filteredTools.filter(t => t.category === category);
                                if (categoryTools.length === 0) return null;
                                return (
                                  <div key={category} className="mb-1">
                                    <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider wf-fg-faint">{category}</p>
                                    {categoryTools.map(tool => (
                                      <button
                                        key={tool.id}
                                        onClick={() => {
                                          updateStep(step.id, { toolName: tool.id });
                                          setToolSearchOpen(null);
                                          setToolSearch("");
                                        }}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                                          step.toolName === tool.id
                                            ? d ? 'wf-accent-soft-bg wf-fg' : 'wf-accent-soft-bg wf-fg'
                                            : 'wf-fg-muted wf-hover-bg'
                                        }`}
                                      >
                                        <tool.icon className="w-3.5 h-3.5 wf-fg-faint shrink-0" />
                                        <span className="font-medium text-xs truncate">{tool.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div>
                      <label className="text-[10px] font-medium wf-fg-muted uppercase tracking-wider mb-1.5 block">
                        {step.type === 'prompt' ? 'Instructions' : step.type === 'condition' ? 'Condition Logic' : step.type === 'output' ? 'Output Format' : 'Description'}
                      </label>
                      <textarea
                        value={step.content}
                        onChange={(e) => updateStep(step.id, { content: e.target.value })}
                        rows={3}
                        className={`w-full px-3 py-2 rounded-md text-sm resize-none font-mono text-xs ${WF_INPUT}`}
                        placeholder={
                          step.type === 'prompt' ? 'Enter instructions for the AI to follow...' :
                          step.type === 'condition' ? 'Define when to branch (e.g., "If the user tone is formal...")' :
                          step.type === 'output' ? 'Describe the expected output format...' :
                          'Describe what this tool step should accomplish...'
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            
            {/* Empty State */}
            {editedSkill.steps.length === 0 && (
              <div className={`py-16 flex flex-col items-center justify-center text-center border-2 border-dashed rounded-xl ${
                d ? 'border-white/[0.1] bg-white/[0.02]' : 'border-slate-200 bg-white'
              }`}>
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 ${d ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                  <ListChecks className="w-6 h-6 wf-fg-faint" />
                </div>
                <h3 className="text-sm font-semibold wf-fg">No steps defined</h3>
                <p className="text-xs wf-fg-muted mt-1 max-w-sm">
                  Add steps from the toolbar above to define this skill's execution flow.
                </p>
              </div>
            )}
            
            {/* Connection Lines Visual */}
            {editedSkill.steps.length > 0 && (
              <div className="flex justify-center pt-2 pb-8">
                <div className={`w-px h-8 absolute mt-[-8px] ${d ? 'bg-white/[0.08]' : 'bg-slate-200'}`}></div>
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border shadow-sm mt-6 z-10 ${d ? 'bg-white/[0.04] border-white/[0.08]' : 'bg-white border-slate-200'}`}>
                  <Check className="w-3.5 h-3.5 wf-fg-faint" />
                  <span className="text-[11px] wf-fg-muted font-medium">End of Skill</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Chat Panel */}
      {showAI && (
        <div className="w-[360px] flex flex-col border-l wf-border-subtle overflow-hidden shrink-0 wf-bg-sunken">
          {/* Header */}
          <div className="h-14 px-4 flex items-center justify-between shrink-0 border-b wf-border-subtle wf-bg-overlay">
            <div className="flex items-center gap-2">
              <div>
                <h3 className="text-[13px] font-semibold wf-fg">Skill Architect</h3>
                <p className="text-[10px] wf-fg-muted">Describe your skill or ask for changes</p>
              </div>
            </div>
            <button
              onClick={() => setShowAI(false)}
              className="p-1.5 rounded-md wf-fg-faint wf-hover-fg wf-hover-bg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Chat History */}
          <ChatHistory
            messages={skillChat.messages}
            streamItems={skillChat.streamItems}
            reasoningText={skillChat.reasoningText}
            showReasoning={skillChat.showReasoning}
            setShowReasoning={skillChat.setShowReasoning}
            busy={skillChat.busy}
          />

          {/* Chat Input */}
          <div className="p-3 border-t wf-border-subtle">
            <ChatInput
              ref={chatInputRef}
              onSend={skillChat.sendMessage}
              busy={skillChat.busy}
              onStop={skillChat.stopGeneration}
              contextMetrics={skillContextMetrics}
              selectedModelId={skillChatModelId}
              onSelectModel={setSkillChatModelId}
              modelSource={modelSource}
              onModelSourceChange={setModelSource}
              reasoningLevel={skillReasoningLevel}
              onReasoningLevelChange={setSkillReasoningLevel}
            />
          </div>
        </div>
      )}

    </div>
  </div>
  );
}

// ============================================================================
// PUBLISH SKILL MODAL
// ============================================================================

interface PublishSkillModalProps {
  skill: Skill;
  onClose: () => void;
  onConfirm: (data: { name: string; shortDescription: string; description: string; category: string; tags: string[]; changelog?: string }) => Promise<{ ok: boolean; error?: string } | void>;
}

export function PublishSkillModal({ skill, onClose, onConfirm }: PublishSkillModalProps) {
  const { isDark: d } = useWorkflowTheme();
  const isUpdate = Boolean(skill.metadata?.marketplaceSlug && skill.metadata?.publishStatus === 'published');
  const currentVersion = (skill.metadata?.publishedVersion as string | undefined) || '1';
  const nextVersion = String((parseInt(currentVersion, 10) || 1) + 1);
  const [name, setName] = useState(skill.name);
  const [shortDescription, setShortDescription] = useState(skill.description.slice(0, 120));
  const [description, setDescription] = useState(skill.description);
  const [category, setCategory] = useState((skill.metadata?.publishedCategory as string | undefined) || 'skills');
  const [tagsRaw, setTagsRaw] = useState((skill.metadata?.publishedTags as string[] | undefined)?.join(', ') || '');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const IconComponent = SKILL_ICONS.find(i => i.name === skill.icon)?.icon || Wand2;
  const colorClasses = getSkillColorClasses(skill.color, d);

  const handlePublish = async () => {
    setBusy(true);
    setError(null);
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const result = await onConfirm({
        name: name.trim(),
        shortDescription: shortDescription.trim(),
        description: description.trim(),
        category,
        tags,
        changelog: isUpdate ? changelog.trim() || undefined : undefined,
      });
      if (result && result.ok === false) {
        setError(result.error || (isUpdate ? 'Failed to update' : 'Failed to publish'));
      } else {
        setDone(true);
        setTimeout(onClose, 1200);
      }
    } catch (e: any) {
      setError(e?.message || (isUpdate ? 'Failed to update' : 'Failed to publish'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 backdrop-blur-md flex items-center justify-center z-50 p-4"
      style={{ background: d ? 'rgba(2, 6, 23, 0.78)' : 'rgba(15, 23, 42, 0.18)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl border shadow-2xl w-[560px] max-w-[92vw] overflow-hidden"
        style={{ background: d ? '#1b1b1b' : '#ffffff', borderColor: 'var(--wf-border)', color: 'var(--wf-fg)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--wf-border)' }}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
              isUpdate
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'
                : 'bg-gradient-to-br from-[#ff5a5e] to-[#ff383c] shadow-rose-500/25'
            }`}>
              <Upload className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold wf-fg">
                {isUpdate ? 'Update Published Skill' : 'Publish Skill to Marketplace'}
              </h3>
              <p className="text-xs wf-fg-muted">
                {isUpdate
                  ? `Push a new version (v${currentVersion} → v${nextVersion}) to the community`
                  : 'Share this skill with the community'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors wf-fg-faint hover:wf-fg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Skill preview card */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${d ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-slate-50 border-slate-200'}`}>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses.bgSoft} border ${colorClasses.border}`}>
              <IconComponent className={`w-5 h-5 ${colorClasses.icon}`} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold wf-fg truncate">{skill.name}</div>
              <div className="text-xs wf-fg-muted">{skill.steps.length} steps · {skill.source === 'auto' ? 'Auto-generated' : 'Custom'}</div>
            </div>
          </div>

          {done ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <Check className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-sm font-semibold text-emerald-700">
                  {isUpdate ? `Updated to v${nextVersion}!` : 'Published successfully!'}
                </div>
                <p className="text-xs text-emerald-600">
                  {isUpdate
                    ? 'Your changes are now live for everyone who installed the skill.'
                    : 'Your skill is now live in the marketplace.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Form */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium wf-fg">Public Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-1 border"
                    style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium wf-fg">Short Description</label>
                  <input
                    type="text"
                    value={shortDescription}
                    onChange={(e) => setShortDescription(e.target.value.slice(0, 140))}
                    placeholder="One-line summary shown in marketplace cards"
                    className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-1 border"
                    style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                  />
                  <span className="text-[10px] wf-fg-faint">{shortDescription.length}/140</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium wf-fg">Full Description</label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 rounded-md text-sm resize-none focus:outline-none focus:ring-1 border"
                    style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium wf-fg">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-1 border"
                      style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                    >
                      <option value="skills">Skills</option>
                      <option value="productivity">Productivity</option>
                      <option value="research">Research</option>
                      <option value="writing">Writing</option>
                      <option value="coding">Coding</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium wf-fg">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={tagsRaw}
                      onChange={(e) => setTagsRaw(e.target.value)}
                      placeholder="e.g. summary, gmail"
                      className="w-full px-3 py-2 rounded-md text-sm focus:outline-none focus:ring-1 border"
                      style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                    />
                  </div>
                </div>
                {isUpdate && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium wf-fg flex items-center justify-between">
                      <span>Changelog <span className="wf-fg-faint">(optional)</span></span>
                      <span className="text-[10px] wf-fg-faint">v{currentVersion} → v{nextVersion}</span>
                    </label>
                    <textarea
                      rows={2}
                      value={changelog}
                      onChange={(e) => setChangelog(e.target.value)}
                      placeholder="What changed in this version?"
                      className="w-full px-3 py-2 rounded-md text-sm resize-none focus:outline-none focus:ring-1 border"
                      style={{ background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', color: 'var(--wf-fg)' }}
                    />
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 py-4 border-t flex items-center justify-end gap-3" style={{ borderColor: 'var(--wf-border)' }}>
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${d ? 'wf-fg-muted wf-hover-bg' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={busy || !name.trim()}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg ${
                isUpdate
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-[#ff5a5e] to-[#ff383c] hover:from-[#ff6b6f] hover:to-[#ff4a4e] shadow-rose-500/25'
              }`}
            >
              {busy ? <Wand2 className="w-4 h-4 animate-pulse" /> : <Upload className="w-4 h-4" />}
              {busy
                ? isUpdate ? 'Updating...' : 'Publishing...'
                : isUpdate ? `Update to v${nextVersion}` : 'Publish'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

