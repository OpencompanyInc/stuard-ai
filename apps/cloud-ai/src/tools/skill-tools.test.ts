import { describe, expect, it } from 'vitest';
import { runWithSecrets } from './bridge';
import { buildAvailableSkillsPromptSection, getSkillsFromContext } from './skill-tools';

describe('skill tools context helpers', () => {
  it('returns active skills from bridge secrets', () => {
    const skills = runWithSecrets({
      __skills: [
        {
          id: 'skill_email',
          name: 'Email Helper',
          description: 'Draft concise follow-up emails',
          trigger: 'when the user asks for email help',
          isActive: true,
          steps: [{ id: 'step_1', type: 'prompt', label: 'Draft', content: 'Write the email' }],
        },
      ],
    }, () => getSkillsFromContext());

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'skill_email',
      name: 'Email Helper',
      description: 'Draft concise follow-up emails',
      trigger: 'when the user asks for email help',
    });
  });

  it('builds a prompt section with name and summary fallback', () => {
    const section = buildAvailableSkillsPromptSection([
      {
        id: 'skill_calendar',
        name: 'Calendar Prep',
        description: '',
        trigger: 'when the user needs meeting prep',
        steps: [],
      },
      {
        id: 'skill_research',
        name: 'Research Sprint',
        description: 'Collect sources and summarize findings',
        trigger: '',
        steps: [],
      },
    ]);

    expect(section).toContain('## AVAILABLE SKILLS');
    expect(section).toContain('- Calendar Prep: when the user needs meeting prep');
    expect(section).toContain('- Research Sprint: Collect sources and summarize findings');
  });

  it('returns an empty section when no skills are available', () => {
    expect(buildAvailableSkillsPromptSection([])).toBe('');
  });
});
