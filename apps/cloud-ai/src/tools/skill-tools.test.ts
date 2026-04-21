import { describe, expect, it } from 'vitest';
import { runWithSecrets } from './bridge';
import { buildAvailableSkillsPromptSection, buildSkillContextSection, findSkillInContext, getSkillsFromContext } from './skill-tools';

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

  it('finds a skill by case-insensitive name from bridge secrets', () => {
    const skill = runWithSecrets({
      __skills: [
        {
          id: 'skill_email',
          name: 'Email Helper',
          description: 'Draft concise follow-up emails',
          trigger: 'when the user asks for email help',
          steps: [],
        },
      ],
    }, () => findSkillInContext({ skill_name: 'email helper' }));

    expect(skill).toMatchObject({
      id: 'skill_email',
      name: 'Email Helper',
    });
  });

  it('builds a selected skill context section with ordered steps', () => {
    const section = buildSkillContextSection({
      id: 'skill_email',
      name: 'Email Helper',
      description: 'Draft concise follow-up emails',
      trigger: 'when the user asks for email help',
      steps: [
        { id: 'step_1', type: 'prompt', label: 'Draft', content: 'Write the first version.' },
        { id: 'step_2', type: 'tool', label: 'Search', content: 'Look up the latest context.', toolName: 'web_search' },
      ],
    });

    expect(section).toContain('## SELECTED SKILL');
    expect(section).toContain('Name: Email Helper');
    expect(section).toContain('1. [prompt] Draft');
    expect(section).toContain('2. [tool] Search (tool: web_search)');
  });

  it('returns an empty section when no skills are available', () => {
    expect(buildAvailableSkillsPromptSection([])).toBe('');
  });
});
