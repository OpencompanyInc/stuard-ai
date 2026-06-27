import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  safeFlowIdMock,
  getWorkspaceDirMock,
  runStuardEngineMock,
  stuardsSaveMock,
  fsReaddirSyncMock,
  fsReadFileSyncMock,
  fsExistsSyncMock,
  appGetPathMock,
} = vi.hoisted(() => ({
  safeFlowIdMock: vi.fn(),
  getWorkspaceDirMock: vi.fn(),
  runStuardEngineMock: vi.fn(),
  stuardsSaveMock: vi.fn(),
  fsReaddirSyncMock: vi.fn(),
  fsReadFileSyncMock: vi.fn(),
  fsExistsSyncMock: vi.fn(),
  appGetPathMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
  },
}));

vi.mock('fs', () => ({
  readdirSync: fsReaddirSyncMock,
  readFileSync: fsReadFileSyncMock,
  existsSync: fsExistsSyncMock,
  unlinkSync: vi.fn(),
}));

vi.mock('../../workflows/workflows', () => ({
  safeFlowId: safeFlowIdMock,
  getWorkspaceDir: getWorkspaceDirMock,
  readWorkflowModel: vi.fn(),
  designerModelToStuardSpec: vi.fn(),
}));

vi.mock('../../engine', () => ({
  runStuardEngine: runStuardEngineMock,
}));

vi.mock('../../stuards', () => ({
  stuards_save: stuardsSaveMock,
}));

// Stub variable project-scoping helpers (their real impl is unit-tested
// separately in workflow-variables.project-scope.test.ts). resolveProjectId is
// identity so the handler binds the sub-run to the parent flow.
const registerFlowProjectMock = vi.fn();
const unregisterFlowProjectMock = vi.fn();
const clearFlowLocalVariablesMock = vi.fn();
vi.mock('../../workflow-variables', () => ({
  registerFlowProject: (...a: any[]) => registerFlowProjectMock(...a),
  unregisterFlowProject: (...a: any[]) => unregisterFlowProjectMock(...a),
  clearFlowLocalVariables: (...a: any[]) => clearFlowLocalVariablesMock(...a),
  resolveProjectId: (id: string) => id,
}));

import {
  discoverWorkspaceFunctions,
  execCallWorkspaceFunction,
  execListWorkspaceFunctions,
} from '../handlers/workspace-functions';

const mockCtx = {
  agentWsUrl: 'ws://localhost:8765/ws',
  cloudAiUrl: 'http://localhost:8082',
  accessToken: 'token',
  logFn: vi.fn(),
} as any;

const dirent = (name: string, isDirectory: boolean) => ({
  name,
  isDirectory: () => isDirectory,
});

const normalizePath = (p: string) => p.replace(/\\/g, '/');

describe('workspace-functions handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeFlowIdMock.mockImplementation((id: string) => id);
    getWorkspaceDirMock.mockReturnValue('C:/mock/workspace');
    fsExistsSyncMock.mockReturnValue(false);
    appGetPathMock.mockReturnValue('C:/mock/userData');
  });

  it('discoverWorkspaceFunctions returns empty when flow id is invalid', () => {
    safeFlowIdMock.mockReturnValue('');

    expect(discoverWorkspaceFunctions('bad-id')).toEqual([]);
  });

  it('discoverWorkspaceFunctions returns parsed metadata and fallback entries', () => {
    fsReaddirSyncMock.mockImplementation((dir: string) => {
      const d = normalizePath(dir);
      if (d === 'C:/mock/workspace') {
        return [
          dirent('main.stuard', false),
          dirent('helper.stuard', false),
          dirent('utils', true),
        ];
      }
      if (d === 'C:/mock/workspace/utils') {
        return [dirent('bad.stuard', false)];
      }
      return [];
    });

    fsReadFileSyncMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('helper.stuard')) {
        return JSON.stringify({
          name: 'Helper Flow',
          description: 'Helper description',
          triggers: [{ type: 'function', inputParams: [{ name: 'email', required: true }] }],
          outputSchema: [{ name: 'ok', type: 'boolean' }],
        });
      }

      if (filePath.endsWith('bad.stuard')) {
        throw new Error('parse failed');
      }

      return '{}';
    });

    const items = discoverWorkspaceFunctions('flow_1');

    expect(items).toHaveLength(2);
    expect(items).toContainEqual(
      expect.objectContaining({
        path: 'helper.stuard',
        name: 'Helper Flow',
        description: 'Helper description',
        isFunction: true,
        triggers: ['function'],
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        path: 'utils/bad.stuard',
        name: 'bad',
        isFunction: false,
      }),
    );
  });

  it('execListWorkspaceFunctions validates flowId', async () => {
    const res = await execListWorkspaceFunctions({}, mockCtx);

    expect(res.ok).toBe(false);
    expect(res.error).toContain('missing flowId');
    expect(res.functions).toEqual([]);
  });

  it('execListWorkspaceFunctions returns discovered functions', async () => {
    fsReaddirSyncMock.mockImplementation((dir: string) => {
      if (normalizePath(dir) === 'C:/mock/workspace') {
        return [dirent('fn.stuard', false)];
      }
      return [];
    });
    fsReadFileSyncMock.mockReturnValue(
      JSON.stringify({
        name: 'My Fn',
        triggers: [{ type: 'function' }],
      }),
    );

    const res = await execListWorkspaceFunctions({ flowId: 'flow_2' }, mockCtx);

    expect(res.ok).toBe(true);
    expect(res.functions).toHaveLength(1);
    expect(res.functions[0]).toEqual(
      expect.objectContaining({
        path: 'fn.stuard',
        name: 'My Fn',
        isFunction: true,
      }),
    );
  });

  it('execCallWorkspaceFunction validates required arguments', async () => {
    const missingFlow = await execCallWorkspaceFunction({ path: 'helpers/a.stuard' }, mockCtx);
    expect(missingFlow.ok).toBe(false);
    expect(missingFlow.error).toContain('missing flowId');

    const missingPath = await execCallWorkspaceFunction({ flowId: 'flow_3' }, mockCtx);
    expect(missingPath.ok).toBe(false);
    expect(missingPath.error).toContain('missing path');
  });

  it('execCallWorkspaceFunction blocks traversal-style paths by failing resolution', async () => {
    fsExistsSyncMock.mockReturnValue(true);

    const res = await execCallWorkspaceFunction(
      { flowId: 'flow_4', path: '../outside/malicious.stuard', inputs: {} },
      mockCtx,
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('workspace function not found');
  });
});
