/**
 * Skills - Visual agent skills/routines system
 * Allows users to define reusable skill patterns for Stuard AI
 */
import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  Search, Plus, Trash2, Wand2, MessageSquare, Terminal, Eye, Brain,
  GripVertical, X, Save, ToggleLeft, ToggleRight, AlertCircle, Check,
  Zap, FileText, Settings, ChevronDown, Sparkles,
  Code, MousePointer, Image, Mail, Globe, Database, Mic, Video,
  FolderOpen, Play, Clock, ArrowRight, Cpu, Box, Layers, Send,
  BarChart, HardDrive, Cloud, Webhook, Type, ListChecks, Bot,
  CheckCheck, XCircle, Upload, Inbox, PowerOff, LayoutGrid
} from "lucide-react";
import { TOOL_SCHEMAS, getCategories } from "../constants/tool-schemas";
import { ChatHistory } from "./chat/ChatHistory";
import { ChatInput, ChatInputRef } from "./chat/ChatInput";
import { useSkillChat } from "../hooks/useSkillChat";
import { useModelRegistry } from "../../hooks/useModelRegistry";
import { buildContextUsageMetrics } from "../../utils/contextUsage";
import { useWorkflowTheme } from "../WorkflowThemeContext";

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
  ui: Sparkles,
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
    custom_ui: Sparkles,
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

export function getSkillColorClasses(color: string): { bg: string; icon: string; border: string; bgSoft: string; accent: string } {
  const colors: Record<string, { bg: string; icon: string; border: string; bgSoft: string; accent: string }> = {
    blue: { bg: 'bg-blue-600', icon: 'text-blue-600', border: 'border-blue-200', bgSoft: 'bg-blue-50', accent: 'border-blue-500' },
    purple: { bg: 'bg-purple-600', icon: 'text-purple-600', border: 'border-purple-200', bgSoft: 'bg-purple-50', accent: 'border-purple-500' },
    emerald: { bg: 'bg-emerald-600', icon: 'text-emerald-600', border: 'border-emerald-200', bgSoft: 'bg-emerald-50', accent: 'border-emerald-500' },
    amber: { bg: 'bg-amber-500', icon: 'text-amber-600', border: 'border-amber-200', bgSoft: 'bg-amber-50', accent: 'border-amber-500' },
    rose: { bg: 'bg-rose-600', icon: 'text-rose-600', border: 'border-rose-200', bgSoft: 'bg-rose-50', accent: 'border-rose-500' },
    cyan: { bg: 'bg-cyan-600', icon: 'text-cyan-600', border: 'border-cyan-200', bgSoft: 'bg-cyan-50', accent: 'border-cyan-500' },
    indigo: { bg: 'bg-indigo-600', icon: 'text-indigo-600', border: 'border-indigo-200', bgSoft: 'bg-indigo-50', accent: 'border-indigo-500' },
    teal: { bg: 'bg-teal-600', icon: 'text-teal-600', border: 'border-teal-200', bgSoft: 'bg-teal-50', accent: 'border-teal-500' },
  };
  return colors[color] || colors.blue;
}

