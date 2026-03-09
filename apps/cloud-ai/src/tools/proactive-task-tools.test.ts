import { describe, expect, it } from 'vitest';
import { hasProactiveModeMarker, mergeForcedToolNames, PROACTIVE_TASK_TOOL_NAMES } from './proactive-task-tools';

describe('proactive task tools helpers', () => {
  it('detects proactive mode markers in hidden context', () => {
    expect(hasProactiveModeMarker('[PROACTIVE MODE] hello')).toBe(true);
    expect(hasProactiveModeMarker('[PROACTIVE FOLLOW-UP] hello')).toBe(true);
    expect(hasProactiveModeMarker('plain chat')).toBe(false);
  });

  it('forces proactive task tools into ranked tool names without duplication', () => {
    const merged = mergeForcedToolNames(['web_search', 'proactive_task_list']);
    expect(merged).toContain('web_search');
    expect(merged.filter((name) => name === 'proactive_task_list')).toHaveLength(1);
    for (const name of PROACTIVE_TASK_TOOL_NAMES) {
      expect(merged).toContain(name);
    }
  });
});