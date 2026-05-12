/**
 * Skill Agent - Specialized agent for designing and modifying skills
 *
 * Mirrors the workflow agent pattern: uses a modify_skill tool to
 * apply structured changes to skills, emitting tool_event for real-time UI updates.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildProviderModel } from '../utils/models';
import { writeLog } from '../utils/logger';
import { safeToolWrite, getBridgeState, setBridgeState } from '../tools/bridge';
import { search_tools } from '../tools/meta-tools';
import { retrieveToolFormat } from '../tools/workflow-system';
import { web_search } from '../tools/perplexity-tools';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION SKILL STORAGE
// Uses AsyncLocalStorage (via bridge state) for per-request isolation to prevent
// cross-tab bleeding when concurrent requests share the same server process.
// ═══════════════════════════════════════════════════════════════════════════════

const _SKILL_BRIDGE_KEY = '__sessionSkill';
let _sessionSkillFallback: any | null = null;

export function setSessionSkill(skill: any): void {
    if (skill && typeof skill === 'object') {
        const cloned = JSON.parse(JSON.stringify(skill));
        // Per-request isolation via AsyncLocalStorage
        setBridgeState(_SKILL_BRIDGE_KEY, cloned);
        // Module-level fallback for non-request contexts
        _sessionSkillFallback = cloned;
        log('session_skill_set', { id: cloned?.id, name: cloned?.name });
    }
}

export function getSessionSkill(): any | null {
    // Prefer ALS (per-request isolation) to prevent cross-tab bleeding
    const alsSkill = getBridgeState(_SKILL_BRIDGE_KEY);
    if (alsSkill) return alsSkill;
    // Fallback to module-level for non-request contexts
    return _sessionSkillFallback;
}

export function clearSessionSkill(): void {
    setBridgeState(_SKILL_BRIDGE_KEY, null);
    _sessionSkillFallback = null;
}

function log(event: string, data?: any) {
    console.log(`[skill-agent] ${event}`, data ? JSON.stringify(data) : '');
    writeLog('skill_agent_' + event, data);
}

function genStepId(): string {
    return `s${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODIFY_SKILL TOOL
// ═══════════════════════════════════════════════════════════════════════════════

export const modifySkillTool = createTool({
    id: 'modify_skill',
    description: `Modify the current skill. The skill is automatically loaded from session context.

DO NOT pass the full skill JSON - just pass the operation and parameters.

OPERATIONS:

SET_SKILL - Replace the entire skill definition (use for new skills or full rewrites)
  { op: "set_skill", skill: { name, description, trigger, icon, color, steps: [...] } }

ADD_STEP - Add a new step to the skill
  { op: "add_step", step: { type: "prompt", label: "Step Name", content: "Instructions..." } }
  { op: "add_step", step: { type: "tool", label: "Search Web", content: "Search for info", toolName: "web_search" }, afterStepId: "s1" }

UPDATE_STEP - Update an existing step
  { op: "update_step", stepId: "s1", updates: { label: "New Label", content: "New content" } }

REMOVE_STEP - Delete a step
  { op: "remove_step", stepId: "s1" }

REORDER_STEPS - Move a step to a new position
  { op: "reorder_steps", stepId: "s1", newIndex: 2 }

UPDATE_METADATA - Update skill settings (name, description, trigger, icon, color, isActive)
  { op: "update_metadata", updates: { name: "New Name", description: "New desc" } }
  { op: "update_metadata", updates: { isActive: false } }`,

    inputSchema: z.object({
        op: z.enum([
            'set_skill', 'add_step', 'update_step', 'remove_step',
            'reorder_steps', 'update_metadata'
        ]).describe('Operation to perform'),

        // set_skill
        skill: z.any().optional().describe('Full skill object for set_skill operation'),

        // add_step
        step: z.any().optional().describe('Step object for add_step: { type, label, content, toolName? }'),
        afterStepId: z.string().optional().describe('Insert after this step ID (add_step). If omitted, appends to end.'),

        // update_step
        stepId: z.string().optional().describe('Step ID for update_step, remove_step, reorder_steps'),
        updates: z.any().optional().describe('Fields to update for update_step or update_metadata'),

        // reorder_steps
        newIndex: z.number().optional().describe('New position index for reorder_steps (0-based)'),
    }).partial().required({ op: true }),

    outputSchema: z.object({
        ok: z.boolean(),
        skill: z.any().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
    }),

    execute: async (inputData, { writer }) => {
        const ctx = inputData as any;
        const { op } = ctx;

        // Get current skill from session (per-request isolated via ALS)
        const currentSkill = getSessionSkill();
        let skill = currentSkill ? JSON.parse(JSON.stringify(currentSkill)) : null;

        if (!skill && op !== 'set_skill') {
            return { ok: false, error: 'No skill loaded in session. Use set_skill to create a new skill first.' };
        }

        log('start', { op, skillId: skill?.id });

        try {
            let message = '';

            switch (op) {
                // ==================================================================
                // SET_SKILL - Full replace
                // ==================================================================
                case 'set_skill': {
                    const newSkill = ctx.skill;
                    if (!newSkill || typeof newSkill !== 'object') {
                        return { ok: false, error: 'skill object is required for set_skill' };
                    }

                    // Ensure all steps have IDs
                    if (Array.isArray(newSkill.steps)) {
                        newSkill.steps = newSkill.steps.map((s: any, i: number) => ({
                            ...s,
                            id: s.id || genStepId(),
                        }));
                    }

                    // Preserve existing metadata if not provided
                    skill = {
                        id: skill?.id || newSkill.id || '',
                        name: newSkill.name || skill?.name || 'Untitled Skill',
                        description: newSkill.description || skill?.description || '',
                        icon: newSkill.icon || skill?.icon || 'Wand2',
                        color: newSkill.color || skill?.color || 'blue',
                        trigger: newSkill.trigger || skill?.trigger || '',
                        steps: newSkill.steps || [],
                        isActive: newSkill.isActive ?? skill?.isActive ?? true,
                        createdAt: skill?.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };

                    message = `Set skill "${skill.name}" with ${skill.steps.length} steps`;
                    break;
                }

                // ==================================================================
                // ADD_STEP
                // ==================================================================
                case 'add_step': {
                    const newStep = ctx.step;
                    if (!newStep || typeof newStep !== 'object') {
                        return { ok: false, error: 'step object is required for add_step' };
                    }

                    const step = {
                        id: newStep.id || genStepId(),
                        type: newStep.type || 'prompt',
                        label: newStep.label || newStep.type || 'New Step',
                        content: newStep.content || '',
                        ...(newStep.toolName ? { toolName: newStep.toolName } : {}),
                    };

                    if (!Array.isArray(skill.steps)) skill.steps = [];

                    if (ctx.afterStepId) {
                        const idx = skill.steps.findIndex((s: any) => s.id === ctx.afterStepId);
                        if (idx >= 0) {
                            skill.steps.splice(idx + 1, 0, step);
                            message = `Added step "${step.label}" after "${skill.steps[idx].label}"`;
                        } else {
                            skill.steps.push(step);
                            message = `Added step "${step.label}" at end (afterStepId not found)`;
                        }
                    } else {
                        skill.steps.push(step);
                        message = `Added step "${step.label}"`;
                    }

                    skill.updatedAt = new Date().toISOString();
                    break;
                }

                // ==================================================================
                // UPDATE_STEP
                // ==================================================================
                case 'update_step': {
                    const { stepId, updates } = ctx;
                    if (!stepId) return { ok: false, error: 'stepId is required for update_step' };
                    if (!updates || typeof updates !== 'object') {
                        return { ok: false, error: 'updates object is required for update_step' };
                    }

                    const idx = skill.steps.findIndex((s: any) => s.id === stepId);
                    if (idx < 0) return { ok: false, error: `Step not found: ${stepId}` };

                    const existingStep = skill.steps[idx];
                    skill.steps[idx] = { ...existingStep, ...updates, id: stepId };
                    skill.updatedAt = new Date().toISOString();

                    message = `Updated step "${skill.steps[idx].label}"`;
                    break;
                }

                // ==================================================================
                // REMOVE_STEP
                // ==================================================================
                case 'remove_step': {
                    const { stepId } = ctx;
                    if (!stepId) return { ok: false, error: 'stepId is required for remove_step' };

                    const idx = skill.steps.findIndex((s: any) => s.id === stepId);
                    if (idx < 0) return { ok: false, error: `Step not found: ${stepId}` };

                    const removed = skill.steps.splice(idx, 1)[0];
                    skill.updatedAt = new Date().toISOString();

                    message = `Removed step "${removed.label}"`;
                    break;
                }

                // ==================================================================
                // REORDER_STEPS
                // ==================================================================
                case 'reorder_steps': {
                    const { stepId, newIndex } = ctx;
                    if (!stepId) return { ok: false, error: 'stepId is required for reorder_steps' };
                    if (typeof newIndex !== 'number') return { ok: false, error: 'newIndex is required for reorder_steps' };

                    const idx = skill.steps.findIndex((s: any) => s.id === stepId);
                    if (idx < 0) return { ok: false, error: `Step not found: ${stepId}` };

                    const [step] = skill.steps.splice(idx, 1);
                    const clampedIndex = Math.max(0, Math.min(newIndex, skill.steps.length));
                    skill.steps.splice(clampedIndex, 0, step);
                    skill.updatedAt = new Date().toISOString();

                    message = `Moved step "${step.label}" to position ${clampedIndex + 1}`;
                    break;
                }

                // ==================================================================
                // UPDATE_METADATA
                // ==================================================================
                case 'update_metadata': {
                    const { updates } = ctx;
                    if (!updates || typeof updates !== 'object') {
                        return { ok: false, error: 'updates object is required for update_metadata' };
                    }

                    const allowedFields = ['name', 'description', 'trigger', 'icon', 'color', 'isActive'];
                    for (const field of allowedFields) {
                        if (updates[field] !== undefined) {
                            skill[field] = updates[field];
                        }
                    }
                    skill.updatedAt = new Date().toISOString();

                    message = `Updated skill metadata: ${Object.keys(updates).filter(k => allowedFields.includes(k)).join(', ')}`;
                    break;
                }

                default:
                    return { ok: false, error: `Unknown operation: ${op}` };
            }

            // Store in session (per-request via ALS + fallback)
            setBridgeState(_SKILL_BRIDGE_KEY, skill);
            _sessionSkillFallback = skill;

            const result = { ok: true as const, skill, message };

            log('success', { skillId: skill.id, message });

            // Emit tool_event for immediate UI update (mirrors modify_workflow pattern)
            await safeToolWrite(writer as any, {
                type: 'tool_event',
                tool: 'modify_skill',
                status: 'completed',
                skillId: skill.id,
                result,
            });

            return result;

        } catch (err: any) {
            log('error', { error: err.message, op });
            return { ok: false, error: err.message };
        }
    },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

export const SKILL_SYSTEM_PROMPT = `You are the Skill Architect for StuardAI.

You design and modify skills. The user provides the current skill definition — you modify it using modify_skill.

CRITICAL BEHAVIOR:
- If user asks to create/update/reorder/delete/change steps, you MUST call modify_skill.
- Do NOT reply with only advice when a concrete change is requested.
- Keep skills fully editable in Skills Studio (same fields user can edit manually).
- Preserve existing skill fields unless user explicitly asks to change them.

═══════════════════════════════════════════════════════════════════════════════
WHAT IS A SKILL?
═══════════════════════════════════════════════════════════════════════════════

A Skill is a reusable recipe that the AI assistant follows. Each skill has:
- name: Display name
- description: What the skill does
- trigger: When/how this skill activates (e.g., "When the user asks to summarize...")
- icon: Lucide icon name (e.g., "Wand2", "Brain", "Search", "FileText")
- color: Color theme (blue, green, red, purple, orange, yellow, pink, cyan, indigo)
- steps: Ordered list of steps the AI follows

═══════════════════════════════════════════════════════════════════════════════
STEP TYPES
═══════════════════════════════════════════════════════════════════════════════

Each step has: { id, type, label, content, toolName? }

STEP TYPES:
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ Type         │ Description                                                  │
├──────────────┼──────────────────────────────────────────────────────────────┤
│ prompt       │ Instructions/system prompt for the AI to follow               │
│ tool         │ Execute a specific tool (requires toolName field)             │
│ condition    │ Conditional logic / branching decision                        │
│ output       │ Define expected output format or final response               │
└──────────────┴──────────────────────────────────────────────────────────────┘

STEP FIELDS:
- id: Unique identifier (auto-generated if not provided, e.g. "s1", "s2")
- type: One of the types above
- label: Human-readable name for this step
- content: Instructions, prompt text, or description of what to do
- toolName: (tool type only) Name of the tool to execute

MANUAL SKILLS STUDIO PARITY (what you can edit via modify_skill):
- Skill settings: name, description, trigger, icon, color, isActive
- Steps: add, update (type/label/content/toolName), remove, reorder
- Full regeneration: replace entire step list via set_skill when user asks for a full rewrite

═══════════════════════════════════════════════════════════════════════════════
COMMONLY USED TOOLS
═══════════════════════════════════════════════════════════════════════════════

When creating tool steps, use these tool names:

SEARCH & DATA:
  web_search, http_request, memory_retrieval

AI & ANALYSIS:
  ai_inference, analyze_image, analyze_media, analyze_current_screen, cloud_ai_vision

FILES & SYSTEM:
  read_file, write_file, list_directory, run_command, run_python_script, run_node_script, glob, grep

COMMUNICATION:
  gmail_send_message, send_notification, text_to_speech, telnyx_send_sms

MEDIA:
  take_screenshot, capture_media, play_audio, ffmpeg_convert_media

GOOGLE:
  calendar_list_events, calendar_create_event, sheets_create_spreadsheet, sheets_read_range, docs_create_document, docs_get_document

DATABASE:
  db_store, db_retrieve, db_search, db_query

UI:
  custom_ui, ask_confirmation, show_choices

Use search_tools to find tools not listed here. Use get_tool_schema to get exact argument formats.

═══════════════════════════════════════════════════════════════════════════════
ICON OPTIONS (Lucide icons)
═══════════════════════════════════════════════════════════════════════════════

Common icons: Wand2, Brain, Search, FileText, Mail, Calendar, Globe, Code,
Terminal, Database, Image, Video, Music, MessageSquare, Send, Download, Upload,
Settings, Shield, Zap, Star, Heart, BookOpen, Clipboard, Clock, Camera, Eye,
Mic, Speaker, Wifi, Cloud, Lock, Key, Users, User, Bot, Sparkles, Lightbulb,
PenTool, Layers, GitBranch, Package, Rocket, Target, Award, BarChart, PieChart

═══════════════════════════════════════════════════════════════════════════════
YOUR TOOLS
═══════════════════════════════════════════════════════════════════════════════

1. modify_skill({ op, ...params }) - Modify the current skill
2. search_tools({ query }) - Find tools by keyword
3. get_tool_schema({ toolName }) - Get exact tool argument format
4. web_search({ query }) - Search the web

CRITICAL: Use modify_skill for ALL skill changes. NEVER output raw JSON.

EXAMPLE - Creating a "Summarize Article" skill:
  modify_skill({ op: "set_skill", skill: {
    name: "Summarize Article",
    description: "Summarize any article or web page",
    trigger: "When the user wants to summarize an article or URL",
    icon: "FileText",
    color: "blue",
    steps: [
      { type: "prompt", label: "Understand Request", content: "Identify the URL or text the user wants summarized" },
      { type: "tool", label: "Fetch Content", content: "Fetch the article content from the URL", toolName: "http_request" },
      { type: "prompt", label: "Analyze", content: "Read through the content and identify key points, main arguments, and conclusions" },
      { type: "output", label: "Summary", content: "Provide a clear, concise summary with: 1) Main topic, 2) Key points (bulleted), 3) Conclusion" }
    ]
  }})

EXAMPLE - Adding a step:
  modify_skill({ op: "add_step", step: { type: "tool", label: "Search Web", content: "Search for additional context", toolName: "web_search" }, afterStepId: "s1" })

EXAMPLE - Updating metadata:
  modify_skill({ op: "update_metadata", updates: { name: "Better Name", icon: "Brain" } })

EXAMPLE - Toggle active status:
  modify_skill({ op: "update_metadata", updates: { isActive: false } })`;

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function skillAgentLog(event: string, data?: Record<string, any>) {
    const msg = data ? `[skill-agent] ${event}: ${JSON.stringify(data)}` : `[skill-agent] ${event}`;
    console.log(msg);
    writeLog(`skill_agent_${event}`, data);
}

export function getSkillAgent(modelIdOverride?: string): Agent {
    const modelId =
        (typeof modelIdOverride === 'string' && modelIdOverride.trim())
            ? modelIdOverride.trim()
            : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');

    const provider = String(modelId.split('/')[0] || '').toLowerCase();

    if (provider === 'google' && !GOOGLE_API_KEY) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is required for google skill models');
    }
    if (provider === 'openai' && !OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for openai skill models');
    }
    if (provider === 'xai' && !XAI_API_KEY) {
        throw new Error('XAI_API_KEY is required for xai skill models');
    }
    if (provider === 'deepseek' && !DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY is required for deepseek skill models');
    }
    if (provider === 'perplexity' && !PERPLEXITY_API_KEY) {
        throw new Error('PERPLEXITY_API_KEY is required for perplexity skill models');
    }

    const model = buildProviderModel(modelId);
    if (!model) {
        throw new Error(`Unsupported skill modelId: ${modelId}`);
    }

    skillAgentLog('init', { model: modelId });

    // Create logging wrappers for tools
    const createLoggedTool = (tool: any, name: string) => ({
        ...tool,
        execute: async (args: any, runCtx?: any) => {
            console.log(`[skill-agent] Tool call: ${name}`, JSON.stringify(args, null, 2));
            try {
                const result = await tool.execute(args, runCtx);
                console.log(`[skill-agent] Tool result: ${name}`, JSON.stringify(result, null, 2));
                return result;
            } catch (error) {
                console.error(`[skill-agent] Tool error: ${name}`, error);
                throw error;
            }
        }
    });

    const tools = {
        modify_skill: createLoggedTool(modifySkillTool, 'modify_skill'),
        search_tools: createLoggedTool(search_tools, 'search_tools'),
        get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
        web_search: createLoggedTool(web_search, 'web_search'),
    };

    // Determine if we should use thinking mode
    const useThinking = provider === 'google' && modelId.includes('gemini-3');

    const agent = new Agent({
        id: 'skill-architect',
        name: 'skill-architect',
        instructions: SKILL_SYSTEM_PROMPT,
        model: model as any,
        tools,
    });

    // Add thinking config injection (same as workflow agent)
    const originalStream = agent.stream.bind(agent);
    (agent as any).stream = async (input: any, options?: any) => {
        console.log('[skill-agent] Input message:', JSON.stringify(input, null, 2));

        const mergedOptions = useThinking
            ? {
                ...options,
                providerOptions: {
                    ...options?.providerOptions,
                    google: {
                        ...options?.providerOptions?.google,
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingLevel: 'high',
                        },
                    },
                },
            }
            : options;

        const result = await originalStream(input, mergedOptions);
        return result;
    };

    return agent;
}
