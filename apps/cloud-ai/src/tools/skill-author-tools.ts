/**
 * Skill-authoring tool for the `skills` delegated subagent.
 *
 * The subagent designs a skill with the existing `modify_skill` tool (which
 * stores the in-progress skill in per-request session state via
 * setSessionSkill/getSessionSkill). `save_skill` persists that session skill to
 * the user's Skills library through the desktop `auto_skill_store` bridge tool —
 * the same persistence path the automatic auto-skills pipeline uses
 * (knowledge/auto-skills.ts → storeAutoSkillDraft). Desktop-bridge dependency:
 * if there's no connected desktop, save_skill returns a clear error.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';
import { getSessionSkill } from '../agents/skill-agent';
import { writeLog } from '../utils/logger';

export const save_skill = createTool({
  id: 'save_skill',
  description:
    'Persist the skill you authored with modify_skill to the user\'s Skills library. ' +
    'Call this once the skill is complete. Leave it inactive by default (activate:false) for the user to review; ' +
    'pass activate:true only when the user explicitly asked to enable it. Returns the stored skill id.',
  inputSchema: z.object({
    activate: z.boolean().optional().default(false).describe('Whether the skill is active (enabled) immediately. Default false — user reviews first.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    skillId: z.string().optional(),
    name: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input: any) => {
    const skill = getSessionSkill();
    if (!skill || typeof skill !== 'object') {
      return { ok: false, error: 'No skill in session. Build one with modify_skill (set_skill) before calling save_skill.' };
    }
    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available — saving a skill requires the Stuard desktop app.' };
    }

    const activate = input?.activate === true;
    try {
      const result: any = await execLocalTool('auto_skill_store', {
        skill: {
          name: skill.name,
          description: skill.description,
          trigger: skill.trigger,
          icon: skill.icon,
          color: skill.color,
          steps: Array.isArray(skill.steps) ? skill.steps : [],
          isActive: activate,
          source: 'subagent',
          metadata: {
            generatedAt: new Date().toISOString(),
            origin: 'skills_subagent',
          },
        },
      }, undefined, 10000);

      if (result?.ok) {
        writeLog('skills_subagent_saved', { skillId: result.skillId, name: skill.name, activate });
        return { ok: true, skillId: result.skillId, name: skill.name };
      }
      return { ok: false, error: String(result?.error || 'auto_skill_store failed') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
});
