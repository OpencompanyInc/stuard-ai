/**
 * Skill Agent - Specialized agent for designing and modifying skills
 *
 * Mirrors the workflow agent pattern: uses a modify_skill tool to
 * apply structured changes to skills, emitting tool_event for real-time UI updates.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { buildProviderModel, buildProviderModelForUser, type ModelSourcePreference } from '../utils/models';
import { writeLog } from '../utils/logger';
import { safeToolWrite, getBridgeState, setBridgeState } from '../tools/bridge';
import { search_tools } from '../tools/meta-tools';
import { retrieveToolFormat } from '../tools/workflow-system';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url } from '../tools/tavily-tools';
import { normalizeToolInputForSchema, coerceToolInputSchema } from '../tools/zod-utils';
import { SKILL_SYSTEM_PROMPT } from './skill-prompt';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
// Gemini/GPT/Grok/DeepSeek are served through Stuard's OpenRouter account, so an
// OpenRouter key satisfies the native-provider requirement (see buildProviderModel).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

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
        // NB: z.object({}).loose() not z.any() — a bare z.any() emits a type-less
        // property that Gemini's validator rejects on the OpenRouter→Google path
        // (see zod-utils.geminiSafeJsonValue / gemini-schema-safety.test.ts).
        skill: z.object({}).loose().optional().describe('Full skill object for set_skill operation'),

        // add_step
        step: z.object({}).loose().optional().describe('Step object for add_step: { type, label, content, toolName? }'),
        afterStepId: z.string().optional().describe('Insert after this step ID (add_step). If omitted, appends to end.'),

        // update_step
        stepId: z.string().optional().describe('Step ID for update_step, remove_step, reorder_steps'),
        updates: z.object({}).loose().optional().describe('Fields to update for update_step or update_metadata'),

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

// SKILL_SYSTEM_PROMPT now lives in the dependency-free ./skill-prompt module so
// it can be imported without skill-agent's heavy graph. Re-export keeps the
// public name stable for existing importers.
export { SKILL_SYSTEM_PROMPT };

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL AGENT FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export function skillAgentLog(event: string, data?: Record<string, any>) {
    const msg = data ? `[skill-agent] ${event}: ${JSON.stringify(data)}` : `[skill-agent] ${event}`;
    console.log(msg);
    writeLog(`skill_agent_${event}`, data);
}

function createSkillAgent(modelIdOverride?: string, modelInstance?: any): Agent {
    const modelId =
        (typeof modelIdOverride === 'string' && modelIdOverride.trim())
            ? modelIdOverride.trim()
            : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');

    const provider = String(modelId.split('/')[0] || '').toLowerCase();

    if (!modelInstance && provider === 'google' && !GOOGLE_API_KEY && !OPENROUTER_API_KEY) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY is required for google skill models');
    }
    if (!modelInstance && provider === 'openai' && !OPENAI_API_KEY && !OPENROUTER_API_KEY) {
        throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is required for openai skill models');
    }
    if (!modelInstance && provider === 'xai' && !XAI_API_KEY && !OPENROUTER_API_KEY) {
        throw new Error('XAI_API_KEY or OPENROUTER_API_KEY is required for xai skill models');
    }
    if (!modelInstance && provider === 'deepseek' && !DEEPSEEK_API_KEY && !OPENROUTER_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY or OPENROUTER_API_KEY is required for deepseek skill models');
    }
    if (!modelInstance && provider === 'perplexity' && !PERPLEXITY_API_KEY) {
        throw new Error('PERPLEXITY_API_KEY is required for perplexity skill models');
    }

    const model = modelInstance || buildProviderModel(modelId);
    if (!model) {
        throw new Error(`Unsupported skill modelId: ${modelId}`);
    }

    skillAgentLog('init', { model: modelId });

    // Create logging wrappers for tools
    const createLoggedTool = (tool: any, name: string) => {
        const inputSchema = tool.inputSchema || tool.parameters;
        return {
            ...tool,
            ...(inputSchema ? { inputSchema: coerceToolInputSchema(inputSchema) } : {}),
            execute: async (args: any, runCtx?: any) => {
                const normalizedArgs = inputSchema ? normalizeToolInputForSchema(inputSchema, args) : args;
                console.log(`[skill-agent] Tool call: ${name}`, JSON.stringify(normalizedArgs, null, 2));
                try {
                    const result = await tool.execute(normalizedArgs, runCtx);
                    console.log(`[skill-agent] Tool result: ${name}`, JSON.stringify(result, null, 2));
                    return result;
                } catch (error) {
                    console.error(`[skill-agent] Tool error: ${name}`, error);
                    throw error;
                }
            }
        };
    };

    const tools = {
        modify_skill: createLoggedTool(modifySkillTool, 'modify_skill'),
        search_tools: createLoggedTool(search_tools, 'search_tools'),
        get_tool_schema: createLoggedTool(retrieveToolFormat, 'get_tool_schema'),
        web_search: createLoggedTool(web_search, 'web_search'),
        scrape_url: createLoggedTool(scrape_url, 'scrape_url'),
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
    (agent as any).__modelSource = (model as any)?.__stuardResolvedSource;
    (agent as any).__billingExcluded = !!(model as any)?.__stuardBillingExcluded;

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

export function getSkillAgent(modelIdOverride?: string): Agent {
    return createSkillAgent(modelIdOverride);
}

export async function getSkillAgentForUser(
    modelIdOverride?: string,
    userId?: string | null,
    modelSource?: ModelSourcePreference | string | null,
): Promise<Agent> {
    const modelId =
        (typeof modelIdOverride === 'string' && modelIdOverride.trim())
            ? modelIdOverride.trim()
            : (process.env.WORKFLOW_MODEL_ID || 'google/gemini-3-pro-preview');
    const resolved = await buildProviderModelForUser(userId, modelId, modelSource);
    if (!resolved?.model) {
        throw new Error(`Unsupported skill modelId: ${modelId}`);
    }
    return createSkillAgent(modelId, resolved.model);
}
