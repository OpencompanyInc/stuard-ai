import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';

/**
 * Skill info tool — allows the agent to retrieve full details about a user-defined skill.
 * Skills are sent per-request from the desktop client via context.skills and stored in bridge secrets.
 */

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps?: Array<{
    id: string;
    type: string;
    label: string;
    content: string;
    toolName?: string;
  }>;
  icon?: string;
  color?: string;
  isActive?: boolean;
}

const MAX_SKILLS = 30;
const MAX_STEPS_PER_SKILL = 40;

function safeText(value: unknown, maxLen: number = 4000): string {
  const out = String(value ?? '').trim();
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function sanitizeSkill(raw: any): SkillSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeText(raw.id, 256);
  const name = safeText(raw.name, 256);
  if (!id || !name) return null;

  const steps = Array.isArray(raw.steps)
    ? raw.steps.slice(0, MAX_STEPS_PER_SKILL).map((step: any) => {
      const toolName = safeText(step?.toolName, 256);
      return {
        id: safeText(step?.id, 256),
        type: safeText(step?.type, 64) || 'prompt',
        label: safeText(step?.label, 256),
        content: safeText(step?.content, 4000),
        ...(toolName ? { toolName } : {}),
      };
    }).filter((s: { id: string; type: string }) => s.id && s.type)
    : [];

  return {
    id,
    name,
    description: safeText(raw.description, 4000),
    trigger: safeText(raw.trigger, 2000),
    steps,
    icon: safeText(raw.icon, 64) || undefined,
    color: safeText(raw.color, 64) || undefined,
    isActive: !!raw.isActive,
  };
}

/**
 * Get the full skills list from bridge secrets (set by server.ts when processing the chat message).
 */
export function getSkillsFromContext(): SkillSummary[] {
  try {
    const secrets = getBridgeSecrets();
    const skills = secrets?.__skills;
    if (Array.isArray(skills)) {
      return skills
        .slice(0, MAX_SKILLS)
        .map(sanitizeSkill)
        .filter((s): s is SkillSummary => !!s);
    }
  } catch { }
  return [];
}

export const get_skill_info = createTool({
  id: 'get_skill_info',
  description: 'Get full details of a user-defined skill by name or ID. Skills are guidance playbooks that describe recommended steps, tools to call, and arrangement for handling a request.',
  inputSchema: z.object({
    skill_id: z.string().optional().describe('Exact skill ID (e.g. skill_1234)'),
    skill_name: z.string().optional().describe('Skill name (case-insensitive partial match)'),
    request_text: z.string().optional().describe('Optional user request text to help match the best skill by trigger/description'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    skill: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      trigger: z.string(),
      steps: z.array(z.object({
        type: z.string(),
        label: z.string(),
        content: z.string(),
        toolName: z.string().optional(),
      })),
    }).optional(),
    error: z.string().optional(),
    available_skills: z.array(z.object({
      id: z.string(),
      name: z.string(),
      trigger: z.string().optional(),
    })).optional(),
  }),
  execute: async (inputData) => {
    const { skill_id, skill_name, request_text } = inputData;
    const skills = getSkillsFromContext();

    if (skills.length === 0) {
      return { found: false, error: 'No skills are currently active. The user has not configured any skills.' };
    }

    let match: SkillSummary | undefined;

    // Match by ID first
    if (skill_id) {
      match = skills.find(s => s.id === skill_id);
    }

    // Then by name (case-insensitive partial match)
    if (!match && skill_name) {
      const q = skill_name.toLowerCase().trim();
      match = skills.find(s => s.name.toLowerCase() === q)
        || skills.find(s => s.name.toLowerCase().includes(q));
    }

    // Optionally match by request text against trigger/description/name.
    if (!match && request_text) {
      const q = request_text.toLowerCase().trim();
      if (q) {
        match = skills.find((s) =>
          s.trigger.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
        );
      }
    }

    if (!match) {
      return {
        found: false,
        error: `Skill not found. Provide a valid skill_id or skill_name.`,
        available_skills: skills.map(s => ({ id: s.id, name: s.name, trigger: s.trigger })),
      };
    }

    return {
      found: true,
      skill: {
        id: match.id,
        name: match.name,
        description: match.description,
        trigger: match.trigger,
        steps: (match.steps || []).map(s => ({
          type: s.type,
          label: s.label,
          content: s.content,
          toolName: s.toolName,
        })),
      },
    };
  },
});
