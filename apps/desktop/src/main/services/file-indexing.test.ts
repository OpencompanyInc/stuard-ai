import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, appGetPathMock, getAllWindowsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  appGetPathMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  app: {
    getPath: appGetPathMock,
  },
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function loadFileIndexingModule() {
  vi.resetModules();
  return import('./file-indexing');
}

describe('file-indexing search bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    appGetPathMock.mockImplementation((name: string) => `C:/mock/${name}`);
    getAllWindowsMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the new result.results agent payload shape', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ id: 'new-result', filename: 'cat.jpg' }],
          files: [{ id: 'legacy-result', filename: 'old-cat.jpg' }],
        }),
      });

    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('cat')).resolves.toEqual([{ id: 'new-result', filename: 'cat.jpg' }]);
  });

  it('falls back to legacy result.files payloads', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          files: [{ id: 'legacy-result', filename: 'report.docx' }],
        }),
      });

    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('report')).resolves.toEqual([{ id: 'legacy-result', filename: 'report.docx' }]);
  });
});
