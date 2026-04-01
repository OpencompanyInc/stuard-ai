/**
 * Test: skills survive the nested withClientBridge call in agent-runner
 */
import { describe, it, expect } from 'vitest';
import { withClientBridge, getBridgeSecrets } from './bridge';
import { getSkillsFromContext, buildAvailableSkillsPromptSection } from './skill-tools';

const MOCK_WS = { send: () => {}, on: () => {}, once: () => {}, removeListener: () => {}, addEventListener: () => {} } as any;

const MOCK_SKILLS = [
  {
    id: 'skill_1772612985721',
    name: 'peak annoyance',
    description: 'Describe what this skill does...',
    trigger: 'When the user asks to...',
    steps: [{ id: 'step_1', type: 'prompt', label: 'Step 1', content: 'Press windows D' }],
    isActive: true,
  },
  {
    id: 'skill_1772658395633',
    name: 'Academic Research',
    description: 'Conducts a structured, academic-grade research process.',
    trigger: 'When the user requests academic research.',
    steps: [],
    isActive: true,
  },
];

describe('skills survive nested withClientBridge (agent-runner fix)', () => {
  it('FIXED: inheritedSecrets pattern preserves __skills in inner bridge', async () => {
    let skillsInInner: any[] = [];
    let section = '';

    await withClientBridge(MOCK_WS, async () => {
      // This is the fix: capture before entering inner bridge
      const inheritedSecrets = getBridgeSecrets();

      await withClientBridge(MOCK_WS, async () => {
        skillsInInner = getSkillsFromContext();
        section = buildAvailableSkillsPromptSection(skillsInInner);
      }, { ...inheritedSecrets, userId: 'u1', conversationId: 'c1' });
    }, { __skills: MOCK_SKILLS });

    expect(skillsInInner).toHaveLength(2);
    expect(skillsInInner[0].name).toBe('peak annoyance');
    expect(skillsInInner[1].name).toBe('Academic Research');
    expect(section).toContain('## AVAILABLE SKILLS');
    expect(section).toContain('peak annoyance');
    expect(section).toContain('Academic Research');
  });

  it('BROKEN (old pattern): inner bridge without inheritedSecrets loses __skills', async () => {
    let skillsInInner: any[] = [];

    await withClientBridge(MOCK_WS, async () => {
      // Old broken pattern: no inheritedSecrets forwarded
      await withClientBridge(MOCK_WS, async () => {
        skillsInInner = getSkillsFromContext();
      }, { userId: 'u1', conversationId: 'c1' });
    }, { __skills: MOCK_SKILLS });

    // This is the bug — inner bridge returns no skills
    expect(skillsInInner).toHaveLength(0);
  });
});
