import { describe, expect, it } from 'vitest';
import { validateNodeTools } from './workflow-node-validation';

describe('validateNodeTools', () => {
  it('allows desktop engine internal call_function nodes', () => {
    const issues = validateNodeTools({
      nodes: [
        {
          id: 'local_tool_mpo97dqm',
          tool: 'call_function',
          label: 'Show dashboard notification',
          args: { triggerId: 'step_notify' },
        },
      ],
    });

    expect(issues).toEqual([]);
  });
});
