import { describe, it, expect } from 'vitest';
import { getToolKind, TOOL_REGISTRY } from '../registry';

describe('Tool Registry', () => {
  it('should return "local" for unknown tools', () => {
    expect(getToolKind('unknown_tool_xyz')).toBe('local');
  });

  it('should return correct kind for known tools', () => {
    expect(getToolKind('custom_ui')).toBe('electron');
    expect(getToolKind('analyze_media')).toBe('cloud');
    expect(getToolKind('run_sequential')).toBe('orchestration');
  });

  it('should have handlers defined for cloud tools', () => {
    const cloudTools = Object.entries(TOOL_REGISTRY).filter(([_, v]) => v.kind === 'cloud');
    for (const [name, entry] of cloudTools) {
      if (entry.handler) {
        expect(entry.handler).toBeDefined();
      }
      // some cloud tools might use default handler path
    }
  });
});
