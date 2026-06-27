import { describe, expect, it } from 'vitest';

import {
  DeploymentValidationError,
  validateDeployRequestForVM,
  type DeployRequest,
} from './deploy-manager';

function workflowRequest(payload: any, schedule?: string): DeployRequest {
  return {
    name: 'Test workflow',
    kind: 'workflow',
    payload,
    autoRestart: true,
    schedule,
  };
}

describe('validateDeployRequestForVM', () => {
  it('allows VM-safe browser and file based tools', () => {
    expect(() => validateDeployRequestForVM(workflowRequest({
      nodes: [
        { id: 'browse', tool: 'browser_use_navigate', args: { url: 'https://example.com' } },
        { id: 'read', tool: 'read_file', args: { path: '/home/stuard/deploys/data/input.txt' } },
        { id: 'write', tool: 'write_file', args: { path: '/home/stuard/deploys/data/output.txt', content: 'ok' } },
      ],
      wires: [],
      triggers: [{ id: 'cron', type: 'schedule.cron', args: { cron: '*/5 * * * *' } }],
    }, '*/5 * * * *'))).not.toThrow();
  });

  it('rejects physical desktop tools and keyboard triggers', () => {
    expect(() => validateDeployRequestForVM(workflowRequest({
      nodes: [{ id: 'mic', label: 'Record audio', tool: 'capture_media', args: { kind: 'audio' } }],
      wires: [],
      triggers: [{ id: 'hotkey', type: 'hotkey', args: { accelerator: 'Ctrl+Alt+K' } }],
    }))).toThrow(DeploymentValidationError);

    try {
      validateDeployRequestForVM(workflowRequest({
        nodes: [{ id: 'mic', label: 'Record audio', tool: 'capture_media', args: { kind: 'audio' } }],
        wires: [],
        triggers: [{ id: 'hotkey', type: 'hotkey', args: { accelerator: 'Ctrl+Alt+K' } }],
      }));
    } catch (error) {
      const validationError = error as DeploymentValidationError;
      expect(validationError.issues.map((issue) => issue.name)).toEqual(expect.arrayContaining(['capture_media', 'hotkey']));
    }
  });

  it('rejects desktop tools nested in orchestration steps', () => {
    expect(() => validateDeployRequestForVM(workflowRequest({
      steps: [{
        id: 'parallel',
        tool: 'run_parallel',
        args: {
          steps: [
            { id: 'safe', tool: 'http_request', args: { url: 'https://example.com' } },
            { id: 'screen', tool: 'take_screenshot', args: {} },
          ],
        },
      }],
    }))).toThrow(/take_screenshot/);
  });

  it('rejects malformed cron schedules before VM deploy', () => {
    expect(() => validateDeployRequestForVM(workflowRequest({
      nodes: [{ id: 'log', tool: 'log', args: { message: 'hello' } }],
    }, 'not a cron'))).toThrow(DeploymentValidationError);
  });
});
