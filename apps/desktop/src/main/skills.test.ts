import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appGetPathMock,
  getAllWindowsMock,
  existsSyncMock,
  readFileSyncMock,
  mkdirSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: appGetPathMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
}));

const baseSkill = {
  id: 'skill_test',
  name: 'Test Skill',
  description: 'A test skill',
  icon: 'Wand2',
  color: 'blue',
  trigger: 'When testing',
  steps: [],
  isActive: false,
  createdAt: '2026-04-12T00:00:00.000Z',
  updatedAt: '2026-04-12T00:00:00.000Z',
};

async function loadSkillsModule() {
  vi.resetModules();
  return import('./skills');
}

describe('skills store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appGetPathMock.mockReturnValue('C:/mock/userData');
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('[]');
    mkdirSyncMock.mockImplementation(() => undefined);
    writeFileSyncMock.mockImplementation(() => undefined);
    getAllWindowsMock.mockReturnValue([]);
  });

  it('returns an error when the skills file cannot be written', async () => {
    writeFileSyncMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    const { skills_save } = await loadSkillsModule();
    const result = skills_save({ ...baseSkill });

    expect(result).toEqual({ ok: false, error: 'disk full' });
  });

  it('broadcasts skill updates after a successful save', async () => {
    const sendMock = vi.fn();
    getAllWindowsMock.mockReturnValue([{ webContents: { send: sendMock } }]);

    const { skills_save } = await loadSkillsModule();
    const result = skills_save({ ...baseSkill });

    expect(result).toEqual({ ok: true });
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      'skills:updated',
      expect.arrayContaining([expect.objectContaining({ id: 'skill_test', name: 'Test Skill' })]),
    );
  });
});
