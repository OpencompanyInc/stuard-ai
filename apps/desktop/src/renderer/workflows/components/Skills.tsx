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
  BarChart, HardDrive, Cloud, Webhook, Type, ListChecks, Bot
} from "lucide-react";
import { TOOL_SCHEMAS, getCategories } from "../constants/tool-schemas";
import { ChatHistory } from "./chat/ChatHistory";
import { ChatInput, ChatInputRef } from "./chat/ChatInput";
import { useSkillChat } from "../hooks/useSkillChat";

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

interface SkillsLibraryProps {
  skills: Skill[];
  search: string;
  onSearchChange: (search: string) => void;
  onCreateSkill: () => void;
  onEditSkill: (skill: Skill) => void;
  onDeleteSkill: (id: string) => void;
  onToggleSkill: (id: string) => void;
}

export function SkillsLibrary({
  skills,
  search,
  onSearchChange,
  onCreateSkill,
  onEditSkill,
  onDeleteSkill,
  onToggleSkill,
}: SkillsLibraryProps) {
  const filteredSkills = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, search]);

  return (
    <>
      {/* Skills Info Bar */}
      <div className="px-8 pb-6 flex items-center gap-4">
        <div className="flex items-center gap-3 px-4 py-2 bg-white rounded-lg border border-slate-200 shadow-sm">
          <div className="flex items-center justify-center">
            <Brain className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm text-white font-medium">
              {skills.filter(s => s.isActive).length} active
            </span>
            <span className="text-xs text-slate-500">
              of {skills.length} skills
            </span>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          Skills define how Stuard responds to specific requests with structured steps.
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 px-8 pb-8 overflow-y-auto scrollbar-minimal">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-12">
          
          {/* Create Skill Card */}
          {!search && (
            <div 
              onClick={onCreateSkill}
              className="group relative h-[200px] rounded-xl cursor-pointer flex flex-col items-center justify-center transition-all border border-dashed border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50"
            >
              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center mb-3 shadow-sm group-hover:scale-105 transition-transform duration-200">
                <Plus className="w-5 h-5 text-slate-600" />
              </div>
              <span className="text-slate-700/80 font-medium text-sm">Create New Skill</span>
              <span className="text-slate-500 text-xs mt-1">Define a reusable behavior</span>
            </div>
          )}

          {/* Skill Cards */}
          {filteredSkills.map((skill) => {
            const IconComponent = SKILL_ICONS.find(i => i.name === skill.icon)?.icon || Wand2;
            const colorClasses = getSkillColorClasses(skill.color);
            
            return (
              <div
                key={skill.id}
                onClick={() => onEditSkill(skill)}
                className="group relative rounded-xl bg-white border border-slate-200 hover:border-slate-300 shadow-sm hover:shadow transition-all flex flex-col h-[200px] cursor-pointer overflow-hidden"
              >
                {/* Active indicator top border */}
                <div className={`absolute top-0 left-0 right-0 h-1 ${skill.isActive ? colorClasses.bg : 'bg-slate-200'}`} />
                
                <div className="p-4 flex flex-col flex-1 mt-1">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses.bgSoft} border ${colorClasses.border}`}>
                        <IconComponent className={`w-5 h-5 ${colorClasses.icon}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-sm">{skill.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-500">{skill.steps.length} steps</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Active Toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleSkill(skill.id); }}
                      className={`p-1 rounded-md transition-colors ${skill.isActive ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                      title={skill.isActive ? 'Active' : 'Inactive'}
                    >
                      {skill.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-3 flex-1">
                    {skill.description}
                  </p>

                  {/* Trigger Preview */}
                  <div className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 mb-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Trigger</span>
                    </div>
                    <p className="text-xs text-slate-700/80 line-clamp-1">{skill.trigger}</p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">
                      {skill.updatedAt ? `Updated ${formatRelativeTime(skill.updatedAt)}` : ''}
                    </span>
                    
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteSkill(skill.id); }}
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete Skill"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty state */}
          {filteredSkills.length === 0 && search && (
            <div className="col-span-full py-16 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-white shadow-sm rounded-lg flex items-center justify-center mb-4 border border-slate-200">
                <Search className="w-5 h-5 text-slate-400" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">No skills found</h3>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your search query</p>
            </div>
          )}
        </div>
      </div>
    </>
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
}

export function SkillEditor({ skill, onSave, onCancel, cloudAiHttp }: SkillEditorProps) {
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
    <div className="flex-1 flex bg-[#F4F4F5] h-screen w-screen overflow-hidden text-white font-sans">
      
      {/* Left Panel - Skill Settings */}
      <div className="w-[320px] flex flex-col bg-white border-r border-slate-200 overflow-hidden shrink-0 z-10">
        {/* Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-slate-800">
              {skill.id.startsWith('skill_') && skill.name === 'New Skill' ? 'Create Skill' : 'Skill Settings'}
            </h2>
          </div>
          <button
            onClick={() => onSave(editedSkill)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors text-xs font-medium"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>
        </div>

        {/* Settings Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
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
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-400"
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
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none placeholder-slate-400"
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
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none placeholder-slate-400 font-mono text-xs"
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
                    className={`p-2 rounded-md border transition-colors ${editedSkill.icon === name ? 'bg-slate-50 border-slate-400 text-white' : 'bg-white border-transparent text-slate-500 hover:bg-slate-50'}`}
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
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${step.toolName === tool.id ? 'bg-slate-50 text-white' : 'text-slate-700/80 hover:bg-slate-50'}`}
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
        <div className="w-[360px] flex flex-col border-l border-white/[0.06] overflow-hidden shrink-0" style={{ background: '#0f1117' }}>
          {/* Header */}
          <div className="h-14 px-4 flex items-center justify-between shrink-0 border-b border-white/[0.06]" style={{ background: 'rgba(0,0,0,0.2)' }}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-slate-800">Skill Architect</h3>
                <p className="text-[10px] text-slate-400">Describe your skill or ask for changes</p>
              </div>
            </div>
            <button
              onClick={() => setShowAI(false)}
              className="p-1.5 rounded-md text-white/30 hover:text-slate-900/60 hover:bg-slate-50 transition-colors"
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
            />
          </div>
        </div>
      )}

    </div>
  </div>
  );
}