function getStepColorClasses(type: SkillStepType) {
  const colors = {
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
    { id: 'suggested', label: 'Suggested',   count: buckets.pending.length,  icon: Sparkles,   description: 'Auto-detected skills awaiting your approval' },
    { id: 'inactive',  label: 'Inactive',    count: buckets.inactive.length, icon: PowerOff,   description: 'Skills you have toggled off' },
  ];

  return (
    <>
      {/* Tabs */}
      <div className="px-8 pb-3 shrink-0">
        <div className={`inline-flex p-1 rounded-xl border ${d ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-slate-100/70 border-slate-200'}`}>
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            const isPendingTab = t.id === 'suggested';
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? d
                      ? 'bg-white/[0.08] text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : d
                      ? 'text-white/55 hover:text-white/80'
                      : 'text-slate-500 hover:text-slate-800'
                }`}
                title={t.description}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? (isPendingTab ? 'text-violet-500' : '') : ''}`} />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span
                    className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold ${
                      isPendingTab
                        ? d ? 'bg-violet-500/20 text-violet-300' : 'bg-violet-100 text-violet-700'
                        : isActive
                          ? d ? 'bg-white/[0.12] text-white' : 'bg-slate-200 text-slate-700'
                          : d ? 'bg-white/[0.06] text-white/60' : 'bg-slate-200/80 text-slate-500'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
                {isPendingTab && t.count > 0 && !isActive && (
                  <span className={`w-1.5 h-1.5 rounded-full ${d ? 'bg-violet-400' : 'bg-violet-500'} animate-pulse`} />
                )}
              </button>
            );
          })}
        </div>
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
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
              d ? 'bg-violet-500/10 border-violet-500/25 hover:bg-violet-500/15' : 'bg-violet-50 border-violet-200 hover:bg-violet-100'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${d ? 'text-violet-400' : 'text-violet-500'}`} />
            <span className={`text-xs font-medium ${d ? 'text-violet-300' : 'text-violet-700'}`}>
              {buckets.pending.length} pending review
            </span>
            <ArrowRight className={`w-3 h-3 ${d ? 'text-violet-300' : 'text-violet-600'}`} />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">

          {/* Create Skill Card — only in All tab */}
          {tab === 'all' && !search && (
            <div
              onClick={onCreateSkill}
              className={`group relative h-[220px] rounded-xl cursor-pointer flex flex-col items-center justify-center transition-all border border-dashed ${
                d ? 'border-white/[0.12] hover:border-white/[0.2] bg-white/[0.02] hover:bg-white/[0.04]'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-full border flex items-center justify-center mb-3 shadow-sm group-hover:scale-105 transition-transform duration-200 ${
                d ? 'bg-white/[0.06] border-white/[0.08]' : 'bg-white border-slate-200'
              }`}>
                <Plus className="w-5 h-5 wf-fg-muted" />
              </div>
              <span className="font-medium text-sm wf-fg">Create New Skill</span>
              <span className="text-xs mt-1 wf-fg-muted">Define a reusable behavior</span>
            </div>
          )}

          {/* Skill Cards */}
          {filteredSkills.map((skill) => (
            <SkillCard
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

          {/* Empty States per tab */}
          {filteredSkills.length === 0 && (
            <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
              <div className={`w-14 h-14 shadow-sm rounded-full flex items-center justify-center mb-4 border ${
                tab === 'suggested'
                  ? d ? 'bg-violet-500/10 border-violet-500/20' : 'bg-violet-50 border-violet-200'
                  : 'wf-bg-elevated wf-border'
              }`}>
                {search ? (
                  <Search className="w-5 h-5 wf-fg-faint" />
                ) : tab === 'suggested' ? (
                  <Sparkles className={`w-5 h-5 ${d ? 'text-violet-400' : 'text-violet-500'}`} />
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
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create skill
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface SkillCardProps {
  skill: Skill;
  tab: SkillsTab;
  d: boolean;
  onEdit: (skill: Skill) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onApprove?: (skill: Skill) => void;
  onPublish?: (skill: Skill) => void;
}

function SkillCard({ skill, tab, d, onEdit, onDelete, onToggle, onApprove, onPublish }: SkillCardProps) {
  const IconComponent = SKILL_ICONS.find(i => i.name === skill.icon)?.icon || Wand2;
  const colorClasses = getSkillColorClasses(skill.color);
  const isPending = tab === 'suggested';

  return (
    <div
      onClick={() => onEdit(skill)}
      className={`group relative rounded-xl border shadow-sm hover:shadow transition-all flex flex-col h-[220px] cursor-pointer overflow-hidden ${
        isPending
          ? d ? 'bg-violet-500/[0.04] border-violet-500/[0.18] hover:border-violet-500/30' : 'bg-violet-50/40 border-violet-200 hover:border-violet-300'
          : d ? 'bg-white/[0.04] border-white/[0.06] hover:border-white/[0.12]' : 'bg-white border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className={`absolute top-0 left-0 right-0 h-1 ${
        isPending ? 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500'
          : skill.isActive ? colorClasses.bg : (d ? 'bg-white/[0.06]' : 'bg-slate-200')
      }`} />

      <div className="p-4 flex flex-col flex-1 mt-1">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses.bgSoft} border ${colorClasses.border} relative shrink-0`}>
              <IconComponent className={`w-5 h-5 ${colorClasses.icon}`} />
              {skill.source === 'auto' && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center ring-2 ring-white dark:ring-slate-900" title="Auto-generated">
                  <Sparkles className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm wf-fg truncate">{skill.name}</h3>
                {isPending ? (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${
                    d ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25' : 'bg-violet-100 text-violet-700 border border-violet-200'
                  }`}>
                    <Sparkles className="w-2.5 h-2.5" />
                    Pending
                  </span>
                ) : skill.source === 'auto' ? (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${
                    d ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20' : 'bg-violet-50 text-violet-600 border border-violet-200'
                  }`}>
                    <Sparkles className="w-2.5 h-2.5" />
                    Auto
                  </span>
                ) : null}
              </div>
              <span className="text-xs wf-fg-muted truncate block">
                {skill.steps.length} steps
                {skill.source === 'auto' && skill.metadata?.confidence != null && (
                  <> · {Math.round(skill.metadata.confidence * 100)}% confidence</>
                )}
              </span>
            </div>
          </div>
          {!isPending && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(skill.id); }}
              className={`p-1 rounded-md transition-colors shrink-0 ${skill.isActive ? 'text-emerald-500 hover:bg-emerald-500/10' : 'wf-fg-faint hover:bg-white/10'}`}
              title={skill.isActive ? 'Active' : 'Inactive'}
            >
              {skill.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
            </button>
          )}
        </div>

        <p className="text-xs line-clamp-2 leading-relaxed mb-3 flex-1 wf-fg-muted">{skill.description}</p>

        <div className={`px-3 py-2 rounded-lg border mb-3 ${d ? 'bg-white/[0.03] border-white/[0.06]' : 'bg-slate-50 border-slate-100'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3 h-3 wf-fg-faint" />
            <span className="text-[10px] font-medium uppercase tracking-wider wf-fg-faint">Trigger</span>
          </div>
          <p className="text-xs line-clamp-1 wf-fg-muted">{skill.trigger}</p>
        </div>

        {/* Footer / Actions */}
        {isPending ? (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onApprove?.(skill); }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-sm"
              title="Approve and add to library"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(skill); }}
              className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                d ? 'bg-white/[0.05] text-white/75 hover:bg-white/[0.08]' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
              title="Edit before approving"
            >
              <FileText className="w-3.5 h-3.5" />
              Review
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(skill.id); }}
              className={`inline-flex items-center justify-center p-1.5 rounded-md transition-colors ${
                d ? 'text-white/45 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
              }`}
              title="Dismiss"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] wf-fg-faint truncate">
              {skill.source === 'auto' ? (
                <>Learned {skill.metadata?.generatedAt ? formatRelativeTime(skill.metadata.generatedAt) : formatRelativeTime(skill.createdAt)}</>
              ) : (
                skill.updatedAt ? `Updated ${formatRelativeTime(skill.updatedAt)}` : ''
              )}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {onPublish && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPublish(skill); }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                    d ? 'text-blue-300 hover:text-blue-200 hover:bg-blue-500/10' : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                  }`}
                  title="Publish to Marketplace"
                >
                  <Upload className="w-3 h-3" />
                  Publish
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(skill.id); }}
                className={`p-1 rounded transition-colors ${d ? 'text-white/40 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}
                title="Delete Skill"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
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
  const [editedSkill, setEditedSkill] = useState<Skill>(skill);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [toolSearchOpen, setToolSearchOpen] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState("");
  const [showAI, setShowAI] = useState(false);
  const chatInputRef = useRef<ChatInputRef>(null);

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
  });
  const { modelById } = useModelRegistry();
  const skillContextMetrics = useMemo(() => buildContextUsageMetrics({
    usage: skillChat.latestUsage,
    modelId: skillChat.latestModelId,
    modelById,
  }), [modelById, skillChat.latestModelId, skillChat.latestUsage]);

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
  const colorClasses = getSkillColorClasses(editedSkill.color);

  return (
    <div className="flex-1 flex h-screen w-screen overflow-hidden font-sans wf-bg wf-fg">

      {/* Left Panel - Skill Settings */}
      <div className="w-[320px] flex flex-col border-r overflow-hidden shrink-0 z-10 wf-bg-elevated wf-border">
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-slate-800">
              {skill.id.startsWith('skill_') && skill.name === 'New Skill' ? 'Create Skill' : skill.source === 'auto' ? 'Auto-Skill Settings' : 'Skill Settings'}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {onPublish && (
              <button
                onClick={() => onPublish(editedSkill)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-md hover:bg-blue-50 transition-colors text-xs font-medium"
                title="Publish to Marketplace"
              >
                <Upload className="w-3.5 h-3.5" />
                Publish
              </button>
            )}
            <button
              onClick={() => onSave(editedSkill)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors text-xs font-medium"
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
            <div className="p-3 rounded-lg bg-violet-50 border border-violet-200 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-violet-700">Auto-Generated Skill</span>
                  <p className="text-[10px] text-violet-500">Learned from conversation patterns</p>
                </div>
              </div>
              {editedSkill.metadata?.confidence != null && (
                <div className="flex items-center gap-3 text-[10px] text-violet-600">
                  <span>Confidence: <strong>{Math.round(editedSkill.metadata.confidence * 100)}%</strong></span>
                  {editedSkill.metadata.generatedAt && (
                    <span>Detected: {formatRelativeTime(editedSkill.metadata.generatedAt)}</span>
                  )}
                </div>
              )}
              {editedSkill.metadata?.antiPatterns && editedSkill.metadata.antiPatterns.length > 0 && (
                <div className="pt-1 border-t border-violet-200">
                  <span className="text-[10px] font-medium text-violet-600 flex items-center gap-1 mb-1">
                    <AlertCircle className="w-3 h-3" /> Mistakes to avoid
                  </span>
                  <ul className="space-y-0.5">
                    {editedSkill.metadata.antiPatterns.slice(0, 3).map((ap: string, i: number) => (
                      <li key={i} className="text-[10px] text-violet-500 pl-3">· {ap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${editedSkill.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="text-sm font-medium text-slate-700/80">Skill Active</span>
            </div>
            <button
              onClick={() => updateSkill({ isActive: !editedSkill.isActive })}
              className={`transition-colors ${editedSkill.isActive ? 'text-emerald-600' : 'text-slate-400'}`}
            >
              {editedSkill.isActive ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
            </button>
          </div>
          
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700/80">Name</label>
            <input
              type="text"
              value={editedSkill.name}
              onChange={(e) => updateSkill({ name: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-400"
              placeholder="e.g., Code Reviewer"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700/80">Description</label>
            <textarea
              value={editedSkill.description}
              onChange={(e) => updateSkill({ description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none placeholder-slate-400"
              placeholder="What does this skill do..."
            />
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700/80">Trigger</label>
            </div>
            <textarea
              value={editedSkill.trigger}
              onChange={(e) => updateSkill({ trigger: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none placeholder-slate-400 font-mono text-xs"
              placeholder="When the user asks to..."
            />
            <p className="text-[10px] text-slate-500">Natural language trigger instruction for the orchestrator agent.</p>
          </div>

          {/* Icon & Color Picker */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700/80">Icon</label>
              <div className="flex flex-wrap gap-1.5">
                {SKILL_ICONS.map(({ name, icon: Icon }) => (
                  <button
                    key={name}
                    onClick={() => updateSkill({ icon: name })}
                    className={`p-2 rounded-md border transition-colors ${editedSkill.icon === name ? 'bg-slate-50 border-slate-400 text-slate-800 shadow-sm' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50'}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700/80">Theme Color</label>
              <div className="flex flex-wrap gap-2">
                {SKILL_COLORS.map(color => {
                  const cc = getSkillColorClasses(color);
                  return (
                    <button
                      key={color}
                      onClick={() => updateSkill({ color })}
                      className={`w-6 h-6 rounded-full ${cc.bg} transition-all ${editedSkill.color === color ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'hover:scale-110'}`}
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
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">

        {/* Steps Header */}
        <div className="h-14 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-800">Skill Steps</h3>
            <span className="px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-xs font-medium">{editedSkill.steps.length} steps</span>
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-white border border-slate-200 hover:bg-slate-50 text-slate-700/80`}
                  title={config.description}
                >
                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                  {config.label}
                </button>
              );
            })}
            <div className="w-px h-5 bg-slate-200 mx-1" />
            <button
              onClick={() => { setShowAI(v => !v); setTimeout(() => chatInputRef.current?.focus(), 100); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                showAI
                  ? 'bg-indigo-600 text-white border border-indigo-700 shadow-sm'
                  : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-700/80'
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
              const stepColorClasses = getStepColorClasses(step.type);
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
                  className={`group relative bg-white rounded-lg border border-slate-200 shadow-sm transition-all ${
                    draggedStepId === step.id ? 'opacity-50' : 'hover:border-slate-300'
                  } border-l-[3px] ${stepColorClasses.accent}`}
                >
                  {/* Step Header */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 ${stepColorClasses.headerBg} border-b border-slate-100 rounded-tr-lg rounded-tl-sm`}>
                    <div className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-slate-400 hover:text-slate-600 transition-colors">
                      <GripVertical className="w-4 h-4" />
                    </div>
                    
                    <div className="flex items-center justify-center w-5 h-5">
                      <StepIcon className={`w-4 h-4 ${stepColorClasses.iconText}`} />
                    </div>
                    
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-400 w-5 text-right">{index + 1}.</span>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(e) => updateStep(step.id, { label: e.target.value })}
                        className="bg-transparent font-medium text-sm text-slate-800 focus:outline-none w-full placeholder-slate-400"
                        placeholder="Step name..."
                      />
                    </div>
                    
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wider ${stepColorClasses.badge}`}>
                      {config.label}
                    </span>
                    
                    <button
                      onClick={() => deleteStep(step.id)}
                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  {/* Step Content */}
                  <div className="p-4 space-y-3">
                    {step.type === 'tool' && (
                      <div className="relative">
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">Tool</label>
                        <button
                          onClick={() => setToolSearchOpen(toolSearchOpen === step.id ? null : step.id)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors focus:outline-none focus:ring-1 focus:ring-slate-300"
                        >
                          {selectedTool ? (
                            <div className="flex items-center gap-2.5">
                              <selectedTool.icon className="w-4 h-4 text-slate-500" />
                              <span className="font-medium text-slate-700/80">{selectedTool.name}</span>
                              <span className="text-slate-400 text-xs hidden sm:inline truncate max-w-[200px]"> - {selectedTool.description}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">Select a tool...</span>
                          )}
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${toolSearchOpen === step.id ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {/* Tool Dropdown */}
                        {toolSearchOpen === step.id && (
                          <div className="absolute z-50 mt-1 w-full bg-white rounded-lg border border-slate-200 shadow-lg max-h-[280px] overflow-hidden flex flex-col">
                            <div className="p-2 border-b border-slate-100">
                              <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <input
                                  type="text"
                                  value={toolSearch}
                                  onChange={(e) => setToolSearch(e.target.value)}
                                  placeholder="Search tools..."
                                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:outline-none focus:border-slate-300"
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
                                    <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">{category}</p>
                                    {categoryTools.map(tool => (
                                      <button
                                        key={tool.id}
                                        onClick={() => {
                                          updateStep(step.id, { toolName: tool.id });
                                          setToolSearchOpen(null);
                                          setToolSearch("");
                                        }}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${step.toolName === tool.id ? 'bg-indigo-50 text-slate-900' : 'text-slate-700/80 hover:bg-slate-50'}`}
                                      >
                                        <tool.icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
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
                      <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1.5 block">
                        {step.type === 'prompt' ? 'Instructions' : step.type === 'condition' ? 'Condition Logic' : step.type === 'output' ? 'Output Format' : 'Description'}
                      </label>
                      <textarea
                        value={step.content}
                        onChange={(e) => updateStep(step.id, { content: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-md text-sm text-slate-800 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400 resize-none font-mono text-xs"
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
              <div className="py-16 flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl bg-white">
                <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-3">
                  <ListChecks className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-700/80">No steps defined</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Add steps from the toolbar above to define this skill's execution flow.
                </p>
              </div>
            )}
            
            {/* Connection Lines Visual */}
            {editedSkill.steps.length > 0 && (
              <div className="flex justify-center pt-2 pb-8">
                <div className="w-px h-8 bg-slate-200 absolute mt-[-8px]"></div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-white rounded-full border border-slate-200 shadow-sm mt-6 z-10">
                  <Check className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[11px] text-slate-500 font-medium">End of Skill</span>
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
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-indigo-400" />
              </div>
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
          <div className="p-3 border-t border-white/[0.06]">
            <ChatInput
              ref={chatInputRef}
              onSend={skillChat.sendMessage}
              busy={skillChat.busy}
              onStop={skillChat.stopGeneration}
              contextMetrics={skillContextMetrics}
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
  onConfirm: (data: { name: string; shortDescription: string; description: string; category: string; tags: string[] }) => Promise<{ ok: boolean; error?: string } | void>;
}

export function PublishSkillModal({ skill, onClose, onConfirm }: PublishSkillModalProps) {
  const { isDark: d } = useWorkflowTheme();
  const [name, setName] = useState(skill.name);
  const [shortDescription, setShortDescription] = useState(skill.description.slice(0, 120));
  const [description, setDescription] = useState(skill.description);
  const [category, setCategory] = useState('skills');
  const [tagsRaw, setTagsRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const IconComponent = SKILL_ICONS.find(i => i.name === skill.icon)?.icon || Wand2;
  const colorClasses = getSkillColorClasses(skill.color);

  const handlePublish = async () => {
    setBusy(true);
    setError(null);
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const result = await onConfirm({ name: name.trim(), shortDescription: shortDescription.trim(), description: description.trim(), category, tags });
      if (result && result.ok === false) {
        setError(result.error || 'Failed to publish');
      } else {
        setDone(true);
        setTimeout(onClose, 1200);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to publish');
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
        style={{ background: d ? '#0f1117' : '#ffffff', borderColor: 'var(--wf-border)', color: 'var(--wf-fg)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--wf-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Upload className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold wf-fg">Publish Skill to Marketplace</h3>
              <p className="text-xs wf-fg-muted">Share this skill with the community</p>
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
                <div className="text-sm font-semibold text-emerald-700">Published successfully!</div>
                <p className="text-xs text-emerald-600">Your skill is now live in the marketplace.</p>
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
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${d ? 'text-white/70 hover:bg-white/[0.06]' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-violet-600 hover:from-blue-600 hover:to-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {busy ? <Wand2 className="w-4 h-4 animate-pulse" /> : <Upload className="w-4 h-4" />}
              {busy ? 'Publishing...' : 'Publish'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

