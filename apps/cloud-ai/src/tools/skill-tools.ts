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

export interface SkillLookupInput {
  skill_id?: string;
  skill_name?: string;
  request_text?: string;
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

export function findSkillInList(skills: SkillSummary[], lookup: SkillLookupInput): SkillSummary | undefined {
  const { skill_id, skill_name, request_text } = lookup;
  let match: SkillSummary | undefined;

  if (skill_id) {
    match = skills.find(s => s.id === skill_id);
  }

  if (!match && skill_name) {
    const query = skill_name.toLowerCase().trim();
    if (query) {
      match = skills.find(s => s.name.toLowerCase() === query)
        || skills.find(s => s.name.toLowerCase().includes(query));
    }
  }

  if (!match && request_text) {
    const query = request_text.toLowerCase().trim();
    if (query) {
      match = skills.find((skill) =>
        skill.trigger.toLowerCase().includes(query)
        || skill.description.toLowerCase().includes(query)
        || skill.name.toLowerCase().includes(query)
      );
    }
  }

  return match;
}

export function findSkillInContext(lookup: SkillLookupInput): SkillSummary | undefined {
  return findSkillInList(getSkillsFromContext(), lookup);
}

export function buildSkillContextSection(skill: SkillSummary): string {
  const lines = [
    '## SELECTED SKILL',
    'The orchestrator explicitly delegated this task with the following skill. Apply it while completing the task.',
    `Name: ${safeText(skill.name, 256)}`,
  ];

  const description = safeText(skill.description, 4000);
  if (description) {
    lines.push(`Description: ${description}`);
  }

  const trigger = safeText(skill.trigger, 2000);
  if (trigger) {
    lines.push(`Trigger: ${trigger}`);
  }

  if (Array.isArray(skill.steps) && skill.steps.length > 0) {
    lines.push('Steps:');
    skill.steps.slice(0, MAX_STEPS_PER_SKILL).forEach((step, index) => {
      const type = safeText(step.type, 64) || 'prompt';
      const label = safeText(step.label, 256) || `Step ${index + 1}`;
      const toolName = safeText(step.toolName, 256);
      const content = safeText(step.content, 4000);
      lines.push(`${index + 1}. [${type}] ${label}${toolName ? ` (tool: ${toolName})` : ''}`);
      if (content) {
        lines.push(`   ${content}`);
      }
    });
  }

  return lines.join('\n');
}

export function buildAvailableSkillsPromptSection(skills: SkillSummary[] = getSkillsFromContext()): string {
  if (!Array.isArray(skills) || skills.length === 0) return '';

  const skillLines = skills
    .slice(0, MAX_SKILLS)
    .map((skill) => {
      const summary = safeText(skill.description || skill.trigger, 300);
      return summary ? `- ${skill.name}: ${summary}` : `- ${skill.name}`;
    });

  if (skillLines.length === 0) return '';

  return [
    '## AVAILABLE SKILLS',
    'You can use get_skill_info to get full details about any skill.',
    ...skillLines,
  ].join('\n');
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

    const match = findSkillInList(skills, { skill_id, skill_name, request_text });

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
